"""Job CRUD routes: list, create, get, update, delete, trigger, book."""

import json
import logging
from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.auth import get_current_user
from app.api._route_deps import (
    _clamp_interval,
    _delete_job_artifacts,
    _enqueue_browser_close,
    _get_owned_job,
    _job_has_required_credentials,
    _latest_cart,
    _serialize_job,
    _validate_job_occupants_for_adapter,
    get_redis,
)
from app.core.adapter_credentials import get_user_configured_adapter_ids
from app.core.database import get_session
from app.models.job import (
    JobStatus,
    WatchJob,
    WatchJobCreate,
    WatchJobRead,
    WatchJobUpdate,
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


@router.get("/jobs", response_model=List[WatchJobRead])
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

    if body.auto_book and not _params_have_occupants(body.params):
        raise HTTPException(status_code=409, detail="Occupants are required before auto-book can be enabled.")
    if body.auto_book and not _job_has_required_credentials(body.adapter_id, configured_adapter_ids):
        raise HTTPException(status_code=409, detail="Stored booking credentials are required before auto-book can be enabled.")
    if _params_have_occupants(body.params):
        _validate_job_occupants_for_adapter(body.adapter_id, body.params)

    monitoring = body.enable_monitoring
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
      • Interval change (monitoring on) — reschedule next_check_at from now.
    """
    job = await _get_owned_job(session, current_user.id, job_id)
    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(status_code=403, detail="Completed bookings are locked and cannot be edited.")

    patch = body.model_dump(exclude_unset=True)
    next_params = patch["params"] if "params" in patch else json.loads(job.params)
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)

    if "params" in patch and _params_have_occupants(next_params):
        _validate_job_occupants_for_adapter(job.adapter_id, next_params)

    if "name" in patch:
        job.name = patch["name"]

    if "auto_book" in patch:
        if patch["auto_book"] and not _params_have_occupants(next_params):
            raise HTTPException(status_code=409, detail="Occupants are required before auto-book can be enabled.")
        if patch["auto_book"] and not _job_has_required_credentials(job.adapter_id, configured_adapter_ids):
            raise HTTPException(status_code=409, detail="Stored booking credentials are required before auto-book can be enabled.")
        if patch["auto_book"]:
            _validate_job_occupants_for_adapter(job.adapter_id, next_params)
        job.auto_book = patch["auto_book"]

    if "params" in patch:
        job.params = json.dumps(patch["params"])
        if not _params_have_occupants(patch["params"]):
            job.auto_book = False
        job.last_result = None
        job.last_checked_at = None
        job.last_artifact = None
        job.artifact_history = None

    prev_monitoring = job.enable_monitoring
    prev_interval = job.interval_minutes

    if "interval_minutes" in patch:
        job.interval_minutes = _clamp_interval(patch["interval_minutes"])
    if "enable_monitoring" in patch:
        job.enable_monitoring = bool(patch["enable_monitoring"])

    now = utcnow()
    dispatch_now = False

    if job.enable_monitoring and not prev_monitoring:
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
    elif job.enable_monitoring and job.interval_minutes != prev_interval:
        # Interval changed while monitoring is on
        job.next_check_at = now + timedelta(minutes=job.interval_minutes)

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
    """Delete a job and its carts. If HOLD_PLACED, also signals the hold
    worker to close the headed browser (best-effort)."""
    job = await _get_owned_job(session, current_user.id, job_id)
    had_live_hold = job.status == JobStatus.HOLD_PLACED.value
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
    Expired HOLD_PLACED (no live cart) is lazily flipped back to CHECKING."""
    job = await _get_owned_job(session, current_user.id, job_id)

    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(status_code=409, detail="This job is already booked and cannot be triggered again.")

    params = json.loads(job.params)
    if is_job_expired(job.adapter_id, params):
        raise HTTPException(status_code=409, detail="This job's start date has passed — it cannot be triggered.")

    if job.status == JobStatus.HOLD_PLACED.value:
        cart = await _latest_cart(session, job_id)
        if cart and cart.completed_at is None and as_utc(cart.expires_at) > utcnow():
            raise HTTPException(
                status_code=409,
                detail=f"A hold is already placed for this job. Finish or cancel it at /pay/{job_id} before triggering again.",
            )
        logger.info(f"Lazy-expiring HOLD_PLACED for job {job_id} (cart expired)")
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

    if job.status == JobStatus.HOLD_PLACED.value:
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
