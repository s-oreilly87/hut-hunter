"""Hold worker — browser management, hold tasks, and HoldWorkerSettings."""

import json
import logging
from datetime import timedelta
from typing import cast

from arq import cron
from arq.connections import RedisSettings

from app.adapters.base import AvailabilityStatus, BookingResult
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
    """Lightweight activity heartbeat for the payment page.

    Combines a same-origin fetch with DOM activity events to prevent
    inactivity timeouts without doing anything disruptive like reloads.
    """
    await page.evaluate(
        """async () => {
          const dispatch = (target, type, init = {}) => {
            target.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, clientX: 18, clientY: 18, ...init,
            }));
          };
          try {
            await fetch(window.location.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
          } catch (_) {}
          if (document.body) {
            dispatch(document.body, 'mousemove');
            dispatch(document.body, 'mousedown');
            dispatch(document.body, 'mouseup');
          }
          dispatch(document, 'mousemove');
          window.dispatchEvent(new Event('focus'));
        }"""
    )


async def _relay_text_into_active_element(page, text: str) -> None:
    """Dispatch keyboard events on the focused DOM element.

    More reliable than page.keyboard.type() because it doesn't require the
    Chrome window to hold OS focus at the CDP level.
    """
    await page.evaluate(
        """(text) => {
          const el = document.activeElement;
          if (!el) return;
          const tag = el.tagName.toLowerCase();
          for (const ch of text) {
            el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true, cancelable: true }));
            if (tag === 'input' || tag === 'textarea') {
              const start = el.selectionStart ?? el.value.length;
              const end   = el.selectionEnd   ?? el.value.length;
              el.value = el.value.slice(0, start) + ch + el.value.slice(end);
              el.selectionStart = el.selectionEnd = start + ch.length;
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
            }
            el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
          }
        }""",
        text,
    )


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

    if action == "scroll-up":
        return await page.evaluate(
            """() => {
              const root = document.scrollingElement || document.documentElement || document.body;
              const step = Math.max(Math.round(window.innerHeight * 0.72), 240);
              root.scrollBy({ top: -step, left: 0, behavior: 'auto' });
              return { ok: true, action: 'scroll-up', scrollTop: root.scrollTop };
            }"""
        )

    if action == "scroll-down":
        return await page.evaluate(
            """() => {
              const root = document.scrollingElement || document.documentElement || document.body;
              const step = Math.max(Math.round(window.innerHeight * 0.72), 240);
              root.scrollBy({ top: step, left: 0, behavior: 'auto' });
              return { ok: true, action: 'scroll-down', scrollTop: root.scrollTop };
            }"""
        )

    if action in {"focus-next", "focus-prev"}:
        direction = 1 if action == "focus-next" else -1
        return await page.evaluate(
            """(direction) => {
              const selector = [
                'input:not([type="hidden"]):not([disabled])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                'button:not([disabled])',
                '[contenteditable="true"]',
              ].join(',');

              const visibleControls = Array.from(document.querySelectorAll(selector)).filter((el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && rect.width > 0 && rect.height > 0;
              });

              if (!visibleControls.length) {
                return { ok: false, action: direction > 0 ? 'focus-next' : 'focus-prev', reason: 'no_focusable_controls' };
              }

              const active = document.activeElement;
              let currentIndex = visibleControls.findIndex((el) => el === active || el.contains(active));
              if (currentIndex === -1) currentIndex = direction > 0 ? -1 : 0;

              let nextIndex = currentIndex + direction;
              if (nextIndex < 0) nextIndex = visibleControls.length - 1;
              else if (nextIndex >= visibleControls.length) nextIndex = 0;

              const target = visibleControls[nextIndex];
              target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
              if (typeof target.focus === 'function') target.focus({ preventScroll: true });

              const tag = target.tagName.toLowerCase();
              const type = (target.getAttribute('type') || '').toLowerCase();
              if (tag === 'input' || tag === 'textarea') {
                if (typeof target.click === 'function') target.click();
                if (typeof target.setSelectionRange === 'function' && type !== 'checkbox' && type !== 'radio') {
                  const end = target.value ? target.value.length : 0;
                  target.setSelectionRange(end, end);
                }
              }

              return { ok: true, action: direction > 0 ? 'focus-next' : 'focus-prev', tag, id: target.id || null, name: target.getAttribute('name'), type };
            }""",
            direction,
        )

    if action == "scroll-top":
        return await page.evaluate(
            """() => {
              const root = document.scrollingElement || document.documentElement || document.body;
              root.scrollTo({ top: 0, left: 0, behavior: 'auto' });
              return { ok: true, action: 'scroll-top', scrollTop: root.scrollTop };
            }"""
        )

    return {"ok": False, "action": action, "reason": "unknown_action"}


async def keep_live_carts_active(ctx: dict) -> dict:
    """Cron heartbeat for browsers parked on the payment page.

    Runs on the hold queue so it can access LIVE_BROWSERS in-process. Closes
    browsers whose job is no longer HOLD_PLACED or whose cart has expired.
    Active unpaid carts get a lightweight touch to stay under the inactivity timeout.
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

            if job is None or job.status != JobStatus.HOLD_PLACED.value or active_cart is None:
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
                    base = await _snapshot_safe(adapter, page, f"hold_error_{type(e).__name__}")
                    await _save_artifacts(
                        job_id,
                        _consume_adapter_artifacts(adapter),
                        last_base=base,
                        reset_history=True,
                    )
                    raise
        except Exception as e:
            logger.error(f"Hold task error for job {job_id}: {e}", exc_info=True)
            booking = BookingResult(success=False, held=False, message=f"Hold task error: {e}")

    # --- Notifications ---
    if booking and booking.held and booking.reservation_url:
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
            if not held:
                fail_msg = booking.message if booking else "Hold was not attempted"
                job.last_result = json.dumps([{"type": "hold_failed", "error": fail_msg}])
                session.add(job)

            if held:
                await _set_status(session, job, JobStatus.HOLD_PLACED)
            elif job.enable_monitoring:
                await _set_status(session, job, JobStatus.WAITING)
                job.next_check_at = utcnow() + timedelta(minutes=job.interval_minutes)
                session.add(job)
                await session.commit()
            else:
                await _set_status(session, job, JobStatus.PAUSED)

    return {
        "job_id": job_id,
        "status": "held" if held else ("availability_dropped" if availability_dropped else "hold_failed"),
        "message": booking.message if booking else "",
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
