import json
import logging
import os
from contextlib import asynccontextmanager
from typing import cast

from arq.connections import RedisSettings

from sqlmodel import select

from app.adapters.base import AvailabilityStatus, BookingResult
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.notify import notify_gotify
from app.models.job import JobStatus, WatchJob, utcnow
from app.models.session import CartSession
from app.adapters import get_adapter
from playwright.async_api import async_playwright, ViewportSize

logger = logging.getLogger(__name__)


# Dedicated arq queue name for hold jobs. Polling and hold work run on
# separate queues so a hold's ~30–60s headed-browser flow doesn't block
# availability polls for other jobs.
HOLD_QUEUE_NAME = "arq:holds"


# Process-local registry of Chromium browsers kept alive past attempt_hold so
# the user can view/complete payment. Keyed by job_id. Values hold the handles
# needed to close the browser later (via close_live_browser).
#
# NOTE: this is intentionally in-memory and per-process — it's only used to
# track what this worker owns. The cross-worker "is this job's cart live?"
# decision is made against the CartSession table, not this dict.
LIVE_BROWSERS: dict[str, dict] = {}


async def close_live_browser(job_id: str) -> bool:
    """Tear down a browser previously kept alive for the given job.

    Returns True if a browser was owned by this process and closed, False if
    no entry existed (e.g. owned by a different worker, or already cleaned up).
    """
    entry = LIVE_BROWSERS.pop(job_id, None)
    if entry is None:
        return False
    browser = entry.get("browser")
    pw_cm = entry.get("pw_cm")
    if browser is not None:
        try:
            await browser.close()
        except Exception as e:
            logger.warning(f"close_live_browser: browser.close failed: {e}")
    if pw_cm is not None:
        try:
            await pw_cm.__aexit__(None, None, None)
        except Exception as e:
            logger.warning(f"close_live_browser: pw_cm.__aexit__ failed: {e}")
    logger.info(f"Closed live browser for job {job_id}")
    return True


async def _snapshot_safe(adapter, page, label: str) -> None:
    """Best-effort snapshot — never raises. Used inside except blocks so a
    failing snapshot can't mask the original error."""
    try:
        base = await adapter.snapshot(page, label)
        logger.info(f"Saved error artifact: {base}")
    except Exception as snap_e:
        logger.error(f"Failed to snapshot '{label}': {snap_e}", exc_info=True)


async def _get_active_cart(session, job_id: str) -> CartSession | None:
    """Return the most recent non-expired, non-completed cart for this job, if any.

    Still used for lazy-expiry of HOLD_PLACED (see _status_guard_and_resolve):
    if a job is HOLD_PLACED but no active cart exists, the hold has timed out
    and the status should flip back to CHECKING."""
    return (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .where(CartSession.expires_at > utcnow())
        .where(CartSession.completed_at.is_(None))
        .order_by(CartSession.created_at.desc())
    )).scalars().first()


async def _set_status(session, job: WatchJob, status: JobStatus) -> None:
    """Commit a status transition. Idempotent — skips the write if the job
    is already in the requested state."""
    if job.status == status.value:
        return
    logger.info(f"Job {job.id} status: {job.status} -> {status.value}")
    job.status = status.value
    session.add(job)
    await session.commit()


async def _resolve_lazy_expired_hold(session, job: WatchJob) -> None:
    """If a job is HOLD_PLACED but has no live cart, the hold timed out
    without any explicit signal. Flip back to CHECKING per the state spec
    ("after the hold expires the status should flip back to Checking")."""
    if job.status != JobStatus.HOLD_PLACED.value:
        return
    active = await _get_active_cart(session, job.id)
    if active is None:
        logger.info(f"Lazy-expiring HOLD_PLACED for job {job.id} (no live cart)")
        await _set_status(session, job, JobStatus.CHECKING)


@asynccontextmanager
async def _browser_page(
    storage_state: dict | None,
    *,
    headless: bool,
    display: str | None = None,
):
    """Open a Playwright Chromium page with the requested mode.

    Yields ``(page, keep_alive)``. Calling ``keep_alive(job_id)`` before the
    context manager exits transfers ownership of the browser into
    ``LIVE_BROWSERS[job_id]`` and suppresses the normal close. This is how the
    hold phase keeps the payment page open for the user after the worker task
    completes.

    When ``headless=False`` and ``display`` is set, Chromium is launched against
    that X display (e.g. ":99" inside the Docker image with Xvfb). On dev
    machines leave ``display`` unset and the host's default display is used.
    Falls back to a plain headed launch if the display-targeted launch fails.
    """
    launch_kwargs: dict = {"headless": headless}
    if not headless and display:
        # Playwright replaces the subprocess env when this is set, so merge.
        launch_kwargs["env"] = {**os.environ, "DISPLAY": display}

    # Mutable sentinel so the nested keep_alive() can communicate back to the
    # finally block without needing nonlocal declarations in the closure.
    keep_key: list[str | None] = [None]

    def keep_alive(job_id: str) -> None:
        keep_key[0] = job_id

    pw_cm = async_playwright()
    pw = await pw_cm.__aenter__()
    browser = None
    context = None
    page = None
    try:
        try:
            browser = await pw.chromium.launch(**launch_kwargs)
        except Exception as e:
            if not headless and display:
                logger.warning(
                    f"Headed Chromium launch with DISPLAY={display} failed ({e}); "
                    "retrying with default display"
                )
                browser = await pw.chromium.launch(headless=False)
            else:
                raise

        context = await browser.new_context(
            viewport=ViewportSize(width=1440, height=900),
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            storage_state=storage_state,  # type: ignore[arg-type]
        )
        page = await context.new_page()
        yield page, keep_alive
    finally:
        if keep_key[0] is not None and browser is not None and page is not None:
            # Ownership transferred — skip close, register in LIVE_BROWSERS so
            # close_live_browser() can tear it down later.
            LIVE_BROWSERS[keep_key[0]] = {
                "pw_cm": pw_cm,
                "browser": browser,
                "context": context,
                "page": page,
                "created_at": utcnow(),
            }
            logger.info(
                f"Browser kept alive for job {keep_key[0]} "
                f"(total live: {len(LIVE_BROWSERS)})"
            )
        else:
            if browser is not None:
                try:
                    await browser.close()
                except Exception as e:
                    logger.warning(f"_browser_page: browser.close failed: {e}")
            try:
                await pw_cm.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"_browser_page: pw_cm.__aexit__ failed: {e}")


# ---------------------------------------------------------------------------
# Poll task — runs on the default queue
# ---------------------------------------------------------------------------

async def check_availability(ctx: dict, job_id: str) -> dict:
    """Poll task. Does a headless detect only; if the job has auto_book and
    the detect finds availability, enqueues `attempt_hold_task` on the hold
    queue and returns immediately so polling stays snappy."""
    logger.info(f"Checking availability for job {job_id}")

    # --- 1. Fetch job + status guard + storage state ---
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

        # Lazy-expire a HOLD_PLACED whose cart has timed out, then gate the
        # check on status. Only run when the job is in an "actively looking"
        # state — anything else (paused / hold placed still live / cancelled
        # / completed) means this check is stale or concurrent and should
        # bail without poking the site.
        await _resolve_lazy_expired_hold(session, job)
        if job.status not in (JobStatus.CHECKING.value, JobStatus.WAITING.value):
            logger.info(
                f"Skipping check for job {job_id}: status={job.status} "
                f"(not checking/waiting)"
            )
            return {"job_id": job_id, "status": f"skipped_{job.status}"}

        storage_state = await adapter.get_storage_state(session)
        logger.info(f"Storage state loaded for {job.adapter_id}: {storage_state is not None}")
        auto_book = job.auto_book

    results = []

    # --- 2. Detect phase (headless) ---
    try:
        async with _browser_page(
            storage_state, headless=settings.browser_headless_detect
        ) as (page, _keep_alive):
            try:
                await adapter.fill_form(page, params)
                results = await adapter.detect_availability(page, params)
                logger.info(f"Detect results for job {job_id}: {results}")
            except Exception as e:
                await _snapshot_safe(
                    adapter, page, f"detect_error_{type(e).__name__}"
                )
                raise
    except Exception as e:
        logger.error(f"Detect phase error for job {job_id}: {e}", exc_info=True)
        await _save_error(job_id, str(e))
        # Release the job so the user can re-trigger.
        async with AsyncSessionLocal() as session:
            stale_job = await session.get(WatchJob, job_id)
            if stale_job is not None:
                await _set_status(session, stale_job, JobStatus.PAUSED)
        return {"error": str(e)}

    fully_available = [r for r in results if r.status == AvailabilityStatus.AVAILABLE]
    partially_available = [
        r for r in results if r.status == AvailabilityStatus.PARTIALLY_AVAILABLE
    ]

    # --- 3. Enqueue hold task or notify directly ---
    hold_enqueued = False
    if fully_available and auto_book:
        try:
            await ctx["redis"].enqueue_job(
                "attempt_hold_task",
                job_id,
                _queue_name=HOLD_QUEUE_NAME,
            )
            hold_enqueued = True
            logger.info(f"Enqueued attempt_hold_task for job {job_id} on {HOLD_QUEUE_NAME}")
        except Exception as e:
            # Enqueue failure is surprising but recoverable — let the user know
            # availability exists so they can book manually if needed.
            logger.error(f"Failed to enqueue hold task for {job_id}: {e}", exc_info=True)
            for r in fully_available:
                await notify_gotify(
                    title="🏕️ Availability (hold queue unreachable)",
                    message=(
                        f"{r.site} has {r.total_available} spot(s) on {params.get('date')}, "
                        f"but queueing the auto-hold failed: {e}. Book manually."
                    ),
                    priority=9,
                )

    if fully_available and not auto_book:
        for r in fully_available:
            await notify_gotify(
                title="🏕️ Availability Detected!",
                message=(
                    f"{r.site} has {r.total_available} spot(s) on {params.get('date')}. "
                    f"Book now!"
                ),
                priority=8,
            )

    for r in partially_available:
        await notify_gotify(
            title="⚠️ Partial Availability",
            message=(
                f"{r.site} has {r.total_available} spot(s) on {params.get('date')} "
                f"but you wanted {params.get('people')}. Partial booking may be possible."
            ),
            priority=5,
        )

    # --- 4. Write detect results to DB ---
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
            # If a hold was enqueued, leave the job in CHECKING — the hold
            # task owns the next transition (HOLD_PLACED on success, PAUSED
            # on failure). Otherwise this check is "done"; drop back to
            # PAUSED until the user triggers again (or until periodic polling
            # is introduced, at which point WAITING fits here).
            if not hold_enqueued and job.status == JobStatus.CHECKING.value:
                job.status = JobStatus.PAUSED.value
            session.add(job)
            await session.commit()

    return {
        "job_id": job_id,
        "status": "checked",
        "results": result_dicts,
        "hold_enqueued": hold_enqueued,
    }


# ---------------------------------------------------------------------------
# Hold task — runs on the HOLD_QUEUE_NAME queue
# ---------------------------------------------------------------------------

async def attempt_hold_task(ctx: dict, job_id: str) -> dict:
    """Hold task. Launches a headed browser, re-verifies availability, and
    attempts to drive the full hold flow through to the payment page. On
    success the browser is kept alive (user completes payment via VNC). All
    hold-related Gotify notifications originate here."""
    logger.info(f"Attempting hold for job {job_id}")

    # --- 1. Fetch job + status guard + storage state ---
    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if not job:
            logger.warning(f"Hold: job {job_id} not found")
            return {"error": "job not found"}
        params = json.loads(job.params)

        try:
            adapter = get_adapter(job.adapter_id)
        except ValueError as e:
            logger.error(f"Hold: unknown adapter: {e}")
            return {"error": str(e)}

        # Race safety: between the poll enqueuing this task and us picking it
        # up, another hold may have already succeeded (status flipped to
        # HOLD_PLACED), or the user may have cancelled / the poll may have
        # been superseded. If status isn't CHECKING, skip — the job is
        # either being held elsewhere or isn't in a state that wants a hold.
        await _resolve_lazy_expired_hold(session, job)
        if job.status != JobStatus.CHECKING.value:
            logger.info(
                f"Skipping hold for job {job_id}: status={job.status} "
                f"(not checking)"
            )
            return {"job_id": job_id, "status": f"skipped_{job.status}"}

        storage_state = await adapter.get_storage_state(session)

    booking: BookingResult | None = None
    availability_dropped = False
    fully_available: list = []

    try:
        async with _browser_page(
            storage_state,
            headless=False,
            display=settings.browser_display,
        ) as (page, keep_alive):
            try:
                await adapter.fill_form(page, params)
                hold_results = await adapter.detect_availability(page, params)
                logger.info(f"Hold-phase recheck for job {job_id}: {hold_results}")

                fully_available = [
                    r for r in hold_results
                    if r.status == AvailabilityStatus.AVAILABLE
                ]

                if not fully_available:
                    logger.warning(
                        f"Availability dropped before hold for job {job_id}"
                    )
                    availability_dropped = True
                else:
                    params["_job_id"] = job_id
                    try:
                        booking = await adapter.attempt_hold(page, params)
                        logger.info(
                            f"Hold result for job {job_id}: "
                            f"held={booking.held} url={booking.reservation_url} "
                            f"msg={booking.message}"
                        )
                        if booking and booking.held:
                            keep_alive(job_id)
                    except NotImplementedError:
                        logger.info(
                            f"Adapter {adapter.adapter_id} does not support holds yet"
                        )
            except Exception as e:
                await _snapshot_safe(
                    adapter, page, f"hold_error_{type(e).__name__}"
                )
                raise
    except Exception as e:
        logger.error(f"Hold task error for job {job_id}: {e}", exc_info=True)
        booking = BookingResult(
            success=False, held=False, message=f"Hold task error: {e}"
        )

    # --- 2. Notifications (hold outcome only) ---
    if booking and booking.held and booking.reservation_url:
        for r in fully_available:
            await notify_gotify(
                title="🏕️ Hold Secured!",
                message=(
                    f"{r.site} — {r.total_available} spot(s) on {params.get('date')}.\n"
                    f"25 mins to complete payment:\n{booking.reservation_url}"
                ),
                priority=10,
            )
    elif availability_dropped:
        # fully_available is empty here, but we still know something was
        # available at poll time — surface the miss in a terse notification.
        await notify_gotify(
            title="🏕️ Just missed it",
            message=(
                f"Availability dropped before the hold could be placed for "
                f"{params.get('date')}."
            ),
            priority=7,
        )
    else:
        msg = booking.message if booking else "Hold not attempted"
        for r in fully_available:
            await notify_gotify(
                title="🏕️ Available but hold failed",
                message=(
                    f"{r.site} has {r.total_available} spot(s) on {params.get('date')} "
                    f"but hold failed: {msg}"
                ),
                priority=8,
            )

    # --- 3. Terminal status update for this attempt ---
    held = bool(booking and booking.held)
    final_status = JobStatus.HOLD_PLACED if held else JobStatus.PAUSED
    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if job is not None:
            await _set_status(session, job, final_status)

    return {
        "job_id": job_id,
        "status": "held" if held else (
            "availability_dropped" if availability_dropped else "hold_failed"
        ),
        "message": booking.message if booking else "",
    }


async def _save_error(job_id: str, error: str) -> None:
    async with AsyncSessionLocal() as session:
        job = cast(WatchJob | None, await session.get(WatchJob, job_id))
        if job:
            job.last_result = json.dumps([{"error": error}])
            job.last_checked_at = utcnow()
            session.add(job)
            await session.commit()


async def startup(ctx: dict) -> None:
    logger.info("Hut Hunter worker starting up")


async def shutdown(ctx: dict) -> None:
    logger.info("Hut Hunter worker shutting down")


async def hold_worker_shutdown(ctx: dict) -> None:
    """On hold-worker shutdown, close any browsers still live in this process."""
    if LIVE_BROWSERS:
        job_ids = list(LIVE_BROWSERS.keys())
        logger.info(
            f"Hold worker shutting down with {len(job_ids)} live browser(s); "
            f"closing: {job_ids}"
        )
        for jid in job_ids:
            await close_live_browser(jid)
    logger.info("Hut Hunter hold worker shutting down")


async def close_browser_task(ctx: dict, job_id: str) -> dict:
    """Enqueued by the API when the user hits 'Cancel' or 'Booking Complete'
    on the /pay page. Must run on the hold worker so it can access that
    process's LIVE_BROWSERS registry. A no-op if this worker doesn't own the
    browser (e.g. another hold_worker replica has it, or it was already torn
    down). This is fire-and-forget from the API's POV."""
    closed = await close_live_browser(job_id)
    logger.info(f"close_browser_task job={job_id} closed={closed}")
    return {"job_id": job_id, "closed": closed}


class WorkerSettings:
    """Poll worker — runs check_availability on the default queue."""
    functions = [check_availability]
    on_startup = startup
    on_shutdown = shutdown
    # Read redis URL from settings so it works both on the host
    # (redis://localhost:6379) and inside docker-compose (redis://redis:6379).
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 1  # one poll at a time per worker
    job_timeout = 120  # 2 minutes — detect phase only


class HoldWorkerSettings:
    """Hold worker — runs attempt_hold_task on the dedicated hold queue."""
    functions = [attempt_hold_task, close_browser_task]
    on_startup = startup
    on_shutdown = hold_worker_shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    queue_name = HOLD_QUEUE_NAME
    max_jobs = 1  # serialize holds so browsers don't stack on the display
    job_timeout = 300  # 5 minutes — full booking flow with margin
