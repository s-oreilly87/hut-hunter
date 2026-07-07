"""Poll worker — availability checking, scheduler, and WorkerSettings."""

import json
import logging
from datetime import timedelta
from typing import cast

from arq import cron
from arq.connections import RedisSettings

from app.adapters.base import AvailabilityStatus
from app.adapters import (
    adapter_requires_credentials,
    adapter_supports_automated_booking,
    get_adapter,
)
from app.core.adapter_credentials import get_adapter_credential_record, get_user_adapter_credentials
from app.models.credential import CredentialVerificationState
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.notification_settings import get_user_notification_settings_secret
from app.core.notify import dispatch_notification_targets
from app.models.job import JobStatus, WatchJob, is_job_expired, utcnow
from sqlmodel import select

from app.workers._shared import (
    UNAVAILABLE_SNAPSHOT_LABEL,
    WINDOW_BURST_MINUTES,
    _browser_page,
    _check_job_arq_id,
    _clear_unavailable_snapshot,
    _consume_adapter_artifacts,
    _effective_interval_minutes,
    _get_active_cart,
    _latest_artifact_base,
    _params_have_occupants,
    _remove_hold_artifacts_from_job,
    _resolve_lazy_expired_hold,
    _save_artifacts,
    _save_error,
    _set_status,
    _snapshot_safe,
    _was_previously_partial,
    startup,
)
from app.workers.hold_worker import HOLD_QUEUE_NAME

logger = logging.getLogger(__name__)


async def check_availability(ctx: dict, job_id: str) -> dict:
    """Poll task. Headless detect only; if auto_book and fully available,
    enqueues attempt_hold_task on the hold queue and returns immediately."""
    logger.info(f"Checking availability for job {job_id}")

    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if not job:
            logger.warning(f"Job {job_id} not found")
            return {"error": "job not found"}
        params = json.loads(job.params)
        logger.info(f"Params: {params}")

        try:
            adapter = get_adapter(job.adapter_id)
        except ValueError as e:
            logger.error(f"Unknown adapter: {e}")
            await _set_status(session, job, JobStatus.PAUSED)
            await _save_error(job_id, str(e))
            return {"error": str(e)}

        if is_job_expired(job.adapter_id, params):
            logger.info(f"Job {job_id} is expired, skipping")
            return {"job_id": job_id, "status": "skipped_expired"}

        await _resolve_lazy_expired_hold(session, job)
        if job.status not in (JobStatus.CHECKING.value, JobStatus.WAITING.value):
            logger.info(f"Skipping check for job {job_id}: status={job.status}")
            return {"job_id": job_id, "status": f"skipped_{job.status}"}

        auto_book = job.auto_book
        user_credentials = await get_user_adapter_credentials(session, job.user_id or "", job.adapter_id)
        credential_record = await get_adapter_credential_record(session, job.user_id or "", job.adapter_id)
        # THR-126: keys off verification_status, not the legacy is_verified
        # boolean — INCONCLUSIVE/PENDING must not be treated as failed.
        credential_failed = (
            credential_record is not None
            and credential_record.verification_status == CredentialVerificationState.FAILED.value
        )
        # THR-123: a credential that failed verification is treated as no
        # usable credential at all — same gate as missing credentials.
        credentials_configured = (
            not adapter_requires_credentials(job.adapter_id)
            or (user_credentials is not None and not credential_failed)
        )
        notification_settings = await get_user_notification_settings_secret(session, job.user_id or "")
        # Snapshot the previous result to suppress repeat partial notifications
        # (we only alert when status *changes* to partial, not on every check).
        prev_last_result: str | None = job.last_result

    await _clear_unavailable_snapshot(job_id)

    # --- Detect phase (headless) ---
    results = []
    try:
        async with _browser_page(headless=settings.browser_headless_detect) as (page, _keep_alive):
            try:
                await adapter.fill_form(page, params)
                results = await adapter.detect_availability(page, params)
                logger.info(f"Detect results for job {job_id}: {results}")
                if results and all(r.status == AvailabilityStatus.UNAVAILABLE for r in results):
                    base = await _snapshot_safe(adapter, page, UNAVAILABLE_SNAPSHOT_LABEL)
                    await _save_artifacts(job_id, _consume_adapter_artifacts(adapter), last_base=base)
            except Exception as e:
                base = await _snapshot_safe(adapter, page, f"detect_error_{type(e).__name__}")
                await _save_artifacts(
                    job_id, _consume_adapter_artifacts(adapter), last_base=base, reset_history=True
                )
                raise
    except Exception as e:
        logger.error(f"Detect phase error for job {job_id}: {e}", exc_info=True)
        await _save_error(job_id, str(e))
        async with AsyncSessionLocal() as session:
            stale_job = await session.get(WatchJob, job_id)
            if stale_job is not None:
                if stale_job.enable_monitoring:
                    await _set_status(session, stale_job, JobStatus.WAITING)
                    stale_job.next_check_at = utcnow() + timedelta(
                        minutes=_effective_interval_minutes(stale_job)
                    )
                    session.add(stale_job)
                    await session.commit()
                else:
                    await _set_status(session, stale_job, JobStatus.PAUSED)
        return {"error": str(e)}

    fully_available = [r for r in results if r.status == AvailabilityStatus.AVAILABLE]
    partially_available = [r for r in results if r.status == AvailabilityStatus.PARTIALLY_AVAILABLE]
    unavailable = [r for r in results if r.status == AvailabilityStatus.UNAVAILABLE]

    # Hold is only attempted when every requested site is fully available.
    # A mixed result goes out as an informational notification — the hold
    # worker's flow can't handle "fewer spots than requested" cells.
    all_fully_available = bool(results) and all(r.status == AvailabilityStatus.AVAILABLE for r in results)

    # --- Enqueue hold or notify ---
    hold_enqueued = False
    if all_fully_available and auto_book and not adapter_supports_automated_booking(adapter.adapter_id):
        # Belt-and-braces: the API rejects auto_book for these adapters, but a
        # job could predate the capability flag (HH-118). Never enqueue a hold
        # for a site whose sign-in can't be automated — notify instead.
        lines = [f"- {r.site}: {r.total_available} spot(s)" for r in fully_available]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=(
                f"All sites fully available on {params.get('date')}.\n"
                + "\n".join(lines)
                + "\n\nThis booking site signs in with third-party SSO, which "
                "Hut Hunter can't automate — book manually on the site."
            ),
            priority=8,
        )
    elif all_fully_available and auto_book and not _params_have_occupants(params):
        lines = [f"- {r.site}: {r.total_available} spot(s)" for r in fully_available]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=(
                f"All sites fully available on {params.get('date')} but this job "
                "has no occupants selected, so booking could not start.\n"
                + "\n".join(lines)
                + "\n\nAdd occupants to the job, then book manually."
            ),
            priority=8,
        )
    elif all_fully_available and auto_book and not credentials_configured:
        lines = [f"- {r.site}: {r.total_available} spot(s)" for r in fully_available]
        credentials_reason = (
            "the saved sign-in for its adapter failed verification"
            if credential_failed else
            "no stored booking credentials for its adapter"
        )
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=(
                f"All sites fully available on {params.get('date')} but this job has "
                f"{credentials_reason}, so booking could not start.\n"
                + "\n".join(lines)
                + "\n\nFix the sign-in for this adapter, then book manually."
            ),
            priority=8,
        )
    elif all_fully_available and auto_book:
        try:
            await ctx["redis"].enqueue_job("attempt_hold_task", job_id, _queue_name=HOLD_QUEUE_NAME)
            hold_enqueued = True
            logger.info(f"Enqueued attempt_hold_task for job {job_id}")
        except Exception as e:
            logger.error(f"Failed to enqueue hold task for {job_id}: {e}", exc_info=True)
            lines = [f"- {r.site}: {r.total_available} spot(s)" for r in fully_available]
            await dispatch_notification_targets(
                notification_settings,
                title="🏕️ Availability (hold queue unreachable)",
                message=(
                    f"All sites fully available on {params.get('date')} but the "
                    f"auto-hold could not be queued ({e}). Book manually:\n"
                    + "\n".join(lines)
                ),
                priority=9,
            )
    elif all_fully_available:
        lines = [f"- {r.site}: {r.total_available} spot(s)" for r in fully_available]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=f"All sites fully available on {params.get('date')}. Book now!\n" + "\n".join(lines),
            priority=8,
        )
    elif fully_available or partially_available:
        # Only notify when status *changes* to partial — suppress repeat alerts
        # while the situation stays partial.
        if not _was_previously_partial(prev_last_result):
            def _fmt(r):
                count = 0 if r.total_available is None else r.total_available
                return f"{r.site}: {count} spot(s)"
            lines: list[str] = []
            if partially_available:
                lines.append(f"Partial (wanted {params.get('people')}):")
                lines.extend(f"  - {_fmt(r)}" for r in partially_available)
            if unavailable:
                lines.append("Unavailable:")
                lines.extend(f"  - {_fmt(r)}" for r in unavailable)
            await dispatch_notification_targets(
                notification_settings,
                title="⚠️ Partial Availability",
                message=(
                    f"Some sites have spots on {params.get('date')} but not every "
                    "site is fully available — not auto-holding.\n"
                    + "\n".join(lines)
                    + "\n\nTo book partial: create a new watch job scoped to the "
                    "partial site(s) with a smaller party size, then Book it."
                ),
                priority=6,
            )
        else:
            logger.info(f"Job {job_id}: still partial — suppressing repeat notification")

    # --- Persist detect results ---
    result_dicts = [
        {
            "site": r.site,
            "status": r.status.value,
            "evidence": r.evidence,
            "total_available": r.total_available,
            "icon": r.icon,
        }
        for r in results
    ]

    async with AsyncSessionLocal() as session:
        job = cast(WatchJob | None, await session.get(WatchJob, job_id))
        if job:
            job.last_checked_at = utcnow()
            job.last_result = json.dumps(result_dicts)
            # If a hold was enqueued, leave status as CHECKING — the hold task
            # owns the next transition. Otherwise: WAITING if monitoring is on,
            # PAUSED if not.
            if not hold_enqueued and job.status == JobStatus.CHECKING.value:
                if job.enable_monitoring:
                    job.status = JobStatus.WAITING.value
                    job.next_check_at = utcnow() + timedelta(
                        minutes=_effective_interval_minutes(job)
                    )
                else:
                    job.status = JobStatus.PAUSED.value
                    job.next_check_at = None
            session.add(job)
            await session.commit()

    return {
        "job_id": job_id,
        "status": "checked",
        "results": result_dicts,
        "hold_enqueued": hold_enqueued,
    }


async def scheduler_tick(ctx: dict) -> dict:
    """Periodic scan — enqueue overdue checks and resume after expired holds.
    Runs every 30 seconds on the poll worker.

    Pass 0 (THR-124): AWAITING_WINDOW jobs whose computed window_opens_at has
    passed flip to WAITING with next_check_at=now and a tight poll-burst
    cadence, so pass 2 (same tick) or the next tick dispatches them almost
    immediately.

    Pass 1: HOLD_PLACED jobs with no active cart flip to WAITING with
    next_check_at=now so pass 2 picks them up immediately.

    Pass 2: Jobs with enable_monitoring=true, next_check_at<=now, and status
    not in (CHECKING, HOLD_PLACED, BOOKING_COMPLETE, CANCELLED) are enqueued
    as check_availability with _job_id dedup. ARQ rejects duplicate _job_ids
    so a second enqueue while one is pending/running is a no-op.
    """
    now = utcnow()
    armed = 0
    dispatched = 0
    resumed_from_hold = 0
    deduped = 0
    skipped_expired = 0

    redis = ctx["redis"]

    from sqlmodel import select  # local to avoid top-level circular risk

    async with AsyncSessionLocal() as session:
        # Pass 0 — THR-124: arm hunts whose booking window has opened.
        awaiting_jobs = (await session.execute(
            select(WatchJob).where(
                WatchJob.status == JobStatus.AWAITING_WINDOW.value,
                WatchJob.window_opens_at.is_not(None),
                WatchJob.window_opens_at <= now,
            )
        )).scalars().all()
        for job in awaiting_jobs:
            try:
                params = json.loads(job.params)
            except Exception:
                logger.exception(f"scheduler_tick: bad params JSON for awaiting_window job {job.id}")
                continue
            if is_job_expired(job.adapter_id, params):
                # Cutoff passed before the window even opened — leave it
                # parked; the API's EXPIRED overlay already surfaces this to
                # the user (see WatchJobRead.from_db), and arming it would
                # just enqueue a check that's rejected as expired anyway.
                continue
            logger.info(f"scheduler_tick: booking window open for job {job.id} — arming")
            job.status = JobStatus.WAITING.value
            job.next_check_at = now
            job.window_burst_until = now + timedelta(minutes=WINDOW_BURST_MINUTES)
            session.add(job)
            armed += 1
        if awaiting_jobs:
            await session.commit()

        # Pass 1 — hold-expiry. Fetch all HOLD_PLACED/NEEDS_ATTENTION jobs
        # (should be few) and check per-job. N+1 is fine at this scale.
        # THR-122: NEEDS_ATTENTION (parked takeover session after an
        # unexpected hold failure) expires the same way a successful hold
        # does — same CartSession row, same close_browser_task — so it's
        # folded into this pass rather than a parallel one.
        hold_jobs = (await session.execute(
            select(WatchJob).where(
                WatchJob.status.in_([JobStatus.HOLD_PLACED.value, JobStatus.NEEDS_ATTENTION.value])
            )
        )).scalars().all()
        for job in hold_jobs:
            active_cart = await _get_active_cart(session, job.id)
            if active_cart is not None:
                continue  # hold still live
            logger.info(f"scheduler_tick: {job.status} expired for {job.id}, cleaning hold artifacts")
            _remove_hold_artifacts_from_job(job)
            if job.enable_monitoring:
                job.status = JobStatus.WAITING.value
                job.next_check_at = now
                resumed_from_hold += 1
            session.add(job)
            await redis.enqueue_job("close_browser_task", job.id, _queue_name=HOLD_QUEUE_NAME)
        if hold_jobs:
            await session.commit()

        # Pass 2 — dispatch due checks.
        due = (await session.execute(
            select(WatchJob).where(
                WatchJob.enable_monitoring == True,  # noqa: E712
                WatchJob.next_check_at.is_not(None),
                WatchJob.next_check_at <= now,
                WatchJob.status.not_in([
                    JobStatus.CHECKING.value,
                    JobStatus.HOLD_PLACED.value,
                    JobStatus.NEEDS_ATTENTION.value,
                    JobStatus.BOOKING_COMPLETE.value,
                    JobStatus.CANCELLED.value,
                ]),
            )
        )).scalars().all()

        for job in due:
            try:
                params = json.loads(job.params)
            except Exception:
                logger.exception(f"scheduler_tick: bad params JSON for {job.id}")
                continue

            if is_job_expired(job.adapter_id, params):
                skipped_expired += 1
                job.next_check_at = None  # park — won't re-wake unless params change
                session.add(job)
                await session.commit()
                continue

            # Write status + next_check_at before enqueue so the worker sees
            # fresh state. Per-job commit avoids a race with concurrent writes.
            if job.status == JobStatus.WAITING.value:
                job.status = JobStatus.CHECKING.value
            job.next_check_at = now + timedelta(minutes=_effective_interval_minutes(job))
            session.add(job)
            await session.commit()

            queued = await redis.enqueue_job(
                "check_availability",
                job.id,
                _job_id=_check_job_arq_id(job.id),
            )
            if queued is None:
                deduped += 1  # already queued or running — dedup did its job
                continue
            dispatched += 1

    if armed or dispatched or resumed_from_hold or deduped or skipped_expired:
        logger.info(
            f"scheduler_tick: armed={armed} dispatched={dispatched} "
            f"resumed_from_hold={resumed_from_hold} deduped={deduped} "
            f"skipped_expired={skipped_expired}"
        )
    return {
        "armed": armed,
        "dispatched": dispatched,
        "resumed_from_hold": resumed_from_hold,
        "deduped": deduped,
        "skipped_expired": skipped_expired,
    }


async def shutdown(ctx: dict) -> None:
    logger.info("Hut Hunter poll worker shutting down")


class WorkerSettings:
    """Poll worker — runs check_availability on the default queue."""
    functions = [check_availability]
    cron_jobs = [
        cron(
            scheduler_tick,
            second={0, 30},
            run_at_startup=True,
            unique=True,
            timeout=25,
        ),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 1
    job_timeout = 120  # 2 minutes — detect phase only
    # keep_result=0 so ARQ lets us re-enqueue with the same _job_id immediately
    # after a run completes (default keep_result=1hr would block the dedup key).
    keep_result = 0
