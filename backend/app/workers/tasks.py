import json
import logging
import os
from contextlib import asynccontextmanager
from typing import cast

from arq.connections import RedisSettings

from app.adapters.base import AvailabilityStatus, BookingResult
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.notify import notify_gotify
from app.models.job import WatchJob, utcnow
from app.adapters import get_adapter
from playwright.async_api import async_playwright, ViewportSize

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _browser_page(
    storage_state: dict | None,
    *,
    headless: bool,
    display: str | None = None,
):
    """Open a Playwright Chromium page with the requested mode.

    When ``headless=False`` and ``display`` is set, Chromium is launched against
    that X display (e.g. ":99" inside the Docker image with Xvfb). On dev
    machines leave ``display`` unset and the host's default display is used.
    Falls back to a plain headed launch if the display-targeted launch fails.
    """
    launch_kwargs: dict = {"headless": headless}
    if not headless and display:
        # Playwright replaces the subprocess env when this is set, so merge.
        launch_kwargs["env"] = {**os.environ, "DISPLAY": display}

    async with async_playwright() as pw:
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

        try:
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
            yield page
        finally:
            await browser.close()


async def check_availability(ctx: dict, job_id: str) -> dict:
    logger.info(f"Checking availability for job {job_id}")

    # --- 1. Fetch job + params ---
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
            await _save_error(job_id, str(e))
            return {"error": str(e)}

        # Fetch storage state while session is open
        storage_state = await adapter.get_storage_state(session)
        logger.info(f"Storage state loaded for {job.adapter_id}: {storage_state is not None}")
        auto_book = job.auto_book

    results = []
    fully_available: list = []
    partially_available: list = []
    booking: BookingResult | None = None
    availability_dropped = False

    # --- 2. Detect phase (headless) ---
    try:
        async with _browser_page(
            storage_state, headless=settings.browser_headless_detect
        ) as page:
            await adapter.fill_form(page, params)
            results = await adapter.detect_availability(page, params)
            logger.info(f"Detect results for job {job_id}: {results}")
    except Exception as e:
        logger.error(f"Detect phase error for job {job_id}: {e}", exc_info=True)
        await _save_error(job_id, str(e))
        return {"error": str(e)}

    fully_available = [r for r in results if r.status == AvailabilityStatus.AVAILABLE]
    partially_available = [
        r for r in results if r.status == AvailabilityStatus.PARTIALLY_AVAILABLE
    ]

    # --- 3. Hold phase (headed) — only if there's something to book ---
    if fully_available and auto_book:
        try:
            async with _browser_page(
                storage_state,
                headless=False,
                display=settings.browser_display,
            ) as page:
                await adapter.fill_form(page, params)
                hold_results = await adapter.detect_availability(page, params)
                logger.info(f"Hold-phase recheck for job {job_id}: {hold_results}")

                hold_fully = [
                    r for r in hold_results if r.status == AvailabilityStatus.AVAILABLE
                ]

                if not hold_fully:
                    logger.warning(
                        f"Availability dropped between phases for job {job_id}; skipping hold"
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
                    except NotImplementedError:
                        logger.info(
                            f"Adapter {adapter.adapter_id} does not support holds yet"
                        )
        except Exception as e:
            logger.error(f"Hold phase error for job {job_id}: {e}", exc_info=True)
            booking = BookingResult(
                success=False, held=False, message=f"Hold phase error: {e}"
            )

    # --- 4. Notifications ---
    if fully_available:
        if auto_book:
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
                for r in fully_available:
                    await notify_gotify(
                        title="🏕️ Just missed it",
                        message=(
                            f"{r.site} showed {r.total_available} spot(s) on "
                            f"{params.get('date')} during the check, but availability "
                            f"dropped before the hold could be placed."
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
        else:
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

    # --- 5. Write results to DB ---
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
            session.add(job)
            await session.commit()

    return {"job_id": job_id, "status": "checked", "results": result_dicts}


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


class WorkerSettings:
    functions = [check_availability]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings(host="localhost", port=6379)
    max_jobs = 1  # prevent concurrent checks — TODO: separate queues by adapter later
    job_timeout = 120  # 2 minutes for full booking flow
