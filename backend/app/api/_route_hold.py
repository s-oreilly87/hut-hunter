"""Hold completion signals, pay page, and cart resume."""

import json
import logging
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.auth import get_current_user
from app.api._route_deps import (
    _enqueue_browser_close,
    _get_owned_job,
    _latest_cart,
    get_redis,
)
from app.core.config import settings
from app.core.crypto import decrypt
from app.core.database import get_session
from app.models.job import JobStatus, WatchJob, as_utc, utcnow
from app.models.session import CartSession
from app.models.user import AppUser
from app.workers.hold_worker import HOLD_QUEUE_NAME

logger = logging.getLogger(__name__)

router = APIRouter()
public_router = APIRouter()

# Load pay page template once at import time.
_PAY_TEMPLATE = (Path(__file__).parent / "templates" / "pay.html").read_text()


def _render_pay_page(job_id: str, vnc_config: dict, minutes_left: int) -> str:
    return (
        _PAY_TEMPLATE
        .replace("__JOB_ID__", json.dumps(job_id))
        .replace("__VNC_CONFIG__", json.dumps(vnc_config))
        .replace("__MINUTES_LEFT__", str(minutes_left))
    )


def _vnc_client_config() -> dict[str, str | int | None]:
    path = "websockify"
    if settings.vnc_url:
        vnc_url = settings.vnc_url.rstrip("/")
        parts = urlsplit(vnc_url)
        if parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
            explicit_path = parts.path.rstrip("/")
            if explicit_path:
                path = f"{explicit_path.lstrip('/')}/websockify"
            return {"base_url": vnc_url, "host": parts.hostname, "port": parts.port, "path": path}
        if parts.port is not None:
            return {"base_url": None, "host": None, "port": parts.port, "path": path}
    return {"base_url": None, "host": None, "port": settings.vnc_port, "path": path}


async def _enqueue_complete_snapshot(job_id: str, redis) -> None:
    """Must be enqueued before close_browser_task — hold queue is FIFO with max_jobs=1."""
    await redis.enqueue_job("snapshot_complete_task", job_id, _queue_name=HOLD_QUEUE_NAME)


async def _enqueue_live_browser_assist(job_id: str, action: str, redis, chars: str = "") -> None:
    args = [job_id, action]
    if chars:
        args.append(chars)
    await redis.enqueue_job("assist_live_browser_task", *args, _queue_name=HOLD_QUEUE_NAME)


class _AssistBody(BaseModel):
    chars: str = ""


async def _finalize_hold(
    session: AsyncSession,
    user_id: str,
    job_id: str,
    new_status: JobStatus,
) -> WatchJob:
    """Flip the job to a terminal hold status and stamp cart.completed_at."""
    job = await _get_owned_job(session, user_id, job_id)
    cart = await _latest_cart(session, job_id)
    if not cart:
        raise HTTPException(status_code=404, detail="No cart session for this job")
    if cart.completed_at is None:
        cart.completed_at = utcnow()
        session.add(cart)
    if job.status != new_status.value:
        job.status = new_status.value
        session.add(job)
    await session.commit()
    return job


@router.post("/jobs/{job_id}/complete", status_code=200)
async def complete_booking(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """User confirmed payment. Enqueues a receipt snapshot before closing the browser."""
    await _finalize_hold(session, current_user.id, job_id, JobStatus.BOOKING_COMPLETE)
    await _enqueue_complete_snapshot(job_id, redis)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "completed", "job_id": job_id}


@router.post("/jobs/{job_id}/cancel", status_code=200)
async def cancel_booking(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """User cancelled. Job moves to CANCELLED; re-trigger later to resume checking."""
    await _finalize_hold(session, current_user.id, job_id, JobStatus.CANCELLED)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "cancelled", "job_id": job_id}


_ASSIST_ACTIONS = {"scroll-up", "scroll-down", "scroll-top", "focus-next", "focus-prev", "send-text"}


@router.post("/jobs/{job_id}/assist/{action}", status_code=202)
async def assist_live_booking_page(
    job_id: str,
    action: str,
    body: Optional[_AssistBody] = Body(default=None),
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
    current_user: AppUser = Depends(get_current_user),
):
    """Remote UX assists for the mobile /pay experience (scroll, focus, text relay)."""
    if action not in _ASSIST_ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown assist action")
    chars = body.chars if body else ""
    if action == "send-text" and not chars:
        raise HTTPException(status_code=400, detail="chars required for send-text")
    job = await _get_owned_job(session, current_user.id, job_id)
    if job.status != JobStatus.HOLD_PLACED.value:
        raise HTTPException(status_code=409, detail="No live hold browser for this job")
    await _enqueue_live_browser_assist(job_id, action, redis, chars=chars)
    return {"queued": True, "job_id": job_id, "action": action}


@router.get("/jobs/{job_id}/resume")
async def resume_cart(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    """Inject saved cart cookies into the browser and redirect to the cart URL."""
    await _get_owned_job(session, current_user.id, job_id)
    cart = await _latest_cart(session, job_id)

    if not cart:
        return HTMLResponse("<h1>No cart session found for this job</h1>", status_code=404)
    if as_utc(cart.expires_at) < utcnow():
        return HTMLResponse("<h1>Cart session has expired</h1>", status_code=410)

    cookies = json.loads(decrypt(cart.encrypted_cookies))
    cookie_scripts = [
        f'document.cookie = {json.dumps(c["name"])} + "=" + {json.dumps(c["value"])}'
        f' + "; domain=" + {json.dumps(c.get("domain", ""))}'
        f' + "; path=" + {json.dumps(c.get("path", "/"))};'
        for c in cookies
    ]
    html = (
        "<!DOCTYPE html><html><head><title>Resuming booking...</title></head><body>"
        "<p>Resuming your booking session...</p>"
        f"<script>\n{'  ' + chr(10) + '  '.join(cookie_scripts)}\n"
        f"window.location.href = {json.dumps(cart.cart_url)};\n"
        "</script></body></html>"
    )
    return HTMLResponse(html)


@public_router.get("/pay/{job_id}")
async def pay(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    """Pay page — noVNC iframe into the headed Chromium parked on the checkout form.
    Renders only when the job is HOLD_PLACED and the cart is still live."""
    job = await _get_owned_job(session, current_user.id, job_id)
    cart = await _latest_cart(session, job_id)

    if job.status == JobStatus.BOOKING_COMPLETE.value:
        return HTMLResponse("<h1>Booking complete</h1><p>This booking was already marked complete.</p>", status_code=410)
    if job.status == JobStatus.CANCELLED.value:
        return HTMLResponse(
            "<h1>Hold cancelled</h1><p>This hold was cancelled. Re-trigger the job from the dashboard to resume checking.</p>",
            status_code=410,
        )
    if job.status != JobStatus.HOLD_PLACED.value:
        return HTMLResponse(
            f"<h1>No active hold</h1><p>Job status is '<b>{job.status}</b>'. A hold must be placed before there's a payment page to show.</p>",
            status_code=404,
        )
    if not cart:
        return HTMLResponse("<h1>No cart session for this job</h1>", status_code=404)

    cart_expires_at = as_utc(cart.expires_at)
    if cart_expires_at < utcnow():
        return HTMLResponse(
            "<h1>Hold expired</h1><p>The cart window has closed. Re-trigger the job to hold again.</p>",
            status_code=410,
        )

    seconds_left = int((cart_expires_at - utcnow()).total_seconds())
    minutes_left = max(0, seconds_left // 60)
    return HTMLResponse(_render_pay_page(job_id, _vnc_client_config(), minutes_left))
