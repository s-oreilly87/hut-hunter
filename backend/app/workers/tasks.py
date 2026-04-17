import json
import logging

from arq.connections import RedisSettings

from app.adapters.base import AvailabilityStatus
from app.core.database import AsyncSessionLocal
from app.models.job import WatchJob, utcnow
from app.adapters import get_adapter
from sqlmodel import select
from playwright.async_api import async_playwright, ViewportSize


logger = logging.getLogger(__name__)

async def check_availability(ctx: dict, job_id: str) -> dict:
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
            job.last_result = json.dumps([{"error": str(e)}])
            job.last_checked_at = utcnow()
            session.add(job)
            await session.commit()
            return {"error": str(e)}

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                context = await browser.new_context(
                    viewport=ViewportSize(width=1440, height=900),
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                )
                page = await context.new_page()

                await adapter.fill_form(page, params)
                results = await adapter.detect_availability(page, params)

                await browser.close()

        except Exception as e:
            logger.error(f"Adapter error for job {job_id}: {e}", exc_info=True)
            job.last_result = json.dumps({"error": str(e)})
            job.last_checked_at = utcnow()
            session.add(job)
            await session.commit()
            return {"error": str(e)}

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

        fully_available = [r for r in results if r.status == AvailabilityStatus.AVAILABLE]
        partially_available = [r for r in results if r.status == AvailabilityStatus.PARTIALLY_AVAILABLE]

        if fully_available:
            logger.info(f"FULL availability found for job {job_id}: {fully_available}")
            # TODO: Gotify — full availability notification

        if partially_available:
            logger.info(f"PARTIAL availability found for job {job_id}: {partially_available}")
            # TODO: Gotify — partial availability notification

        job.last_checked_at = utcnow()
        job.last_result = json.dumps(result_dicts)
        session.add(job)
        await session.commit()

    return {"job_id": job_id, "status": "checked", "results": result_dicts}


async def startup(ctx: dict) -> None:
    logger.info("Hut Hunter worker starting up")


async def shutdown(ctx: dict) -> None:
    logger.info("Hut Hunter worker shutting down")


class WorkerSettings:
    functions = [check_availability]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings(host="localhost", port=6379)
    max_jobs = 1 # prevent multiple checks using same chromium instance - TODO: separate queues by adapter later