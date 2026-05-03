import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import cast

from arq import cron
from arq.connections import RedisSettings

from sqlmodel import select

from app.adapters.base import AvailabilityStatus, BookingResult
from app.adapters import adapter_requires_credentials, get_adapter
from app.core.adapter_credentials import get_user_adapter_credentials
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.notification_settings import get_user_notification_settings_secret
from app.core.notify import dispatch_notification_targets
import app.models  # noqa: F401 - registers SQLModel metadata
from app.models.job import JobStatus, WatchJob, is_job_expired, utcnow
from app.models.session import CartSession
from playwright.async_api import async_playwright, ViewportSize

logger = logging.getLogger(__name__)


# Stable ARQ job ID scheme for check_availability — used for dedup so we
# never have more than one queued/running check per watch job. ARQ rejects
# a duplicate enqueue with the same _job_id. Must match app/api/routes.py.
def _check_job_arq_id(job_id: str) -> str:
    return f"check_availability:{job_id}"


def _params_have_occupants(params: dict) -> bool:
    occupants = params.get("occupants")
    return isinstance(occupants, list) and len(occupants) > 0


def _job_needs_credentials(adapter_id: str) -> bool:
    return adapter_requires_credentials(adapter_id)


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


async def _snapshot_safe(adapter, page, label: str) -> str | None:
    """Best-effort snapshot — never raises. Used inside except blocks so a
    failing snapshot can't mask the original error. Returns the saved base
    path (no extension) on success, or None if the snapshot failed."""
    try:
        base = await adapter.snapshot(page, label)
        logger.info(f"Saved error artifact: {base}")
        return base
    except Exception as snap_e:
        logger.error(f"Failed to snapshot '{label}': {snap_e}", exc_info=True)
        return None


async def _save_artifact(job_id: str, base: str | None) -> None:
    await _save_artifacts(job_id, [], last_base=base)


async def _save_artifacts(
    job_id: str,
    artifacts: list[dict],
    *,
    last_base: str | None = None,
    reset_history: bool = False,
) -> None:
    """Persist the most recent artifact base path plus any artifact history.

    `artifacts` entries should be dicts with `label` and `base`.
    Swallows DB errors — we never want to mask the caller's original path.
    """
    if not last_base and not artifacts and not reset_history:
        return
    try:
        async with AsyncSessionLocal() as session:
            job = cast(WatchJob | None, await session.get(WatchJob, job_id))
            if job is not None:
                if last_base:
                    job.last_artifact = last_base

                if reset_history:
                    history: list[dict] = []
                else:
                    try:
                        parsed = json.loads(job.artifact_history) if job.artifact_history else []
                    except Exception:
                        parsed = []
                    history = parsed if isinstance(parsed, list) else []

                seen_bases = {
                    entry.get("base")
                    for entry in history
                    if isinstance(entry, dict)
                }
                for artifact in artifacts:
                    base = artifact.get("base")
                    label = artifact.get("label")
                    if not isinstance(base, str) or not base or base in seen_bases:
                        continue
                    history.append({
                        "label": label if isinstance(label, str) else "artifact",
                        "base": base,
                    })
                    seen_bases.add(base)

                job.artifact_history = json.dumps(history[-12:]) if history else None
                session.add(job)
                await session.commit()
    except Exception as e:
        logger.error(
            f"Failed to save artifacts for job {job_id}: {e}", exc_info=True
        )


def _consume_adapter_artifacts(adapter) -> list[dict]:
    return [
        {"label": artifact.label, "base": artifact.base}
        for artifact in adapter.consume_artifacts()
    ]


def _latest_artifact_base(artifacts: list[dict]) -> str | None:
    if not artifacts:
        return None
    base = artifacts[-1].get("base")
    return base if isinstance(base, str) else None


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


async def _touch_live_payment_page(page) -> None:
    """Best-effort activity heartbeat for the DOC payment page.

    The DOC checkout can expire from inactivity before the full cart hold
    window ends. We avoid disruptive actions like reloads or key presses and
    instead combine a same-origin fetch with lightweight DOM activity events.
    """
    await page.evaluate(
        """async () => {
          const dispatch = (target, type, init = {}) => {
            target.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: 18,
              clientY: 18,
              ...init,
            }));
          };

          try {
            await fetch(window.location.href, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
            });
          } catch (_error) {
            // Network heartbeat is best-effort only.
          }

          if (document.body) {
            dispatch(document.body, 'mousemove');
            dispatch(document.body, 'mousedown');
            dispatch(document.body, 'mouseup');
          }
          dispatch(document, 'mousemove');
          window.dispatchEvent(new Event('focus'));
        }"""
    )


async def keep_live_carts_active(ctx: dict) -> dict:
    """Hold-worker heartbeat for pages parked on CreditCardPayment.

    Runs on the hold queue so it can access LIVE_BROWSERS in-process. Any live
    browser that no longer has an active HOLD_PLACED cart is closed. Active,
    unpaid carts get a lightweight heartbeat often enough to stay under DOC's
    15-minute inactivity timeout.
    """
    if not LIVE_BROWSERS:
        return {"checked": 0, "touched": 0, "closed": 0}

    now = utcnow()
    touched = 0
    closed = 0
    checked = 0

    async with AsyncSessionLocal() as session:
        for job_id, entry in list(LIVE_BROWSERS.items()):
            checked += 1
            job = cast(WatchJob | None, await session.get(WatchJob, job_id))
            active_cart = await _get_active_cart(session, job_id)

            if (
                job is None
                or job.status != JobStatus.HOLD_PLACED.value
                or active_cart is None
            ):
                if await close_live_browser(job_id):
                    closed += 1
                continue

            try:
                adapter = get_adapter(job.adapter_id)
            except ValueError as e:
                logger.warning(
                    f"keep_live_carts_active: unknown adapter for job {job_id}: {e}"
                )
                continue

            keepalive_minutes = adapter.cart_keepalive_interval_minutes
            if not keepalive_minutes:
                continue

            inactive_after_minutes = adapter.cart_inactive_after_minutes
            if (
                inactive_after_minutes is not None
                and keepalive_minutes >= inactive_after_minutes
            ):
                logger.warning(
                    "Adapter %s keepalive interval (%s min) is not below the "
                    "inactivity timeout (%s min)",
                    adapter.adapter_id,
                    keepalive_minutes,
                    inactive_after_minutes,
                )

            keepalive_every = timedelta(minutes=keepalive_minutes)
            last_keepalive_at = entry.get("last_keepalive_at") or entry.get("created_at") or now
            if now - last_keepalive_at < keepalive_every:
                continue

            page = entry.get("page")
            if page is None:
                if await close_live_browser(job_id):
                    closed += 1
                continue

            try:
                await _touch_live_payment_page(page)
                entry["last_keepalive_at"] = now
                touched += 1
                logger.info(f"Sent payment-page keepalive heartbeat for job {job_id}")
            except Exception as e:
                logger.warning(
                    f"Failed keepalive heartbeat for job {job_id}: {e}",
                    exc_info=True,
                )

    return {"checked": checked, "touched": touched, "closed": closed}


@asynccontextmanager
async def _browser_page(
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
                "last_keepalive_at": utcnow(),
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

        # Block expired jobs (adapter's booking cutoff has passed).
        if is_job_expired(job.adapter_id, params):
            logger.info(f"Job {job_id} is expired (past 8 pm NZ on start date), skipping")
            return {"job_id": job_id, "status": "skipped_expired"}

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

        auto_book = job.auto_book
        user_credentials = await get_user_adapter_credentials(
            session,
            job.user_id or "",
            job.adapter_id,
        )
        credentials_configured = (
            True
            if not _job_needs_credentials(job.adapter_id)
            else user_credentials is not None
        )
        notification_settings = await get_user_notification_settings_secret(
            session,
            job.user_id or "",
        )
        # Snapshot the previous result now so we can suppress repeat partial
        # notifications later (we only alert when the status *changes* to
        # partial — not on every check while it stays partial).
        prev_last_result: str | None = job.last_result

    results = []

    # --- 2. Detect phase (headless) ---
    try:
        async with _browser_page(
            headless=settings.browser_headless_detect
        ) as (page, _keep_alive):
            try:
                await adapter.fill_form(page, params)
                results = await adapter.detect_availability(page, params)
                logger.info(f"Detect results for job {job_id}: {results}")
            except Exception as e:
                base = await _snapshot_safe(
                    adapter, page, f"detect_error_{type(e).__name__}"
                )
                await _save_artifacts(
                    job_id,
                    _consume_adapter_artifacts(adapter),
                    last_base=base,
                    reset_history=True,
                )
                raise
    except Exception as e:
        logger.error(f"Detect phase error for job {job_id}: {e}", exc_info=True)
        await _save_error(job_id, str(e))
        # Release the job so the user can re-trigger. When monitoring is on
        # we keep polling on the same cadence — a transient adapter error
        # shouldn't silently disable monitoring (the error surfaces via
        # last_result, the user can always switch monitoring off in the UI).
        async with AsyncSessionLocal() as session:
            stale_job = await session.get(WatchJob, job_id)
            if stale_job is not None:
                if stale_job.enable_monitoring:
                    await _set_status(session, stale_job, JobStatus.WAITING)
                    stale_job.next_check_at = utcnow() + timedelta(
                        minutes=stale_job.interval_minutes
                    )
                    session.add(stale_job)
                    await session.commit()
                else:
                    await _set_status(session, stale_job, JobStatus.PAUSED)
        return {"error": str(e)}

    fully_available = [r for r in results if r.status == AvailabilityStatus.AVAILABLE]
    partially_available = [
        r for r in results if r.status == AvailabilityStatus.PARTIALLY_AVAILABLE
    ]
    unavailable = [
        r for r in results if r.status == AvailabilityStatus.UNAVAILABLE
    ]
    # Hold is only attempted when EVERY requested site is fully available for
    # the party size. A mixed bag (some full + some partial, or any partial at
    # all) goes out as a single informational notification and is left for the
    # user to handle manually — the hold worker's DOC flow can't select the
    # party size on a "fewer spots than requested" cell, so enqueueing it
    # would just waste a browser and burn the DOC cart state.
    all_fully_available = bool(results) and all(
        r.status == AvailabilityStatus.AVAILABLE for r in results
    )

    # --- 3. Enqueue hold task or notify directly ---
    hold_enqueued = False
    if all_fully_available and auto_book and not _params_have_occupants(params):
        logger.warning(
            "Job %s reached auto-bookable availability without occupants; skipping hold",
            job_id,
        )
        lines = [
            f"- {r.site}: {r.total_available} spot(s)"
            for r in fully_available
        ]
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
        logger.warning(
            "Job %s reached auto-bookable availability without stored credentials; skipping hold",
            job_id,
        )
        lines = [
            f"- {r.site}: {r.total_available} spot(s)"
            for r in fully_available
        ]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=(
                f"All sites fully available on {params.get('date')} but this job "
                "has no stored booking credentials for its adapter, so booking could not start.\n"
                + "\n".join(lines)
                + "\n\nSave booking credentials for this adapter, then book manually."
            ),
            priority=8,
        )
    elif all_fully_available and auto_book:
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
            lines = [
                f"- {r.site}: {r.total_available} spot(s)"
                for r in fully_available
            ]
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
        # Every site is good and we're not auto-booking — one combined alert.
        lines = [
            f"- {r.site}: {r.total_available} spot(s)"
            for r in fully_available
        ]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Availability Detected!",
            message=(
                f"All sites fully available on {params.get('date')}. Book now!\n"
                + "\n".join(lines)
            ),
            priority=8,
        )

    elif fully_available or partially_available:
        # Mixed / partial case: at least one site has something but we won't
        # hold. Only notify when the availability *changes* to partial — if the
        # last stored result was already partial, the user already knows and a
        # repeat alert adds no value. We'll re-alert once it goes unavailable
        # and then back to partial, or when it becomes fully available.
        if not _was_previously_partial(prev_last_result):
            def _fmt(r):
                count = 0 if r.total_available is None else r.total_available
                return f"{r.site}: {count} spot(s)"
            lines: list[str] = []
            if partially_available:
                lines.append(
                    f"Partial (wanted {params.get('people')}):"
                )
                lines.extend(f"  - {_fmt(r)}" for r in partially_available)
            if unavailable:
                lines.append("Unavailable:")
                lines.extend(f"  - {_fmt(r)}" for r in unavailable)
            await dispatch_notification_targets(
                notification_settings,
                title="⚠️ Partial Availability",
                message=(
                    f"Some sites have spots on {params.get('date')} but not every "
                    f"site is fully available — not auto-holding.\n"
                    + "\n".join(lines)
                    + "\n\nTo book partial: create a new watch job scoped to the "
                    "partial site(s) with a smaller party size, then Book it."
                ),
                priority=6,
            )
        else:
            logger.info(
                f"Job {job_id}: still partial — suppressing repeat notification"
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
            # on failure). Otherwise this check is "done": if monitoring is
            # on we move to WAITING and reschedule; otherwise drop to PAUSED
            # until the user manually triggers again.
            if not hold_enqueued and job.status == JobStatus.CHECKING.value:
                if job.enable_monitoring:
                    job.status = JobStatus.WAITING.value
                    job.next_check_at = utcnow() + timedelta(
                        minutes=job.interval_minutes
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


# ---------------------------------------------------------------------------
# Hold task — runs on the HOLD_QUEUE_NAME queue
# ---------------------------------------------------------------------------

async def attempt_hold_task(ctx: dict, job_id: str) -> dict:
    """Hold task. Launches a headed browser, re-verifies availability, and
    attempts to drive the full hold flow through to the payment page. On
    success the browser is kept alive (user completes payment via VNC). All
    hold-related user notifications originate here."""
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
        credentials = await get_user_adapter_credentials(
            session,
            job.user_id or "",
            job.adapter_id,
        )
        notification_settings = await get_user_notification_settings_secret(
            session,
            job.user_id or "",
        )
        adapter.set_login_credentials(credentials)

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

    # If an expired hold left a headed browser open on the VNC display,
    # close it before launching a fresh hold attempt so the next /pay view
    # reconnects to the new cart instead of a stale expired one.
    stale_closed = await close_live_browser(job_id)
    if stale_closed:
        logger.info(f"Closed stale live browser before retrying hold for {job_id}")

    booking: BookingResult | None = None
    availability_dropped = False
    fully_available: list = []
    if _job_needs_credentials(job.adapter_id) and credentials is None:
        logger.warning(
            "Hold skipped for job %s: no stored credentials for adapter %s",
            job_id,
            job.adapter_id,
        )
        booking = BookingResult(
            success=False,
            held=False,
            message="Stored booking credentials are missing for this adapter.",
        )

    if booking is None:
        try:
            async with _browser_page(
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
                            hold_artifacts = _consume_adapter_artifacts(adapter)
                            await _save_artifacts(
                                job_id,
                                hold_artifacts,
                                last_base=_latest_artifact_base(hold_artifacts),
                                reset_history=True,
                            )
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
                    base = await _snapshot_safe(
                        adapter, page, f"hold_error_{type(e).__name__}"
                    )
                    await _save_artifacts(
                        job_id,
                        _consume_adapter_artifacts(adapter),
                        last_base=base,
                        reset_history=True,
                    )
                    raise
        except Exception as e:
            logger.error(f"Hold task error for job {job_id}: {e}", exc_info=True)
            booking = BookingResult(
                success=False, held=False, message=f"Hold task error: {e}"
            )

    # --- 2. Notifications (hold outcome only) ---
    if booking and booking.held and booking.reservation_url:
        hold_minutes = adapter.cart_hold_minutes
        hold_window_copy = (
            f"{hold_minutes} mins to complete payment"
            if hold_minutes
            else "Complete payment before the cart expires"
        )
        # One notification listing all held sites.
        site_lines = [
            f"  • {r.site} — {r.total_available} spot(s)"
            for r in fully_available
        ]
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Hold Secured!",
            message=(
                f"Hold placed for {params.get('date')}:\n"
                + "\n".join(site_lines)
                + f"\n\n{hold_window_copy}:\n{booking.reservation_url}"
            ),
            priority=10,
        )
    elif availability_dropped:
        # fully_available is empty here, but we still know something was
        # available at poll time — surface the miss in a terse notification.
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Just missed it",
            message=(
                f"Availability dropped before the hold could be placed for "
                f"{params.get('date')}."
            ),
            priority=7,
        )
    else:
        # One notification listing all sites that were available but couldn't
        # be held (covers both single-site and multi-night multi-site cases).
        msg = booking.message if booking else "Hold not attempted"
        if booking and "Stored booking credentials are missing" in msg:
            await dispatch_notification_targets(
                notification_settings,
                title="🏕️ Booking blocked",
                message=(
                    f"Availability was ready to book on {params.get('date')}, "
                    "but this adapter has no stored booking credentials."
                ),
                priority=8,
            )
        elif fully_available:
            site_lines = [
                f"  • {r.site} — {r.total_available} spot(s)"
                for r in fully_available
            ]
            await dispatch_notification_targets(
                notification_settings,
                title="🏕️ Available but hold failed",
                message=(
                    f"Sites available on {params.get('date')} but hold failed: {msg}\n"
                    + "\n".join(site_lines)
                ),
                priority=8,
            )

    # --- 3. Terminal status update for this attempt ---
    held = bool(booking and booking.held)
    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if job is not None:
            if not held:
                # Record the failure in last_result so the JobCard can surface
                # it with the correct visual and artifact links.
                fail_msg = (
                    booking.message if booking else "Hold was not attempted"
                )
                job.last_result = json.dumps(
                    [{"type": "hold_failed", "error": fail_msg}]
                )
                session.add(job)

            if held:
                # Hold secured — next_check_at is left alone; the scheduler's
                # hold-expiry pass resumes monitoring once the cart times out.
                await _set_status(session, job, JobStatus.HOLD_PLACED)
            elif job.enable_monitoring:
                # Hold failed but monitoring is on — reschedule and keep
                # watching. The next check will redetect availability.
                await _set_status(session, job, JobStatus.WAITING)
                job.next_check_at = utcnow() + timedelta(
                    minutes=job.interval_minutes
                )
                session.add(job)
                await session.commit()
            else:
                await _set_status(session, job, JobStatus.PAUSED)

    return {
        "job_id": job_id,
        "status": "held" if held else (
            "availability_dropped" if availability_dropped else "hold_failed"
        ),
        "message": booking.message if booking else "",
    }


def _was_previously_partial(last_result_json: str | None) -> bool:
    """Return True if the most recent stored result was already a partial /
    mixed-availability outcome.

    Partial means:
      • at least one entry had status "partially_available", OR
      • there was a mix of "available" and "unavailable" across entries.

    Error-shaped entries (no "status" key) are ignored — they represent a
    failed check, not an availability state, so they don't count as "partial".
    """
    if not last_result_json:
        return False
    try:
        entries = json.loads(last_result_json)
    except Exception:
        return False
    statuses = {e["status"] for e in entries if isinstance(e, dict) and "status" in e}
    if not statuses:
        return False
    if "partially_available" in statuses:
        return True
    # Mixed available + unavailable is also treated as partial
    return "available" in statuses and "unavailable" in statuses


async def _save_error(job_id: str, error: str) -> None:
    async with AsyncSessionLocal() as session:
        job = cast(WatchJob | None, await session.get(WatchJob, job_id))
        if job:
            job.last_result = json.dumps([{"error": error}])
            job.last_checked_at = utcnow()
            session.add(job)
            await session.commit()


async def scheduler_tick(ctx: dict) -> dict:
    """Periodic scan of watchjob — enqueue overdue checks and resume after
    expired holds. Runs every 30 seconds on the poll worker.

    Two passes:

      1. **Hold-expiry resume.** Jobs in HOLD_PLACED whose latest CartSession
         has expired (expires_at < now AND completed_at IS NULL) flip back to
         WAITING with next_check_at=now so the second pass picks them up
         immediately. Matches the "after hold expires, resume monitoring"
         spec.

      2. **Dispatch due checks.** Jobs with enable_monitoring=true,
         next_check_at<=now, and status NOT in (CHECKING, HOLD_PLACED with
         live cart, BOOKING_COMPLETE, CANCELLED) get enqueued as
         check_availability with _job_id dedup. ARQ rejects duplicate
         _job_ids so a second enqueue while one is pending/running is a
         no-op — exactly the at-most-one-queued semantic we want.

    EXPIRED (virtual) is skipped by checking is_job_expired() against the
    adapter's cutoff.
    """
    now = utcnow()
    dispatched = 0
    resumed_from_hold = 0
    deduped = 0
    skipped_expired = 0

    redis = ctx["redis"]

    async with AsyncSessionLocal() as session:
        # Pass 1 — lazy hold-expiry. We can't join to CartSession cleanly
        # from here without adding a relationship; instead, fetch all
        # HOLD_PLACED jobs (there should be very few) and check the cart
        # per-job. Small enough that N+1 is fine.
        hold_jobs = (await session.execute(
            select(WatchJob).where(WatchJob.status == JobStatus.HOLD_PLACED.value)
        )).scalars().all()
        for job in hold_jobs:
            if not job.enable_monitoring:
                continue
            active_cart = await _get_active_cart(session, job.id)
            if active_cart is not None:
                continue  # hold still live — skip
            # Cart expired (or never created): resume monitoring.
            logger.info(
                f"scheduler_tick: hold expired for {job.id}, resuming monitoring"
            )
            job.status = JobStatus.WAITING.value
            job.next_check_at = now
            session.add(job)
            resumed_from_hold += 1
            await redis.enqueue_job(
                "close_browser_task",
                job.id,
                _queue_name=HOLD_QUEUE_NAME,
            )
        if resumed_from_hold:
            await session.commit()

        # Pass 2 — dispatch due checks.
        due = (await session.execute(
            select(WatchJob).where(
                WatchJob.enable_monitoring == True,  # noqa: E712 — SQLAlchemy
                WatchJob.next_check_at.is_not(None),
                WatchJob.next_check_at <= now,
                WatchJob.status.not_in([
                    JobStatus.CHECKING.value,
                    JobStatus.HOLD_PLACED.value,
                    JobStatus.BOOKING_COMPLETE.value,
                    JobStatus.CANCELLED.value,
                ]),
            )
        )).scalars().all()

        for job in due:
            # Adapter-level expiry (e.g. DOC cutoff past 8pm NZ). Skip silently
            # — the UI surfaces EXPIRED via from_db() so the user sees why.
            try:
                params = json.loads(job.params)
            except Exception:
                logger.exception(f"scheduler_tick: bad params JSON for {job.id}")
                continue
            if is_job_expired(job.adapter_id, params):
                skipped_expired += 1
                # Park the job — no sense in the scheduler waking up on this
                # row every tick. Once expired we won't come back here unless
                # params change (which resets next_check_at via the API).
                job.next_check_at = None
                session.add(job)
                await session.commit()
                continue

            # Write status + next_check_at update *before* enqueue so the
            # worker sees fresh state. Committing per-job also avoids a
            # race where the batch commit at the end of the loop would
            # overwrite a concurrent check_availability's status write
            # (e.g. if max_jobs were ever bumped above 1).
            if job.status == JobStatus.WAITING.value:
                job.status = JobStatus.CHECKING.value
            job.next_check_at = now + timedelta(minutes=job.interval_minutes)
            session.add(job)
            await session.commit()

            queued = await redis.enqueue_job(
                "check_availability",
                job.id,
                _job_id=_check_job_arq_id(job.id),
            )
            if queued is None:
                # Already queued or running — dedup did its job. Status stays
                # as-is; next_check_at is already pushed out so we won't
                # retry every tick.
                deduped += 1
                continue

            dispatched += 1

    if dispatched or resumed_from_hold or deduped or skipped_expired:
        logger.info(
            f"scheduler_tick: dispatched={dispatched} "
            f"resumed_from_hold={resumed_from_hold} "
            f"deduped={deduped} skipped_expired={skipped_expired}"
        )
    return {
        "dispatched": dispatched,
        "resumed_from_hold": resumed_from_hold,
        "deduped": deduped,
        "skipped_expired": skipped_expired,
    }


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


async def snapshot_complete_task(ctx: dict, job_id: str) -> dict:
    """Capture a screenshot + HTML of the booking-complete / receipt page
    before the browser is torn down.

    Runs on the hold queue so it can access LIVE_BROWSERS (the browser is
    owned by the hold worker process). If the browser is already gone — e.g.
    a different replica owns it, or it was closed by a concurrent action —
    this is a no-op. Scheduling relies on the hold queue's max_jobs=1 and
    FIFO ordering to run *before* close_browser_task.

    On success, persists the base path to job.last_artifact so the frontend
    can link the user to their receipt."""
    entry = LIVE_BROWSERS.get(job_id)
    if entry is None:
        logger.info(
            f"snapshot_complete_task: no live browser for {job_id}, skipping"
        )
        return {"job_id": job_id, "captured": False, "reason": "no_live_browser"}

    page = entry.get("page")
    if page is None:
        logger.warning(
            f"snapshot_complete_task: LIVE_BROWSERS[{job_id}] has no page"
        )
        return {"job_id": job_id, "captured": False, "reason": "no_page"}

    async with AsyncSessionLocal() as session:
        job = cast(WatchJob | None, await session.get(WatchJob, job_id))
        if job is None:
            logger.warning(f"snapshot_complete_task: job {job_id} not found")
            return {"job_id": job_id, "captured": False, "reason": "job_missing"}
        try:
            adapter = get_adapter(job.adapter_id)
        except ValueError as e:
            logger.error(f"snapshot_complete_task: unknown adapter: {e}")
            return {"job_id": job_id, "captured": False, "reason": str(e)}

    base = await _snapshot_safe(adapter, page, "booking_complete")
    await _save_artifacts(
        job_id,
        _consume_adapter_artifacts(adapter),
        last_base=base,
    )
    return {"job_id": job_id, "captured": base is not None, "base": base}


class WorkerSettings:
    """Poll worker — runs check_availability on the default queue."""
    functions = [check_availability]
    # Cron runs every 30s — interval is stored in minutes so 30s tick
    # granularity means a monitored job fires at most 30s late. `run_at_startup`
    # ensures the first tick doesn't wait a full 30s after a worker restart
    # (handles the "worker was down, catch up now" case per spec).
    cron_jobs = [
        cron(
            scheduler_tick,
            second={0, 30},
            run_at_startup=True,
            # Each tick is cheap but must never stack — unique=True makes ARQ
            # skip a new tick if the previous one is still executing.
            unique=True,
            # If a tick somehow runs long, kill it rather than pile up.
            timeout=25,
        ),
    ]
    on_startup = startup
    on_shutdown = shutdown
    # Read redis URL from settings so it works both on the host
    # (redis://localhost:6379) and inside docker-compose (redis://redis:6379).
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 1  # one poll at a time per worker
    job_timeout = 120  # 2 minutes — detect phase only
    # We persist last_result on the WatchJob itself, so ARQ's result cache is
    # redundant. Setting keep_result=0 lets us re-enqueue with the same
    # _job_id (used for dedup) the moment the previous run finishes —
    # otherwise ARQ would reject the next scheduler tick's enqueue for up to
    # an hour (default keep_result).
    keep_result = 0


class HoldWorkerSettings:
    """Hold worker — runs attempt_hold_task on the dedicated hold queue."""
    functions = [
        attempt_hold_task,
        close_browser_task,
        snapshot_complete_task,
        keep_live_carts_active,
    ]
    cron_jobs = [
        cron(
            keep_live_carts_active,
            minute=set(range(60)),
            second=0,
            run_at_startup=True,
            unique=True,
            timeout=60,
        ),
    ]
    on_startup = startup
    on_shutdown = hold_worker_shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    queue_name = HOLD_QUEUE_NAME
    max_jobs = 1  # serialize holds so browsers don't stack on the display
    job_timeout = 300  # 5 minutes — full booking flow with margin
