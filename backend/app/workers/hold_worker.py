"""Hold worker — browser management, hold tasks, and HoldWorkerSettings."""

import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import cast

from arq import cron
from arq.connections import RedisSettings

from app.adapters.base import AvailabilityStatus, BookingResult, UnexpectedHoldFailure
from app.adapters import adapter_requires_credentials, get_adapter
from app.core.adapter_credentials import get_user_adapter_credentials
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.notification_settings import get_user_notification_settings_secret
from app.core.notify import dispatch_notification_targets
from app.models.job import JobStatus, WatchJob, utcnow
from app.workers._shared import (
    _browser_page,
    _consume_adapter_artifacts,
    _get_active_cart,
    _latest_artifact_base,
    _remove_hold_artifacts_from_job,
    _resolve_lazy_expired_hold,
    _save_artifacts,
    _save_error,
    _set_status,
    _snapshot_safe,
    startup,
)

logger = logging.getLogger(__name__)

HOLD_QUEUE_NAME = "arq:holds"

_JS_DIR = Path(__file__).parent / "js"
_JS_TOUCH_PAGE  = (_JS_DIR / "touch_payment_page.js").read_text()
_JS_RELAY_TEXT  = (_JS_DIR / "relay_text.js").read_text()
_JS_SCROLL      = (_JS_DIR / "scroll.js").read_text()
_JS_FOCUS_FIELD = (_JS_DIR / "focus_field.js").read_text()

# Process-local registry of Chromium browsers kept alive after attempt_hold so
# the user can view/complete payment. Keyed by job_id.
#
# Intentionally in-memory and per-process — it tracks what *this* worker owns.
# The cross-worker "is this job's cart live?" decision is made against the
# CartSession table, not this dict.
LIVE_BROWSERS: dict[str, dict] = {}


async def close_live_browser(job_id: str) -> bool:
    """Tear down the browser kept alive for the given job.

    Returns True if this process owned and closed the browser, False if no
    entry existed (different worker, or already cleaned up).
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


async def _touch_live_payment_page(page) -> None:
    """Lightweight activity heartbeat — see js/touch_payment_page.js."""
    await page.evaluate(_JS_TOUCH_PAGE)


async def _relay_text_into_active_element(page, text: str) -> None:
    """Dispatch keyboard events on the focused DOM element — see js/relay_text.js."""
    await page.evaluate(_JS_RELAY_TEXT, text)


async def _assist_live_browser(page, action: str, chars: str = "") -> dict[str, object]:
    """Apply a UX assist action to a live payment page.

    Limited to scrolling, focus traversal, and text relay — no data
    submission or checkout actions.
    """
    if action == "send-text":
        if not chars:
            return {"ok": True, "action": "send-text", "chars": ""}
        printable = ""
        for ch in chars:
            if ch == "\b":
                if printable:
                    await _relay_text_into_active_element(page, printable)
                    printable = ""
                await page.keyboard.press("Backspace")
            elif ch in {"\n", "\r"}:
                if printable:
                    await _relay_text_into_active_element(page, printable)
                    printable = ""
                await page.keyboard.press("Enter")
            elif ch == "\t":
                if printable:
                    await _relay_text_into_active_element(page, printable)
                    printable = ""
                await page.keyboard.press("Tab")
            else:
                printable += ch
        if printable:
            await _relay_text_into_active_element(page, printable)
        return {"ok": True, "action": "send-text", "chars": chars}

    if action in {"scroll-up", "scroll-down", "scroll-top"}:
        return await page.evaluate(_JS_SCROLL, action)

    if action in {"focus-next", "focus-prev"}:
        direction = 1 if action == "focus-next" else -1
        return await page.evaluate(_JS_FOCUS_FIELD, direction)

    return {"ok": False, "action": action, "reason": "unknown_action"}


async def keep_live_carts_active(ctx: dict) -> dict:
    """Cron heartbeat for browsers parked on the payment page.

    Runs on the hold queue so it can access LIVE_BROWSERS in-process. Closes
    browsers whose job is no longer HOLD_PLACED/NEEDS_ATTENTION or whose cart
    has expired. Active unpaid carts get a lightweight touch to stay under the
    inactivity timeout.

    THR-122: NEEDS_ATTENTION (a parked takeover session after an unexpected
    hold failure) is kept alive by the exact same loop as a successful hold —
    it uses the same LIVE_BROWSERS entry and CartSession row, so there's
    nothing takeover-specific to add here beyond the status check.
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
                or job.status not in (JobStatus.HOLD_PLACED.value, JobStatus.NEEDS_ATTENTION.value)
                or active_cart is None
            ):
                if await close_live_browser(job_id):
                    closed += 1
                continue

            try:
                adapter = get_adapter(job.adapter_id)
            except ValueError as e:
                logger.warning(f"keep_live_carts_active: unknown adapter for job {job_id}: {e}")
                continue

            keepalive_minutes = adapter.cart_keepalive_interval_minutes
            if not keepalive_minutes:
                continue

            inactive_after_minutes = adapter.cart_inactive_after_minutes
            if inactive_after_minutes is not None and keepalive_minutes >= inactive_after_minutes:
                logger.warning(
                    "Adapter %s keepalive interval (%s min) is not below the "
                    "inactivity timeout (%s min)",
                    adapter.adapter_id, keepalive_minutes, inactive_after_minutes,
                )

            last_keepalive_at = entry.get("last_keepalive_at") or entry.get("created_at") or now
            if now - last_keepalive_at < timedelta(minutes=keepalive_minutes):
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
                logger.info(f"Sent keepalive heartbeat for job {job_id}")
            except Exception as e:
                logger.warning(f"Keepalive heartbeat failed for job {job_id}: {e}", exc_info=True)

    return {"checked": checked, "touched": touched, "closed": closed}


async def _park_for_takeover(adapter, page, job_id: str, cart_url: str | None) -> str:
    """Park the session for manual takeover, reusing the exact same
    machinery a successful hold uses (THR-122).

    ``cart_url`` is best-effort — an unexpected failure can strike before the
    adapter ever reaches a checkout URL, so this falls back to the page's
    current URL (whatever it's showing when things went sideways is exactly
    what the user needs to see/act on).

    Raises on failure (e.g. ``_persist_cart_session`` itself blowing up) so
    the caller can fail closed to the existing teardown + Hold Failed path
    rather than leave a browser alive with no corresponding CartSession row.
    """
    resume_url = await adapter._persist_cart_session(page, job_id, cart_url or page.url)
    logger.info(f"Parked job {job_id} for manual takeover: {resume_url}")
    return resume_url


async def attempt_hold_task(ctx: dict, job_id: str) -> dict:
    """Hold task. Launches a headed browser, re-verifies availability, and drives
    the full hold flow to the payment page. On success the browser is kept alive
    for the user to complete payment via VNC."""
    logger.info(f"Attempting hold for job {job_id}")

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

        credentials = await get_user_adapter_credentials(session, job.user_id or "", job.adapter_id)
        notification_settings = await get_user_notification_settings_secret(session, job.user_id or "")
        adapter.set_login_credentials(credentials)

        # If status isn't CHECKING, another hold already succeeded or the user
        # cancelled — skip to avoid a redundant attempt.
        await _resolve_lazy_expired_hold(session, job)
        if job.status != JobStatus.CHECKING.value:
            logger.info(f"Skipping hold for job {job_id}: status={job.status}")
            return {"job_id": job_id, "status": f"skipped_{job.status}"}

    # Close any stale live browser from a previous expired hold so the next
    # /pay view reconnects to the fresh cart.
    if await close_live_browser(job_id):
        logger.info(f"Closed stale live browser before retrying hold for {job_id}")

    booking: BookingResult | None = None
    availability_dropped = False
    fully_available: list = []
    # Set when an unexpected (not a known clean-negative) failure gets parked
    # for manual takeover instead of going through the normal Hold Failed
    # path. THR-122.
    needs_attention_url: str | None = None

    if adapter_requires_credentials(job.adapter_id) and credentials is None:
        logger.warning("Hold skipped for job %s: no stored credentials for adapter %s", job_id, job.adapter_id)
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
                registry=LIVE_BROWSERS,
            ) as (page, keep_alive):
                try:
                    await adapter.fill_form(page, params)
                    hold_results = await adapter.detect_availability(page, params)
                    logger.info(f"Hold-phase recheck for job {job_id}: {hold_results}")

                    fully_available = [r for r in hold_results if r.status == AvailabilityStatus.AVAILABLE]

                    if not fully_available:
                        logger.warning(f"Availability dropped before hold for job {job_id}")
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
                            logger.info(f"Adapter {adapter.adapter_id} does not support holds yet")
                except Exception as e:
                    # Every KNOWN clean-negative outcome (no availability, missing
                    # credentials, login rejected) is handled by the adapter itself
                    # and returns a BookingResult rather than raising — see
                    # attempt_hold's docstrings across the adapters. So anything
                    # that lands here (a locator timeout, an unrecognized blocking
                    # dialog like BC Parks' "Double Site" confirm, an explicit
                    # UnexpectedHoldFailure, or any other unhandled exception) is,
                    # by construction, the unexpected case THR-122 is for.
                    base = await _snapshot_safe(adapter, page, f"hold_error_{type(e).__name__}")
                    await _save_artifacts(
                        job_id,
                        _consume_adapter_artifacts(adapter),
                        last_base=base,
                        reset_history=True,
                    )
                    try:
                        needs_attention_url = await _park_for_takeover(
                            adapter, page, job_id, cart_url=None,
                        )
                    except Exception as park_exc:
                        # Fail closed: if parking itself blows up, don't leave a
                        # browser alive with no CartSession backing it — fall
                        # through to the outer except below, which tears the
                        # browser down and reports the original failure as a
                        # normal Hold Failed.
                        logger.error(
                            f"Parking for takeover failed for job {job_id}: {park_exc}",
                            exc_info=True,
                        )
                        raise e
                    # Parking succeeded — keep the browser alive for the user
                    # instead of letting the context manager close it, and
                    # swallow the exception here (it's been reported via the
                    # needs_attention path, not the Hold Failed one).
                    keep_alive(job_id)
        except Exception as e:
            logger.error(f"Hold task error for job {job_id}: {e}", exc_info=True)
            booking = BookingResult(success=False, held=False, message=f"Hold task error: {e}")

    # --- Notifications ---
    if needs_attention_url:
        # THR-122: this is time-critical — the browser is sitting on a live
        # cart/checkout page that a real booking site will silently release
        # after its own inactivity timeout, same as a normal hold. Fire this
        # immediately and at the same urgency as a secured hold.
        hold_minutes = adapter.cart_hold_minutes
        hold_window_copy = (
            f"You have about {hold_minutes} mins before the cart expires"
            if hold_minutes else "The cart may expire soon"
        )
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Needs your attention",
            message=(
                f"Hold worker hit something unexpected booking {params.get('date')} "
                "and paused with the browser still open on the live site — it needs "
                "a human to finish or cancel it.\n\n"
                f"{hold_window_copy}:\n{needs_attention_url}"
            ),
            priority=10,
        )
    elif booking and booking.held and booking.reservation_url:
        hold_minutes = adapter.cart_hold_minutes
        hold_window_copy = (
            f"{hold_minutes} mins to complete payment" if hold_minutes
            else "Complete payment before the cart expires"
        )
        site_lines = [f"  • {r.site} — {r.total_available} spot(s)" for r in fully_available]
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
        await dispatch_notification_targets(
            notification_settings,
            title="🏕️ Just missed it",
            message=f"Availability dropped before the hold could be placed for {params.get('date')}.",
            priority=7,
        )
    else:
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
            site_lines = [f"  • {r.site} — {r.total_available} spot(s)" for r in fully_available]
            await dispatch_notification_targets(
                notification_settings,
                title="🏕️ Available but hold failed",
                message=(
                    f"Sites available on {params.get('date')} but hold failed: {msg}\n"
                    + "\n".join(site_lines)
                ),
                priority=8,
            )

    # --- Status update ---
    held = bool(booking and booking.held)
    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if job is not None:
            if needs_attention_url:
                # Mirror the hold-succeeded shape (last_result is left as-is —
                # this isn't a failure record, it's a live session parked the
                # same way a successful hold is, just waiting on the user
                # instead of on payment).
                await _set_status(session, job, JobStatus.NEEDS_ATTENTION)
            elif held:
                await _set_status(session, job, JobStatus.HOLD_PLACED)
            elif job.enable_monitoring:
                fail_msg = booking.message if booking else "Hold was not attempted"
                job.last_result = json.dumps([{"type": "hold_failed", "error": fail_msg}])
                session.add(job)
                await _set_status(session, job, JobStatus.WAITING)
                job.next_check_at = utcnow() + timedelta(minutes=job.interval_minutes)
                session.add(job)
                await session.commit()
            else:
                fail_msg = booking.message if booking else "Hold was not attempted"
                job.last_result = json.dumps([{"type": "hold_failed", "error": fail_msg}])
                session.add(job)
                await _set_status(session, job, JobStatus.PAUSED)

    return {
        "job_id": job_id,
        "status": (
            "needs_attention" if needs_attention_url
            else "held" if held
            else ("availability_dropped" if availability_dropped else "hold_failed")
        ),
        "message": booking.message if booking else ("Needs attention" if needs_attention_url else ""),
    }


async def close_browser_task(ctx: dict, job_id: str) -> dict:
    """Close the live browser for a job. Enqueued by the API on cancel/complete.

    Must run on the hold queue to access this process's LIVE_BROWSERS. No-op
    if this worker doesn't own the browser.
    """
    closed = await close_live_browser(job_id)
    logger.info(f"close_browser_task job={job_id} closed={closed}")
    return {"job_id": job_id, "closed": closed}


async def assist_live_browser_task(ctx: dict, job_id: str, action: str, chars: str = "") -> dict:
    """Apply a UX assist action to a live payment page.

    Runs on the hold queue to access LIVE_BROWSERS in this process.
    """
    entry = LIVE_BROWSERS.get(job_id)
    if entry is None:
        logger.info(f"assist_live_browser_task: no live browser for {job_id}, action={action}")
        return {"job_id": job_id, "action": action, "ok": False, "reason": "no_live_browser"}

    page = entry.get("page")
    if page is None:
        logger.warning(f"assist_live_browser_task: LIVE_BROWSERS[{job_id}] has no page")
        return {"job_id": job_id, "action": action, "ok": False, "reason": "no_page"}

    try:
        result = await _assist_live_browser(page, action, chars=chars)
    except Exception as e:
        logger.warning(f"assist_live_browser_task failed for {job_id} action={action}: {e}")
        return {"job_id": job_id, "action": action, "ok": False, "reason": str(e)}

    logger.info(f"assist_live_browser_task job={job_id} action={action} result={result}")
    payload = result if isinstance(result, dict) else {"ok": True, "result": result}
    payload["job_id"] = job_id
    payload["action"] = action
    return payload


async def snapshot_complete_task(ctx: dict, job_id: str) -> dict:
    """Capture a screenshot of the booking-complete/receipt page before teardown.

    Runs on the hold queue (before close_browser_task) to access LIVE_BROWSERS.
    Persists the base path to job.last_artifact for the frontend receipt link.
    """
    entry = LIVE_BROWSERS.get(job_id)
    if entry is None:
        logger.info(f"snapshot_complete_task: no live browser for {job_id}, skipping")
        return {"job_id": job_id, "captured": False, "reason": "no_live_browser"}

    page = entry.get("page")
    if page is None:
        logger.warning(f"snapshot_complete_task: LIVE_BROWSERS[{job_id}] has no page")
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
    await _save_artifacts(job_id, _consume_adapter_artifacts(adapter), last_base=base)
    return {"job_id": job_id, "captured": base is not None, "base": base}


async def hold_worker_shutdown(ctx: dict) -> None:
    if LIVE_BROWSERS:
        job_ids = list(LIVE_BROWSERS.keys())
        logger.info(f"Hold worker shutting down with {len(job_ids)} live browser(s); closing: {job_ids}")
        for jid in job_ids:
            await close_live_browser(jid)
    logger.info("Hut Hunter hold worker shutting down")


class HoldWorkerSettings:
    """Hold worker — runs hold tasks on the dedicated hold queue."""
    functions = [
        attempt_hold_task,
        close_browser_task,
        assist_live_browser_task,
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
