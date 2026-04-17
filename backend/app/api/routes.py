import json
import logging
from typing import List, cast
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from arq.connections import RedisSettings, create_pool

from app.core.database import get_session
from app.models.job import WatchJob, WatchJobCreate, WatchJobRead

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["jobs"])


async def get_redis():
    """Dependency — yields an ARQ redis connection."""
    pool = await create_pool(RedisSettings(host="localhost", port=6379))
    try:
        yield pool
    finally:
        await pool.aclose()


@router.get("/jobs", response_model=List[WatchJobRead])
async def list_jobs(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(WatchJob))
    jobs = result.scalars().all()
    return [WatchJobRead.from_db(j) for j in jobs]


@router.post("/jobs", response_model=WatchJobRead, status_code=201)
async def create_job(
    body: WatchJobCreate,
    session: AsyncSession = Depends(get_session)
):
    job = WatchJob(
        name=body.name,
        adapter_id=body.adapter_id,
        params=json.dumps(body.params),
        auto_book=body.auto_book,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return WatchJobRead.from_db(job)


@router.get("/jobs/{job_id}", response_model=WatchJobRead)
async def get_job(job_id: str, session: AsyncSession = Depends(get_session)):
    job = cast(WatchJob | None, await session.get(WatchJob, job_id))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return WatchJobRead.from_db(job)


@router.post("/jobs/{job_id}/trigger", status_code=202)
async def trigger_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
):
    """Manually enqueue a check for this job."""
    job = await session.get(WatchJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await redis.enqueue_job("check_availability", job_id)
    return {"status": "enqueued", "job_id": job_id}