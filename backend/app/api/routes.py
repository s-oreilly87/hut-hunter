import json
import logging
from datetime import timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from arq.connections import RedisSettings, create_pool

from app.api.auth import get_current_user
from app.core.adapter_credentials import (
    get_adapter_credential_record,
    get_user_configured_adapter_ids,
    upsert_user_adapter_credentials,
)
from app.core.config import settings
from app.core.database import get_session
from app.core.crypto import decrypt
from app.core.notification_settings import (
    get_user_notification_settings_read,
    upsert_user_notification_settings,
)
from app.models.credential import (
    AdapterCredential,
    AdapterCredentialRead,
    AdapterCredentialUpsert,
)
from app.models.job import (
    JobStatus,
    WatchJob,
    WatchJobCreate,
    WatchJobRead,
    WatchJobUpdate,
    as_optional_utc,
    as_utc,
    is_job_expired,
    utcnow,
)
from app.models.session import CartSession
from app.models.occupant import Occupant, OccupantCreate, OccupantRead, OccupantUpdate
from app.models.notification import (
    UserNotificationSettingsRead,
    UserNotificationSettingsUpdate,
)
from app.models.user import AppUser
from app.adapters import adapter_requires_credentials, list_adapters

# Minimum interval the UI should permit (matches the form's min=1). Enforced
# at the API layer as well so programmatic callers can't set e.g. 0 and cause
# the scheduler to hammer the adapter.
MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 120


def _clamp_interval(minutes: int | None) -> int:
    """Clamp interval_minutes to the [MIN, MAX] range; fall back to 15 if None."""
    if minutes is None:
        return 15
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, int(minutes)))


def _check_job_arq_id(job_id: str) -> str:
    """Stable ARQ job ID for dedup. ARQ rejects a second enqueue with the
    same `_job_id` while a job is pending or running — so this is our
    at-most-one-queued guarantee per watch job."""
    return f"check_availability:{job_id}"


def _params_have_occupants(params: dict) -> bool:
    occupants = params.get("occupants")
    return isinstance(occupants, list) and len(occupants) > 0



logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["jobs"])
# Top-level (non-prefixed) routes. /pay/{job_id} is linked from notification
# payloads, so it lives outside /api/v1 to keep the URL short and stable.
public_router = APIRouter(tags=["public"])

@router.get("/adapters")
async def get_adapters():
    return list_adapters()

# Jobs
async def get_redis():
    """Dependency — yields an ARQ redis connection."""
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        yield pool
    finally:
        await pool.aclose()


async def _serialize_job(
    session: AsyncSession,
    job: WatchJob,
    *,
    configured_adapter_ids: set[str] | None = None,
) -> WatchJobRead:
    cart = await _latest_cart(session, job.id)
    cart_expires_at = cart.expires_at if cart is not None else None
    if configured_adapter_ids is None:
        configured_adapter_ids = await get_user_configured_adapter_ids(session, job.user_id or "")
    try:
        needs_credentials = adapter_requires_credentials(job.adapter_id)
    except ValueError:
        needs_credentials = False
    credentials_configured = (
        True if not needs_credentials else job.adapter_id in configured_adapter_ids
    )
    return WatchJobRead.from_db(
        job,
        cart_expires_at=cart_expires_at,
        credentials_configured=credentials_configured,
    )


def _credential_record_to_read(
    credential: AdapterCredential,
) -> AdapterCredentialRead:
    return AdapterCredentialRead(
        id=credential.id,
        adapter_id=credential.adapter_id,
        username=decrypt(credential.encrypted_username),
        has_password=True,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


def _job_has_required_credentials(
    adapter_id: str,
    configured_adapter_ids: set[str],
) -> bool:
    try:
        return (
            not adapter_requires_credentials(adapter_id)
            or adapter_id in configured_adapter_ids
        )
    except ValueError:
        return True


async def _get_owned_job(
    session: AsyncSession,
    user_id: str,
    job_id: str,
) -> WatchJob:
    job = (
        await session.execute(
            select(WatchJob).where(
                WatchJob.id == job_id,
                WatchJob.user_id == user_id,
            )
        )
    ).scalars().first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _get_owned_occupant(
    session: AsyncSession,
    user_id: str,
    occupant_id: str,
) -> Occupant:
    occupant = (
        await session.execute(
            select(Occupant).where(
                Occupant.id == occupant_id,
                Occupant.user_id == user_id,
            )
        )
    ).scalars().first()
    if occupant is None:
        raise HTTPException(status_code=404, detail="Occupant not found")
    return occupant


@router.get("/jobs", response_model=List[WatchJobRead])
async def list_jobs(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    result = await session.execute(
        select(WatchJob).where(WatchJob.user_id == current_user.id)
    )
    jobs = result.scalars().all()
    return [
        await _serialize_job(
            session,
            job,
            configured_adapter_ids=configured_adapter_ids,
        )
        for job in jobs
    ]


@router.post("/jobs", response_model=WatchJobRead, status_code=201)
async def create_job(
    body: WatchJobCreate,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Create a new watch job.

    When enable_monitoring=true, the job also gets dispatched immediately
    (via ARQ with a dedup'd _job_id) so the user sees a first check without
    waiting for the next scheduler tick, and next_check_at is set so the
    scheduler will enqueue again on the configured cadence."""
    interval = _clamp_interval(body.interval_minutes)
    now = utcnow()
    monitoring = body.enable_monitoring
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    if body.auto_book and not _params_have_occupants(body.params):
        raise HTTPException(
            status_code=409,
            detail="Occupants are required before auto-book can be enabled.",
        )
    if body.auto_book and not _job_has_required_credentials(
        body.adapter_id,
        configured_adapter_ids,
    ):
        raise HTTPException(
            status_code=409,
            detail="Stored booking credentials are required before auto-book can be enabled.",
        )

    job = WatchJob(
        user_id=current_user.id,
        name=body.name,
        adapter_id=body.adapter_id,
        params=json.dumps(body.params),
        auto_book=body.auto_book,
        enable_monitoring=monitoring,
        interval_minutes=interval,
        # With monitoring on, schedule the *next* check one interval out. The
        # immediate enqueue below covers the first run without relying on the
        # scheduler tick.
        next_check_at=(now + timedelta(minutes=interval)) if monitoring else None,
        # When monitoring is on we immediately dispatch a first check (below),
        # so start in CHECKING — mirrors trigger_job and the monitoring-on
        # path in update_job. The scheduler only ever sees WAITING, so using
        # CHECKING here prevents it from double-dispatching before the first
        # check completes. Jobs created without monitoring start PAUSED.
        status=JobStatus.CHECKING.value if monitoring else JobStatus.PAUSED.value,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    if monitoring:
        # Fire the first check now. _job_id dedups against later scheduler
        # ticks if they happen to coincide.
        try:
            await redis.enqueue_job(
                "check_availability",
                job.id,
                _job_id=_check_job_arq_id(job.id),
            )
        except Exception:
            # Enqueue failure is non-fatal for creation — the scheduler will
            # pick it up on the next tick. Log and move on.
            logger.exception(
                f"Failed to enqueue first check for new job {job.id}"
            )

    return await _serialize_job(
        session,
        job,
        configured_adapter_ids=configured_adapter_ids,
    )


@router.get("/jobs/{job_id}", response_model=WatchJobRead)
async def get_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    job = await _get_owned_job(session, current_user.id, job_id)
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    return await _serialize_job(
        session,
        job,
        configured_adapter_ids=configured_adapter_ids,
    )


@router.patch("/jobs/{job_id}", response_model=WatchJobRead)
async def update_job(
    job_id: str,
    body: WatchJobUpdate,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Partial update — name, params, auto_book, enable_monitoring,
    interval_minutes are mutable. Editing params invalidates the cached
    last_result / last_checked_at, since those were captured against the old
    search. adapter_id is immutable; change adapters by deleting and
    recreating the job.

    Monitoring transitions:
      • toggle OFF     → clear next_check_at; keep current status unless
                         WAITING (move to PAUSED).
      • toggle ON      → schedule next check immediately and enqueue a first
                         check now (dedup'd via _job_id).
      • interval change (monitoring already on) → reschedule next_check_at
                         to now + new_interval so the cadence restarts cleanly.
    """
    job = await _get_owned_job(session, current_user.id, job_id)

    # exclude_unset so clients can send just the keys they want to change
    patch = body.model_dump(exclude_unset=True)
    next_params = patch["params"] if "params" in patch else json.loads(job.params)
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)

    if "name" in patch:
        job.name = patch["name"]
    if "auto_book" in patch:
        if patch["auto_book"] and not _params_have_occupants(next_params):
            raise HTTPException(
                status_code=409,
                detail="Occupants are required before auto-book can be enabled.",
            )
        if patch["auto_book"] and not _job_has_required_credentials(
            job.adapter_id,
            configured_adapter_ids,
        ):
            raise HTTPException(
                status_code=409,
                detail="Stored booking credentials are required before auto-book can be enabled.",
            )
        job.auto_book = patch["auto_book"]
    if "params" in patch:
        job.params = json.dumps(patch["params"])
        if not _params_have_occupants(patch["params"]):
            job.auto_book = False
        # The previous result was against different params — drop it so the UI
        # doesn't show stale availability alongside the new config.
        job.last_result = None
        job.last_checked_at = None
        job.last_artifact = None
        job.artifact_history = None

    # Monitoring changes — capture the "before" state first so we can detect
    # OFF→ON transitions and interval changes precisely.
    prev_monitoring = job.enable_monitoring
    prev_interval = job.interval_minutes

    if "interval_minutes" in patch:
        job.interval_minutes = _clamp_interval(patch["interval_minutes"])
    if "enable_monitoring" in patch:
        job.enable_monitoring = bool(patch["enable_monitoring"])

    now = utcnow()
    dispatch_now = False

    if job.enable_monitoring and not prev_monitoring:
        # OFF → ON. Fire a check immediately; set next_check_at out one
        # interval so scheduler doesn't double-dispatch if the check runs
        # long. Flip status to CHECKING (mirroring trigger_job) rather than
        # WAITING — this gives the user visible "Checking…" feedback during
        # the run, and ensures check_availability's completion handler
        # (which only fires on status=CHECKING) resets next_check_at fresh
        # from when the check finishes instead of when the toggle clicked.
        # HOLD_PLACED / CHECKING / terminal states are left alone: a check
        # there would either dedup or be inappropriate.
        job.next_check_at = now + timedelta(minutes=job.interval_minutes)
        if job.status in (JobStatus.PAUSED.value, JobStatus.CANCELLED.value):
            job.status = JobStatus.CHECKING.value
            dispatch_now = True
        elif job.status == JobStatus.WAITING.value:
            # Rare — WAITING with monitoring-off shouldn't happen in steady
            # state, but if it does, dispatch a check without disturbing the
            # status (check_availability accepts WAITING as a runnable state).
            dispatch_now = True
    elif not job.enable_monitoring and prev_monitoring:
        # ON → OFF. Stop the scheduler; drop WAITING back to PAUSED so the
        # UI doesn't show "Waiting" with no countdown.
        job.next_check_at = None
        if job.status == JobStatus.WAITING.value:
            job.status = JobStatus.PAUSED.value
    elif job.enable_monitoring and job.interval_minutes != prev_interval:
        # Interval changed while monitoring is on. Reschedule cleanly from
        # "now" so the user doesn't get a surprise immediate dispatch just
        # because they nudged the interval down.
        job.next_check_at = now + timedelta(minutes=job.interval_minutes)

    session.add(job)
    await session.commit()
    await session.refresh(job)

    if dispatch_now:
        try:
            await redis.enqueue_job(
                "check_availability",
                job.id,
                _job_id=_check_job_arq_id(job.id),
            )
        except Exception:
            logger.exception(
                f"Failed to enqueue immediate check on monitoring-enable for {job.id}"
            )

    return await _serialize_job(
        session,
        job,
        configured_adapter_ids=configured_adapter_ids,
    )


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Delete a job and any cart sessions attached to it.

    If the job is HOLD_PLACED with a live cart we ALSO fire the browser-close
    signal so the headed Chromium holding the reservation gets torn down — no
    point leaving a worker pinned to a job that no longer exists. The DB
    delete proceeds regardless; the close signal is best-effort."""
    job = await _get_owned_job(session, current_user.id, job_id)

    had_live_hold = job.status == JobStatus.HOLD_PLACED.value

    # CartSession.job_id has no FK cascade, so prune by hand.
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
            # Non-fatal — the worker will notice the job is gone on its next
            # tick regardless.
            logger.exception("Failed to enqueue browser close after delete")

    return None


@router.post("/jobs/{job_id}/trigger", status_code=202)
async def trigger_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Manually enqueue a check for this job.

    Transitions the job into CHECKING and enqueues check_availability. If
    the job is already HOLD_PLACED and the cart hasn't expired, reject with
    409 — the user should finish or cancel the current hold via /pay first.
    Expired HOLD_PLACED is treated as CHECKING (lazy expiry)."""
    job = await _get_owned_job(session, current_user.id, job_id)

    # Block triggers on expired jobs (adapter's booking cutoff has passed).
    params = json.loads(job.params)
    if is_job_expired(job.adapter_id, params):
        raise HTTPException(
            status_code=409,
            detail="This job's start date has passed — it cannot be triggered.",
        )

    if job.status == JobStatus.HOLD_PLACED.value:
        cart = await _latest_cart(session, job_id)
        cart_still_live = (
            cart is not None
            and cart.completed_at is None
            and as_utc(cart.expires_at) > utcnow()
        )
        if cart_still_live:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A hold is already placed for this job. Finish or cancel "
                    f"it at /pay/{job_id} before triggering again."
                ),
            )
        # Lazy expiry: hold timed out without explicit signal. Flip back.
        logger.info(f"Lazy-expiring HOLD_PLACED for job {job_id} (cart expired)")
        try:
            await _enqueue_browser_close(job_id, redis)
        except Exception:
            logger.exception("Failed to enqueue browser close after hold expiry")

    job.status = JobStatus.CHECKING.value
    # If monitoring is enabled, push the next scheduled check one interval
    # out — the manual trigger already provides the "now" run so the
    # scheduler shouldn't fire again immediately after.
    if job.enable_monitoring:
        job.next_check_at = utcnow() + timedelta(minutes=job.interval_minutes)
    session.add(job)
    await session.commit()

    # Dedup: if a check is already queued or running for this job, ARQ
    # returns None and we treat that as success. Prevents double-runs from
    # spam-clicks or scheduler-vs-manual races.
    queued = await redis.enqueue_job(
        "check_availability",
        job_id,
        _job_id=_check_job_arq_id(job_id),
    )
    deduped = queued is None
    return {
        "status": "already_queued" if deduped else "enqueued",
        "job_id": job_id,
    }


@router.post("/jobs/{job_id}/book", status_code=202)
async def book_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Manually dispatch the hold worker for this job.

    Used for two cases:
      1. auto_book=False: user sees full availability in the UI and clicks
         "Book Now" to hand off to the headed browser.
      2. auto_book=True but they missed the notification / retriggered.

    Only valid when last_result shows every site AVAILABLE — partial
    availability can't be booked in a single DOC cart (different party sizes
    per night), so the caller is expected to create a new, scoped watch job
    and Book that instead. Rejects HOLD_PLACED with a live cart so two
    concurrent holds don't fight over the hold-queue worker.
    """
    from app.workers.tasks import HOLD_QUEUE_NAME

    job = await _get_owned_job(session, current_user.id, job_id)

    if job.status == JobStatus.HOLD_PLACED.value:
        cart = await _latest_cart(session, job_id)
        cart_still_live = (
            cart is not None
            and cart.completed_at is None
            and as_utc(cart.expires_at) > utcnow()
        )
        if cart_still_live:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A hold is already placed for this job. Finish or cancel "
                    f"it at /pay/{job_id} before booking again."
                ),
            )
        # Lazy expiry — fall through, we'll flip to CHECKING below.
        try:
            await _enqueue_browser_close(job_id, redis)
        except Exception:
            logger.exception("Failed to enqueue browser close after hold expiry")

    if job.status == JobStatus.BOOKING_COMPLETE.value:
        raise HTTPException(
            status_code=409,
            detail="This job is already booked. Nothing to do.",
        )

    params = json.loads(job.params)
    if not _params_have_occupants(params):
        raise HTTPException(
            status_code=409,
            detail="Occupants are required on this job before booking can start.",
        )
    configured_adapter_ids = await get_user_configured_adapter_ids(session, current_user.id)
    if not _job_has_required_credentials(job.adapter_id, configured_adapter_ids):
        raise HTTPException(
            status_code=409,
            detail="Stored booking credentials are required on this job before booking can start.",
        )

    # Safety gate: require every site in the most recent check to be fully
    # available. Anything else (partial / unavailable / never checked)
    # indicates the caller is booking against stale or partial state.
    raw = json.loads(job.last_result) if job.last_result else None
    results = raw if isinstance(raw, list) else []
    if not results:
        raise HTTPException(
            status_code=409,
            detail=(
                "No recent availability for this job. Trigger a check first."
            ),
        )
    if not all(r.get("status") == "available" for r in results):
        raise HTTPException(
            status_code=409,
            detail=(
                "Not every site is fully available. Create a new watch job "
                "scoped to the partial site(s) to book those separately."
            ),
        )

    job.status = JobStatus.CHECKING.value
    session.add(job)
    await session.commit()

    await redis.enqueue_job(
        "attempt_hold_task",
        job_id,
        _queue_name=HOLD_QUEUE_NAME,
    )
    return {"status": "enqueued", "job_id": job_id}


# ---------------------------------------------------------------------------
# Booking credentials — encrypted per-user adapter logins
# ---------------------------------------------------------------------------

@router.get("/credentials", response_model=list[AdapterCredentialRead])
async def list_credentials(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    result = await session.execute(
        select(AdapterCredential)
        .where(AdapterCredential.user_id == current_user.id)
        .order_by(AdapterCredential.adapter_id)
    )
    return [_credential_record_to_read(credential) for credential in result.scalars().all()]


@router.put("/credentials/{adapter_id}", response_model=AdapterCredentialRead)
async def upsert_credential(
    adapter_id: str,
    body: AdapterCredentialUpsert,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    try:
        if not adapter_requires_credentials(adapter_id):
            raise HTTPException(
                status_code=400,
                detail="This adapter does not use stored booking credentials.",
            )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        credential = await upsert_user_adapter_credentials(
            session,
            user_id=current_user.id,
            adapter_id=adapter_id,
            username=body.username,
            password=body.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _credential_record_to_read(credential)


@router.delete("/credentials/{adapter_id}", status_code=204)
async def delete_credential(
    adapter_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    credential = await get_adapter_credential_record(session, current_user.id, adapter_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="Credential not found")
    await session.delete(credential)
    await session.commit()
    return None


# ---------------------------------------------------------------------------
# Notification settings — encrypted per-user email/Gotify delivery targets
# ---------------------------------------------------------------------------

@router.get("/notifications", response_model=UserNotificationSettingsRead)
async def get_notification_settings(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    return await get_user_notification_settings_read(session, current_user.id)


@router.put("/notifications", response_model=UserNotificationSettingsRead)
async def update_notification_settings(
    body: UserNotificationSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    try:
        await upsert_user_notification_settings(
            session,
            user_id=current_user.id,
            email_enabled=body.email_enabled,
            email_address=body.email_address,
            gotify_enabled=body.gotify_enabled,
            gotify_url=body.gotify_url,
            gotify_token=body.gotify_token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await get_user_notification_settings_read(session, current_user.id)


# ---------------------------------------------------------------------------
# Booking completion signals from the /pay page
# ---------------------------------------------------------------------------
# /complete  -> status=BOOKING_COMPLETE (terminal), stamp cart.completed_at,
#               close browser.
# /cancel    -> status=CANCELLED (terminal-ish; user can re-trigger),
#               stamp cart.completed_at (the hold is unrecoverable once the
#               browser is gone, so there's no reason to keep the cart as
#               "active"), close browser.
#
# Both stamp completed_at because in either case the browser is being torn
# down and the cart cookies are abandoned — there is no path back to the
# checkout page without re-holding. Leaving the cart "active" would only
# block other workers pointlessly. If the user re-triggers a cancelled job
# while the DOC site's cart still exists on their side, the adapter will
# hit a "you already have a cart" state; that's a recoverable case and not
# worth preventing here.
#
# close_browser_task runs on the hold queue and is idempotent — double
# clicks just enqueue a second no-op close.

async def _enqueue_browser_close(job_id: str, redis) -> None:
    """Ask the hold worker to tear down the headed Chromium for this job.
    Fire-and-forget — the task is a no-op if the browser is already gone."""
    from app.workers.tasks import HOLD_QUEUE_NAME
    await redis.enqueue_job(
        "close_browser_task",
        job_id,
        _queue_name=HOLD_QUEUE_NAME,
    )


async def _enqueue_complete_snapshot(job_id: str, redis) -> None:
    """Capture a snapshot of the booking-complete page before the browser is
    torn down. Must be enqueued *before* close_browser_task — the hold queue
    runs FIFO with max_jobs=1, so enqueue order determines run order. A no-op
    if the browser is already gone."""
    from app.workers.tasks import HOLD_QUEUE_NAME
    await redis.enqueue_job(
        "snapshot_complete_task",
        job_id,
        _queue_name=HOLD_QUEUE_NAME,
    )


async def _latest_cart(session: AsyncSession, job_id: str) -> CartSession | None:
    return (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .order_by(CartSession.created_at.desc())
    )).scalars().first()


async def _finalize_hold(
    session: AsyncSession,
    user_id: str,
    job_id: str,
    new_status: JobStatus,
) -> WatchJob:
    """Shared body of /complete and /cancel — both flip the job into a
    terminal status, stamp the cart as completed, and commit. The caller
    separately enqueues the browser close."""
    job = await _get_owned_job(session, user_id, job_id)

    cart = await _latest_cart(session, job_id)
    if not cart:
        raise HTTPException(status_code=404, detail="No cart session for this job")

    if cart.completed_at is None:
        cart.completed_at = utcnow()
        session.add(cart)

    if job.status != new_status.value:
        job.status = new_status.value
        session.add(job)

    await session.commit()
    return job


@router.post("/jobs/{job_id}/complete", status_code=200)
async def complete_booking(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """User pressed 'Booking Complete' on /pay. Job goes to BOOKING_COMPLETE
    (terminal — no reason to keep watching a hut already booked).

    Enqueues a receipt snapshot before the browser close so the user ends up
    with a screenshot of the confirmation page linked on the JobCard."""
    await _finalize_hold(session, current_user.id, job_id, JobStatus.BOOKING_COMPLETE)
    await _enqueue_complete_snapshot(job_id, redis)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "completed", "job_id": job_id}


@router.post("/jobs/{job_id}/cancel", status_code=200)
async def cancel_booking(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """User pressed 'Cancel' on /pay. Job goes to CANCELLED — polling is
    halted; the user can re-trigger later to resume checking."""
    await _finalize_hold(session, current_user.id, job_id, JobStatus.CANCELLED)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "cancelled", "job_id": job_id}


# ---------------------------------------------------------------------------
# Occupants — saved roster of travellers for reuse across jobs
# ---------------------------------------------------------------------------

@router.get("/occupants", response_model=list[OccupantRead])
async def list_occupants(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    result = await session.execute(
        select(Occupant)
        .where(Occupant.user_id == current_user.id)
        .order_by(Occupant.created_at)
    )
    return result.scalars().all()


@router.post("/occupants", response_model=OccupantRead, status_code=201)
async def create_occupant(
    body: OccupantCreate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupant = Occupant(user_id=current_user.id, **body.model_dump())
    session.add(occupant)
    await session.commit()
    await session.refresh(occupant)
    return occupant


@router.patch("/occupants/{occupant_id}", response_model=OccupantRead)
async def update_occupant(
    occupant_id: str,
    body: OccupantUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupant = await _get_owned_occupant(session, current_user.id, occupant_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(occupant, field, value)
    session.add(occupant)
    await session.commit()
    await session.refresh(occupant)
    return occupant


@router.delete("/occupants/{occupant_id}", status_code=204)
async def delete_occupant(
    occupant_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupant = await _get_owned_occupant(session, current_user.id, occupant_id)
    await session.delete(occupant)
    await session.commit()
    return None


@router.get("/jobs/{job_id}/resume")
async def resume_cart(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    await _get_owned_job(session, current_user.id, job_id)
    # Multiple cart sessions may exist per job if attempt_hold ran more than once;
    # always use the most recent.
    cart = (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .order_by(CartSession.created_at.desc())
    )).scalars().first()

    if not cart:
        return HTMLResponse("<h1>No cart session found for this job</h1>", status_code=404)

    cart_expires_at = as_utc(cart.expires_at)
    if cart_expires_at < utcnow():
        return HTMLResponse("<h1>Cart session has expired</h1>", status_code=410)

    cookies = json.loads(decrypt(cart.encrypted_cookies))

    # Build cookie JS using json.dumps for safe string escaping
    cookie_scripts = []
    for c in cookies:
        name = json.dumps(c["name"])
        value = json.dumps(c["value"])
        domain = json.dumps(c.get("domain", ""))
        path = json.dumps(c.get("path", "/"))
        cookie_scripts.append(
            f'document.cookie = {name} + "=" + {value} + "; domain=" + {domain} + "; path=" + {path};'
        )

    cookie_js = "\n".join(cookie_scripts)
    cart_url = json.dumps(cart.cart_url)

    html = f"""<!DOCTYPE html>
<html>
<head><title>Resuming booking...</title></head>
<body>
    <p>Resuming your booking session...</p>
    <script>
        {cookie_js}
        window.location.href = {cart_url};
    </script>
</body>
</html>"""

    return HTMLResponse(html)


@public_router.get("/pay/{job_id}")
async def pay(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    """
    Pay page — embedded noVNC iframe showing the headed Chromium running in
    the hold worker, already parked on the checkout/payment form. Only renders
    the iframe when the job is HOLD_PLACED and the cart is still within its
    25-minute window.
    """
    job = await _get_owned_job(session, current_user.id, job_id)

    cart = await _latest_cart(session, job_id)

    # Status-first: if the job isn't HOLD_PLACED, there's nothing to show.
    if job.status == JobStatus.BOOKING_COMPLETE.value:
        return HTMLResponse(
            "<h1>Booking complete</h1>"
            "<p>This booking was already marked complete.</p>",
            status_code=410,
        )
    if job.status == JobStatus.CANCELLED.value:
        return HTMLResponse(
            "<h1>Hold cancelled</h1>"
            "<p>This hold was cancelled. Re-trigger the job from the dashboard "
            "to resume checking.</p>",
            status_code=410,
        )
    if job.status != JobStatus.HOLD_PLACED.value:
        return HTMLResponse(
            f"<h1>No active hold</h1>"
            f"<p>Job status is '<b>{job.status}</b>'. A hold has to be placed "
            f"before there's a payment page to show.</p>",
            status_code=404,
        )

    if not cart:
        return HTMLResponse(
            "<h1>No cart session for this job</h1>",
            status_code=404,
        )

    cart_expires_at = as_utc(cart.expires_at)
    if cart_expires_at < utcnow():
        # Hold_placed but the cart timed out — the status will get lazily
        # flipped back to CHECKING next time the job is triggered.
        return HTMLResponse(
            "<h1>Hold expired</h1>"
            "<p>The 25-minute cart window has closed. Re-trigger the job to hold again.</p>",
            status_code=410,
        )

    # noVNC's vnc_lite.html accepts connection details as query params so we
    # can just point the iframe at the right URL and let it auto-connect.
    # autoconnect=1 skips the splash screen; resize=remote asks the noVNC
    # client to tell the server to match the iframe size.
    vnc_base = settings.vnc_url.rstrip("/")
    vnc_embed_url = f"{vnc_base}/vnc_lite.html?autoconnect=1&resize=remote"

    # Minutes remaining until hold expires (displayed in the header).
    seconds_left = int((cart_expires_at - utcnow()).total_seconds())
    minutes_left = max(0, seconds_left // 60)

    # How many pixels of the iframe to crop off the top. Chromium's tab strip
    # (~36px) + omnibox (~44px) ≈ 80px on a default 1280x800 display. Tweak
    # this if the chrome gets taller/shorter.
    chrome_crop_px = 80

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Complete your booking</title>
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111;
      color: #eee;
    }}
    body {{
      display: flex;
      flex-direction: column;
      height: 100vh;
    }}
    header {{
      padding: 10px 16px;
      background: #1b1b1b;
      border-bottom: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex: 0 0 auto;
    }}
    header .left {{ font-weight: 600; }}
    header .right {{ color: #9cd; font-size: 0.9em; }}

    /* The VNC iframe is cropped from the top to hide the remote Chromium's
       address bar / tab strip. The wrapper clips overflow and the iframe is
       shifted up by `chrome_crop_px` and grown by the same amount so the
       bottom still lines up. */
    .vnc-frame {{
      position: relative;
      overflow: hidden;
      flex: 1 1 auto;
      background: #000;
      min-height: 0;
    }}
    .vnc-frame iframe {{
      position: absolute;
      left: 0;
      width: 100%;
      top: -{chrome_crop_px}px;
      height: calc(100% + {chrome_crop_px}px);
      border: 0;
      display: block;
      background: #000;
    }}

    .actions {{
      flex: 0 0 auto;
      display: flex;
      gap: 12px;
      padding: 14px 16px;
      background: #1b1b1b;
      border-top: 1px solid #333;
    }}
    .actions button {{
      flex: 1 1 0;
      padding: 18px 24px;
      font-size: 1.15rem;
      font-weight: 600;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      color: white;
      transition: filter 0.1s ease-in-out;
    }}
    .actions button:hover:not(:disabled) {{ filter: brightness(1.1); }}
    .actions button:disabled {{ opacity: 0.5; cursor: default; }}
    .actions .cancel {{ background: #b33a3a; }}
    .actions .complete {{ background: #2f8f3f; }}

    .banner {{
      flex: 0 0 auto;
      padding: 8px 16px;
      background: #3a2f14;
      color: #ffd58a;
      font-size: 0.85em;
      border-bottom: 1px solid #5a4820;
      line-height: 1.4;
    }}
    .banner strong {{ color: #ffe8b0; }}

    #status {{
      flex: 0 0 auto;
      padding: 10px 16px;
      background: #222;
      font-size: 0.9em;
      color: #aaa;
      border-top: 1px solid #333;
      min-height: 1.2em;
    }}
    #status.ok {{ color: #9be89b; }}
    #status.err {{ color: #f08a8a; }}
  </style>
</head>
<body>
  <header>
    <div class="left">Hut Hunter — complete your booking</div>
    <div class="right">Hold expires in ~{minutes_left} min</div>
  </header>

  <div class="banner">
    <strong>Heads up:</strong>
    click <strong>Booking Complete</strong> after you've paid — the job moves
    to <em>Booking Complete</em> and polling stops. Clicking
    <strong>Cancel</strong> closes the browser and moves the job to
    <em>Cancelled</em>; re-trigger it later to resume checking. Closing this
    tab without clicking either leaves the hold in limbo.
  </div>

  <div class="vnc-frame">
    <iframe src="{vnc_embed_url}" allow="clipboard-read; clipboard-write"></iframe>
  </div>

  <div class="actions">
    <button class="cancel" id="btn-cancel" type="button">Cancel</button>
    <button class="complete" id="btn-complete" type="button">Booking Complete</button>
  </div>
  <div id="status"></div>

  <script>
    const jobId = {json.dumps(job_id)};
    const status = document.getElementById('status');
    const btnCancel = document.getElementById('btn-cancel');
    const btnComplete = document.getElementById('btn-complete');

    // Set once the user has clicked Cancel or Booking Complete — at that
    // point the browser-close signal is already in flight and closing the
    // tab is fine, so we suppress the beforeunload prompt.
    let signaled = false;

    async function post(action, confirmMsg) {{
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      btnCancel.disabled = true;
      btnComplete.disabled = true;
      status.className = '';
      status.textContent = 'Working…';
      try {{
        const res = await fetch(`/api/v1/jobs/${{jobId}}/${{action}}`, {{ method: 'POST' }});
        if (!res.ok) throw new Error(`HTTP ${{res.status}}`);
        await res.json();
        signaled = true;
        status.className = 'ok';
        status.textContent = action === 'complete'
          ? 'Booking marked complete. Browser closing, job moved to Booking Complete. Safe to close this tab.'
          : 'Hold cancelled. Browser closing, job moved to Cancelled. Re-trigger the job from the dashboard to resume checking.';
      }} catch (e) {{
        status.className = 'err';
        status.textContent = 'Failed: ' + e.message;
        btnCancel.disabled = false;
        btnComplete.disabled = false;
      }}
    }}

    btnCancel.addEventListener('click', () => post('cancel',
      'Cancel this hold?\\n\\n' +
      'The browser will close and the job will move to "Cancelled". ' +
      'Re-trigger it later to resume checking.'));
    btnComplete.addEventListener('click', () => post('complete',
      'Mark this booking as complete?\\n\\n' +
      'The browser will close and the job will move to ' +
      '"Booking Complete". Polling will stop for this job.'));

    // Warn if the user tries to close/reload before signaling. Modern
    // browsers show a generic "Changes may not be saved" dialog — returning
    // any truthy string is enough to trigger it. This is best-effort: some
    // browsers (esp. mobile) ignore this entirely.
    window.addEventListener('beforeunload', (e) => {{
      if (signaled) return;
      const msg =
        'Closing now leaves the hold in limbo. Click Cancel or ' +
        'Booking Complete so Hut Hunter knows what to do with this job.';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }});
  </script>
</body>
</html>"""

    return HTMLResponse(html)
