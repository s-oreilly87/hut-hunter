"""Job CRUD routes: list, create, get, update, delete, trigger, book."""

import json
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.auth import get_current_user
from app.api._route_deps import (
    LIVE_HOLD_STATUSES,
    _check_booking_window,
    _clamp_interval,
    _delete_job_artifacts,
    _enqueue_browser_close,
    _get_owned_job,
    _job_has_required_credentials,
    _latest_cart,
    _serialize_job,
    _validate_job_start_date_for_adapter,
    _validate_job_occupants_for_adapter,
    get_redis,
)
from app.adapters import adapter_supports_automated_booking
from app.adapters.base import BookingWindowInfo
from app.core.adapter_credentials import get_user_configured_adapter_ids
from app.core.database import get_session
from app.models.job import (
    JobStatus,
    WatchJob,
    WatchJobCreate,
    WatchJobRead,
    WatchJobUpdate,
    WindowCheckRequest,
    WindowCheckResponse,
    as_utc,
    is_job_expired,
    utcnow,
)
from app.models.session import CartSession
from app.models.user import AppUser
from app.workers._shared import _check_job_arq_id, _params_have_occupants
from app.workers.hold_worker import HOLD_QUEUE_NAME

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/jobs", response_model=list[WatchJobRead])
async def list_jobs(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    jobs = (await session.execute(
        select(WatchJob).where(WatchJob.user_id == current_user.id)
    )).scalars().all()
    return [
        await _serialize_job(session, job, configured_adapter_ids=configured_adapter_ids)
        for job in jobs
    ]


@router.post("/jobs", response_model=WatchJobRead, status_code=201)
async def create_job(
    body: WatchJobCreate,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    interval = _clamp_interval(body.interval_minutes)
    now = utcnow()
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)

    if body.auto_book and not adapter_supports_automated_booking(body.adapter_id):
        raise HTTPException(status_code=409, detail="This booking site does not support automated booking.")
    if body.auto_book and not _params_have_occupants(body.params):
        raise HTTPException(status_code=409, detail="Occupants are required before auto-book can be enabled.")
    if body.auto_book and not _job_has_required_credentials(body.adapter_id, configured_adapter_ids):
        raise HTTPException(status_code=409, detail="Stored booking credentials are required before auto-book can be enabled.")
    _validate_job_start_date_for_adapter(body.adapter_id, body.params)
    if _params_have_occupants(body.params):
        _validate_job_occupants_for_adapter(body.adapter_id, body.params)

    monitoring = body.enable_monitoring
    window = await _check_booking_window(body.adapter_id, body.params)

    if not window.is_open:
        # THR-124: not yet released — park in AWAITING_WINDOW instead of the
        # normal PAUSED/CHECKING split. Monitoring is forced on regardless of
        # what the wizard sent: the scheduler needs to see this job to arm
        # it, and auto-arming is the entire point of this state. No initial
        # check is enqueued — there's nothing to check yet.
        job = WatchJob(
            user_id=current_user.id,
            name=body.name,
            adapter_id=body.adapter_id,
            params=json.dumps(body.params),
            auto_book=body.auto_book,
            enable_monitoring=True,
            interval_minutes=interval,
            next_check_at=None,
            status=JobStatus.AWAITING_WINDOW.value,
            window_opens_at=window.opens_at,
            window_opens_precise=window.opens_at_precise,
        )
        session.add(job)
        await session.commit()
        await session.refresh(job)
        return await _serialize_job(session, job, configured_adapter_ids=configured_adapter_ids)

    job = WatchJob(
        user_id=current_user.id,
        name=body.name,
        adapter_id=body.adapter_id,
        params=json.dumps(body.params),
        auto_book=body.auto_book,
        enable_monitoring=monitoring,
        interval_minutes=interval,
        next_check_at=(now + timedelta(minutes=interval)) if monitoring else None,
        status=JobStatus.CHECKING.value if monitoring else JobStatus.PAUSED.value,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    if monitoring:
        try:
            await redis.enqueue_job("check_availability", job.id, _job_id=_check_job_arq_id(job.id))
        except Exception:
            logger.exception(f"Failed to enqueue first check for new job {job.id}")

    return await _serialize_job(session, job, configured_adapter_ids=configured_adapter_ids)


@router.post("/jobs/window-check", response_model=WindowCheckResponse)
async def check_job_window(
    body: WindowCheckRequest,
    current_user: AppUser = Depends(get_current_user),
):
    """THR-124: "is this date released yet?" — called by the create/edit
    wizard before the user saves, so the not-yet-released case can be
    explained up front rather than discovered after the fact. Never 4xxs on
    an unknown/non-windowed adapter or a lookup failure — see
    ``_check_booking_window``'s fail-open contract."""
    window = await _check_booking_window(body.adapter_id, body.params)
    return WindowCheckResponse(
        is_open=window.is_open,
        opens_at=window.opens_at,
        opens_at_precise=window.opens_at_precise,
        evidence=window.evidence,
    )


@router.get("/jobs/{job_id}", response_model=WatchJobRead)
async def get_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    job = await _get_owned_job(session, current_user.id, job_id)
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    return await _serialize_job(session, job, configured_adapter_ids=configured_adapter_ids)


@router.patch("/jobs/{job_id}", response_model=WatchJobRead)
async def update_job(
    job_id: str,
    body: WatchJobUpdate,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Partial update — name, params, auto_book, enable_monitoring, interval_minutes are mutable.
    Editing params clears last_result/last_checked_at (stale against old search).
    adapter_id is immutable; change adapters by deleting and recreating.

    Monitoring transitions:
      • OFF → ON   — enqueue a check now; set next_check_at one interval out.
      • ON  → OFF  — clear next_check_at; WAITING → PAUSED.
      • ON  → ON   — enqueue a check now (any edit triggers a fresh check);
                     also reschedule next_check_at if interval changed.
    """
    job = await _get_owned_job(session, current_user.id, job_id)
    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(status_code=403, detail="Completed bookings are locked and cannot be edited.")

    patch = body.model_dump(exclude_unset=True)
    next_params = patch["params"] if "params" in patch else json.loads(job.params)
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)

    if "params" in patch:
        _validate_job_start_date_for_adapter(job.adapter_id, next_params)
        if _params_have_occupants(next_params):
            _validate_job_occupants_for_adapter(job.adapter_id, next_params)

    if "name" in patch:
        job.name = patch["name"]

    if "auto_book" in patch:
        if patch["auto_book"] and not adapter_supports_automated_booking(job.adapter_id):
            raise HTTPException(status_code=409, detail="This booking site does not support automated booking.")
        if patch["auto_book"] and not _params_have_occupants(next_params):
            raise HTTPException(status_code=409, detail="Occupants are required before auto-book can be enabled.")
        if patch["auto_book"] and not _job_has_required_credentials(job.adapter_id, configured_adapter_ids):
            raise HTTPException(status_code=409, detail="Stored booking credentials are required before auto-book can be enabled.")
        if patch["auto_book"]:
            _validate_job_occupants_for_adapter(job.adapter_id, next_params)
        job.auto_book = patch["auto_book"]

    was_awaiting_window = job.status == JobStatus.AWAITING_WINDOW.value
    window: BookingWindowInfo | None = None

    if "params" in patch:
        job.params = json.dumps(patch["params"])
        if not _params_have_occupants(patch["params"]):
            job.auto_book = False
        job.last_result = None
        job.last_checked_at = None
        job.last_artifact = None
        job.artifact_history = None
        # THR-124: an edited date/park can move a job across the booking-
        # window boundary in either direction — recheck it here rather than
        # only at creation.
        window = await _check_booking_window(job.adapter_id, patch["params"])

    prev_monitoring = job.enable_monitoring
    prev_interval = job.interval_minutes

    if "interval_minutes" in patch:
        job.interval_minutes = _clamp_interval(patch["interval_minutes"])
    if "enable_monitoring" in patch:
        job.enable_monitoring = bool(patch["enable_monitoring"])

    now = utcnow()
    dispatch_now = False

    if window is not None and not window.is_open:
        # THR-124: the edited date isn't released yet — park for auto-arm
        # instead of the monitoring-transition logic below. Monitoring is
        # forced on for the same reason as at creation: arming needs the
        # scheduler to see this job.
        job.status = JobStatus.AWAITING_WINDOW.value
        job.enable_monitoring = True
        job.next_check_at = None
        job.window_burst_until = None
        job.window_opens_at = window.opens_at
        job.window_opens_precise = window.opens_at_precise
    elif window is not None and was_awaiting_window:
        # The job was parked awaiting a window that's now open (or the edit
        # moved it to a date/park that no longer applies) — resume exactly
        # like an OFF → ON monitoring transition.
        job.window_opens_at = None
        job.next_check_at = now
        job.status = JobStatus.CHECKING.value if job.enable_monitoring else JobStatus.PAUSED.value
        dispatch_now = job.enable_monitoring
    elif job.enable_monitoring and not prev_monitoring:
        # OFF → ON
        job.next_check_at = now + timedelta(minutes=job.interval_minutes)
        if job.status in (JobStatus.PAUSED.value, JobStatus.CANCELLED.value):
            job.status = JobStatus.CHECKING.value
            dispatch_now = True
        elif job.status == JobStatus.WAITING.value:
            dispatch_now = True
    elif not job.enable_monitoring and prev_monitoring:
        # ON → OFF
        job.next_check_at = None
        if job.status == JobStatus.WAITING.value:
            job.status = JobStatus.PAUSED.value
        elif job.status == JobStatus.AWAITING_WINDOW.value:
            # THR-124: AWAITING_WINDOW invariantly implies enable_monitoring
            # — turning monitoring off explicitly cancels the pending auto-arm
            # rather than leaving a job parked with nothing that will ever
            # wake it (the scheduler's arm pass doesn't check this flag).
            job.status = JobStatus.PAUSED.value
            job.window_opens_at = None
            job.window_burst_until = None
    elif job.enable_monitoring and prev_monitoring:
        # Monitoring stays on — reschedule if interval changed, and always
        # trigger an immediate check so the user sees fresh results for any edit.
        if job.interval_minutes != prev_interval:
            job.next_check_at = now + timedelta(minutes=job.interval_minutes)
        dispatch_now = True

    session.add(job)
    await session.commit()
    await session.refresh(job)

    if dispatch_now:
        try:
            await redis.enqueue_job("check_availability", job.id, _job_id=_check_job_arq_id(job.id))
        except Exception:
            logger.exception(f"Failed to enqueue check on monitoring-enable for {job.id}")

    return await _serialize_job(session, job, configured_adapter_ids=configured_adapter_ids)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Delete a job and its carts. If HOLD_PLACED or NEEDS_ATTENTION, also
    signals the hold worker to close the headed browser (best-effort)."""
    job = await _get_owned_job(session, current_user.id, job_id)
    had_live_hold = job.status in LIVE_HOLD_STATUSES
    _delete_job_artifacts(job)

    carts = (await session.execute(
        select(CartSession).where(CartSession.job_id == job_id)
    )).scalars().all()
    for cart in carts:
        await session.delete(cart)
    await session.delete(job)
    await session.commit()

    if had_live_hold:
        try:
            await _enqueue_browser_close(job_id, redis)
        except Exception:
            logger.exception("Failed to enqueue browser close after delete")

    return None


@router.post("/jobs/{job_id}/trigger", status_code=202)
async def trigger_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Manually enqueue a check. Rejects expired jobs and live holds.
    Expired HOLD_PLACED/NEEDS_ATTENTION (no live cart) is lazily flipped back
    to CHECKING."""
    job = await _get_owned_job(session, current_user.id, job_id)

    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(status_code=409, detail="This job is already booked and cannot be triggered again.")

    params = json.loads(job.params)
    if is_job_expired(job.adapter_id, params):
        raise HTTPException(status_code=409, detail="This job's start date has passed — it cannot be triggered.")

    if job.status in LIVE_HOLD_STATUSES:
        cart = await _latest_cart(session, job_id)
        if cart and cart.completed_at is None and as_utc(cart.expires_at) > utcnow():
            raise HTTPException(
                status_code=409,
                detail=f"A hold is already placed for this job. Finish or cancel it at /pay/{job_id} before triggering again.",
            )
        logger.info(f"Lazy-expiring {job.status} for job {job_id} (cart expired)")
        try:
            await _enqueue_browser_close(job_id, redis)
        except Exception:
            logger.exception("Failed to enqueue browser close after hold expiry")

    job.status = JobStatus.CHECKING.value
    if job.enable_monitoring:
        job.next_check_at = utcnow() + timedelta(minutes=job.interval_minutes)
    session.add(job)
    await session.commit()

    queued = await redis.enqueue_job("check_availability", job_id, _job_id=_check_job_arq_id(job_id))
    return {"status": "already_queued" if queued is None else "enqueued", "job_id": job_id}


@router.post("/jobs/{job_id}/book", status_code=202)
async def book_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Dispatch the hold worker manually. Valid when last_result shows all sites
    AVAILABLE. Rejects partial availability and live holds."""
    job = await _get_owned_job(session, current_user.id, job_id)

    if not adapter_supports_automated_booking(job.adapter_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "This booking site does not support automated booking "
                "(sign-in is via third-party SSO). Book manually on the site."
            ),
        )

    if job.status in LIVE_HOLD_STATUSES:
        cart = await _latest_cart(session, job_id)
        if cart and cart.completed_at is None and as_utc(cart.expires_at) > utcnow():
            raise HTTPException(
                status_code=409,
                detail=f"A hold is already placed for this job. Finish or cancel it at /pay/{job_id} before booking again.",
            )
        try:
            await _enqueue_browser_close(job_id, redis)
        except Exception:
            logger.exception("Failed to enqueue browser close after hold expiry")

    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(status_code=409, detail="This job is already booked. Nothing to do.")

    params = json.loads(job.params)
    if not _params_have_occupants(params):
        raise HTTPException(status_code=409, detail="Occupants are required on this job before booking can start.")
    _validate_job_occupants_for_adapter(job.adapter_id, params)

    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    if not _job_has_required_credentials(job.adapter_id, configured_adapter_ids):
        raise HTTPException(status_code=409, detail="Stored booking credentials are required on this job before booking can start.")

    raw = json.loads(job.last_result) if job.last_result else None
    results = raw if isinstance(raw, list) else []
    if not results:
        raise HTTPException(status_code=409, detail="No recent availability for this job. Trigger a check first.")
    if not all(r.get("status") == "available" for r in results):
        raise HTTPException(
            status_code=409,
            detail="Not every site is fully available. Create a new watch job scoped to the partial site(s) to book those separately.",
        )

    job.status = JobStatus.CHECKING.value
    session.add(job)
    await session.commit()

    await redis.enqueue_job("attempt_hold_task", job_id, _queue_name=HOLD_QUEUE_NAME)
    return {"status": "enqueued", "job_id": job_id}
