import json
import logging
from datetime import datetime
from arq.connections import RedisSettings
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.models.job import WatchJob, utcnow
from sqlmodel import select

logger = logging.getLogger(__name__)


async def check_availability(ctx: dict, job_id: str) -> dict:
    """
    Core worker task — checks availability for a single WatchJob.
    ctx is injected by ARQ and contains our Redis connection + any
    startup state we define in WorkerSettings below.
    """
    logger.info(f"Checking availability for job {job_id}")

    async with AsyncSessionLocal() as session:
        job = await session.get(WatchJob, job_id)
        if not job:
            logger.warning(f"Job {job_id} not found")
            return {"error": "job not found"}

        params = json.loads(job.params)
        logger.info(f"Params: {params}")

        # TODO: load the correct adapter and run the check
        # For now just log and update last_checked_at
        job.last_checked_at = utcnow()
        job.last_result = json.dumps({"status": "stub — adapter not yet implemented"})
        session.add(job)
        await session.commit()

    return {"job_id": job_id, "status": "checked"}


async def startup(ctx: dict) -> None:
    """Runs once when the worker process starts."""
    logger.info("Hut Hunter worker starting up")


async def shutdown(ctx: dict) -> None:
    """Runs once when the worker process shuts down."""
    logger.info("Hut Hunter worker shutting down")


class WorkerSettings:
    """
    ARQ reads this class to configure the worker.
    functions = tasks this worker can execute
    redis_settings = where to find Redis
    """
    functions = [check_availability]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings(host="localhost", port=6379)