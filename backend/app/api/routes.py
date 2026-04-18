import json
import logging
from typing import List, cast
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from arq.connections import RedisSettings, create_pool

from app.core.database import get_session
from app.core.crypto import encrypt, decrypt
from app.models.job import WatchJob, WatchJobCreate, WatchJobRead, utcnow
from app.models.session import AdapterSession, CartSession
from app.adapters import list_adapters



logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["jobs"])


@router.get("/adapters")
async def get_adapters():
    return list_adapters()

# Jobs
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


# Sessions
@router.post("/adapters/{adapter_id}/session", status_code=201)
async def store_adapter_session(
    adapter_id: str,
    body: dict,
    session: AsyncSession = Depends(get_session)
):
    """Store encrypted Playwright storageState for an adapter."""
    from sqlmodel import select
    existing = (await session.execute(
        select(AdapterSession).where(AdapterSession.adapter_id == adapter_id)
    )).scalar_one_or_none()

    encrypted = encrypt(json.dumps(body))

    if existing:
        existing.encrypted_state = encrypted
        existing.updated_at = utcnow()
        session.add(existing)
    else:
        adapter_session = AdapterSession(
            adapter_id=adapter_id,
            encrypted_state=encrypted,
        )
        session.add(adapter_session)

    await session.commit()
    return {"status": "ok", "adapter_id": adapter_id}


@router.get("/adapters/{adapter_id}/session/status")
async def get_session_status(
    adapter_id: str,
    session: AsyncSession = Depends(get_session)
):
    """Check if a session exists for an adapter."""
    from sqlmodel import select
    existing = (await session.execute(
        select(AdapterSession).where(AdapterSession.adapter_id == adapter_id)
    )).scalar_one_or_none()

    if not existing:
        return {"has_session": False}

    return {
        "has_session": True,
        "updated_at": existing.updated_at,
        "expires_at": existing.expires_at,
    }


@router.get("/jobs/{job_id}/resume")
async def resume_cart(
    job_id: str,
    session: AsyncSession = Depends(get_session)
):
    from fastapi.responses import HTMLResponse
    from sqlmodel import select

    # Multiple cart sessions may exist per job if attempt_hold ran more than once;
    # always use the most recent.
    cart = (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .order_by(CartSession.created_at.desc())
    )).scalars().first()

    if not cart:
        return HTMLResponse("<h1>No cart session found for this job</h1>", status_code=404)

    if cart.expires_at < utcnow():
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