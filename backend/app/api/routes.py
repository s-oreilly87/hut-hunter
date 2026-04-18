import json
import logging
from typing import List, cast
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from arq.connections import RedisSettings, create_pool

from app.core.config import settings
from app.core.database import get_session
from app.core.crypto import encrypt, decrypt
from app.models.job import (
    JobStatus,
    WatchJob,
    WatchJobCreate,
    WatchJobRead,
    utcnow,
)
from app.models.session import AdapterSession, CartSession
from app.adapters import list_adapters



logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["jobs"])
# Top-level (non-prefixed) routes. /pay/{job_id} is linked from Gotify push
# notifications, so it lives outside /api/v1 to keep the URL short and stable.
public_router = APIRouter(tags=["public"])


@router.get("/adapters")
async def get_adapters():
    return list_adapters()

# Jobs
async def get_redis():
    """Dependency — yields an ARQ redis connection."""
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
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
    """Manually enqueue a check for this job.

    Transitions the job into CHECKING and enqueues check_availability. If
    the job is already HOLD_PLACED and the cart hasn't expired, reject with
    409 — the user should finish or cancel the current hold via /pay first.
    Expired HOLD_PLACED is treated as CHECKING (lazy expiry)."""
    job = await session.get(WatchJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == JobStatus.HOLD_PLACED.value:
        cart = await _latest_cart(session, job_id)
        cart_still_live = (
            cart is not None
            and cart.completed_at is None
            and cart.expires_at > utcnow()
        )
        if cart_still_live:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A hold is already placed for this job. Finish or cancel "
                    f"it at /pay/{job_id} before triggering again."
                ),
            )
        # Lazy expiry: hold timed out without explicit signal. Flip back.
        logger.info(f"Lazy-expiring HOLD_PLACED for job {job_id} (cart expired)")

    job.status = JobStatus.CHECKING.value
    session.add(job)
    await session.commit()

    await redis.enqueue_job("check_availability", job_id)
    return {"status": "enqueued", "job_id": job_id}


# ---------------------------------------------------------------------------
# Booking completion signals from the /pay page
# ---------------------------------------------------------------------------
# /complete  -> status=BOOKING_COMPLETE (terminal), stamp cart.completed_at,
#               close browser.
# /cancel    -> status=CANCELLED (terminal-ish; user can re-trigger),
#               stamp cart.completed_at (the hold is unrecoverable once the
#               browser is gone, so there's no reason to keep the cart as
#               "active"), close browser.
#
# Both stamp completed_at because in either case the browser is being torn
# down and the cart cookies are abandoned — there is no path back to the
# checkout page without re-holding. Leaving the cart "active" would only
# block other workers pointlessly. If the user re-triggers a cancelled job
# while the DOC site's cart still exists on their side, the adapter will
# hit a "you already have a cart" state; that's a recoverable case and not
# worth preventing here.
#
# close_browser_task runs on the hold queue and is idempotent — double
# clicks just enqueue a second no-op close.

async def _enqueue_browser_close(job_id: str, redis) -> None:
    """Ask the hold worker to tear down the headed Chromium for this job.
    Fire-and-forget — the task is a no-op if the browser is already gone."""
    from app.workers.tasks import HOLD_QUEUE_NAME
    await redis.enqueue_job(
        "close_browser_task",
        job_id,
        _queue_name=HOLD_QUEUE_NAME,
    )


async def _latest_cart(session: AsyncSession, job_id: str) -> CartSession | None:
    return (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .order_by(CartSession.created_at.desc())
    )).scalars().first()


async def _finalize_hold(
    session: AsyncSession,
    job_id: str,
    new_status: JobStatus,
) -> WatchJob:
    """Shared body of /complete and /cancel — both flip the job into a
    terminal status, stamp the cart as completed, and commit. The caller
    separately enqueues the browser close."""
    job = await session.get(WatchJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

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
):
    """User pressed 'Booking Complete' on /pay. Job goes to BOOKING_COMPLETE
    (terminal — no reason to keep watching a hut already booked)."""
    await _finalize_hold(session, job_id, JobStatus.BOOKING_COMPLETE)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "completed", "job_id": job_id}


@router.post("/jobs/{job_id}/cancel", status_code=200)
async def cancel_booking(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
):
    """User pressed 'Cancel' on /pay. Job goes to CANCELLED — polling is
    halted; the user can re-trigger later to resume checking."""
    await _finalize_hold(session, job_id, JobStatus.CANCELLED)
    await _enqueue_browser_close(job_id, redis)
    return {"status": "cancelled", "job_id": job_id}


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


@public_router.get("/pay/{job_id}")
async def pay(
    job_id: str,
    session: AsyncSession = Depends(get_session),
):
    """
    Pay page — embedded noVNC iframe showing the headed Chromium running in
    the hold worker, already parked on the checkout/payment form. Only renders
    the iframe when the job is HOLD_PLACED and the cart is still within its
    25-minute window.
    """
    from fastapi.responses import HTMLResponse

    job = await session.get(WatchJob, job_id)
    if not job:
        return HTMLResponse("<h1>Job not found</h1>", status_code=404)

    cart = await _latest_cart(session, job_id)

    # Status-first: if the job isn't HOLD_PLACED, there's nothing to show.
    if job.status == JobStatus.BOOKING_COMPLETE.value:
        return HTMLResponse(
            "<h1>Booking complete</h1>"
            "<p>This booking was already marked complete.</p>",
            status_code=410,
        )
    if job.status == JobStatus.CANCELLED.value:
        return HTMLResponse(
            "<h1>Hold cancelled</h1>"
            "<p>This hold was cancelled. Re-trigger the job from the dashboard "
            "to resume checking.</p>",
            status_code=410,
        )
    if job.status != JobStatus.HOLD_PLACED.value:
        return HTMLResponse(
            f"<h1>No active hold</h1>"
            f"<p>Job status is '<b>{job.status}</b>'. A hold has to be placed "
            f"before there's a payment page to show.</p>",
            status_code=404,
        )

    if not cart:
        return HTMLResponse(
            "<h1>No cart session for this job</h1>",
            status_code=404,
        )

    if cart.expires_at < utcnow():
        # Hold_placed but the cart timed out — the status will get lazily
        # flipped back to CHECKING next time the job is triggered.
        return HTMLResponse(
            "<h1>Hold expired</h1>"
            "<p>The 25-minute cart window has closed. Re-trigger the job to hold again.</p>",
            status_code=410,
        )

    # noVNC's vnc_lite.html accepts connection details as query params so we
    # can just point the iframe at the right URL and let it auto-connect.
    # autoconnect=1 skips the splash screen; resize=remote asks the noVNC
    # client to tell the server to match the iframe size.
    vnc_base = settings.vnc_url.rstrip("/")
    vnc_embed_url = f"{vnc_base}/vnc_lite.html?autoconnect=1&resize=remote"

    # Minutes remaining until hold expires (displayed in the header).
    seconds_left = int((cart.expires_at - utcnow()).total_seconds())
    minutes_left = max(0, seconds_left // 60)

    # How many pixels of the iframe to crop off the top. Chromium's tab strip
    # (~36px) + omnibox (~44px) ≈ 80px on a default 1280x800 display. Tweak
    # this if the chrome gets taller/shorter.
    chrome_crop_px = 80

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Complete your booking</title>
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111;
      color: #eee;
    }}
    body {{
      display: flex;
      flex-direction: column;
      height: 100vh;
    }}
    header {{
      padding: 10px 16px;
      background: #1b1b1b;
      border-bottom: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex: 0 0 auto;
    }}
    header .left {{ font-weight: 600; }}
    header .right {{ color: #9cd; font-size: 0.9em; }}

    /* The VNC iframe is cropped from the top to hide the remote Chromium's
       address bar / tab strip. The wrapper clips overflow and the iframe is
       shifted up by `chrome_crop_px` and grown by the same amount so the
       bottom still lines up. */
    .vnc-frame {{
      position: relative;
      overflow: hidden;
      flex: 1 1 auto;
      background: #000;
      min-height: 0;
    }}
    .vnc-frame iframe {{
      position: absolute;
      left: 0;
      width: 100%;
      top: -{chrome_crop_px}px;
      height: calc(100% + {chrome_crop_px}px);
      border: 0;
      display: block;
      background: #000;
    }}

    .actions {{
      flex: 0 0 auto;
      display: flex;
      gap: 12px;
      padding: 14px 16px;
      background: #1b1b1b;
      border-top: 1px solid #333;
    }}
    .actions button {{
      flex: 1 1 0;
      padding: 18px 24px;
      font-size: 1.15rem;
      font-weight: 600;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      color: white;
      transition: filter 0.1s ease-in-out;
    }}
    .actions button:hover:not(:disabled) {{ filter: brightness(1.1); }}
    .actions button:disabled {{ opacity: 0.5; cursor: default; }}
    .actions .cancel {{ background: #b33a3a; }}
    .actions .complete {{ background: #2f8f3f; }}

    .banner {{
      flex: 0 0 auto;
      padding: 8px 16px;
      background: #3a2f14;
      color: #ffd58a;
      font-size: 0.85em;
      border-bottom: 1px solid #5a4820;
      line-height: 1.4;
    }}
    .banner strong {{ color: #ffe8b0; }}

    #status {{
      flex: 0 0 auto;
      padding: 10px 16px;
      background: #222;
      font-size: 0.9em;
      color: #aaa;
      border-top: 1px solid #333;
      min-height: 1.2em;
    }}
    #status.ok {{ color: #9be89b; }}
    #status.err {{ color: #f08a8a; }}
  </style>
</head>
<body>
  <header>
    <div class="left">Hut Hunter — complete your booking</div>
    <div class="right">Hold expires in ~{minutes_left} min</div>
  </header>

  <div class="banner">
    <strong>Heads up:</strong>
    click <strong>Booking Complete</strong> after you've paid — the job moves
    to <em>Booking Complete</em> and polling stops. Clicking
    <strong>Cancel</strong> closes the browser and moves the job to
    <em>Cancelled</em>; re-trigger it later to resume checking. Closing this
    tab without clicking either leaves the hold in limbo.
  </div>

  <div class="vnc-frame">
    <iframe src="{vnc_embed_url}" allow="clipboard-read; clipboard-write"></iframe>
  </div>

  <div class="actions">
    <button class="cancel" id="btn-cancel" type="button">Cancel</button>
    <button class="complete" id="btn-complete" type="button">Booking Complete</button>
  </div>
  <div id="status"></div>

  <script>
    const jobId = {json.dumps(job_id)};
    const status = document.getElementById('status');
    const btnCancel = document.getElementById('btn-cancel');
    const btnComplete = document.getElementById('btn-complete');

    // Set once the user has clicked Cancel or Booking Complete — at that
    // point the browser-close signal is already in flight and closing the
    // tab is fine, so we suppress the beforeunload prompt.
    let signaled = false;

    async function post(action, confirmMsg) {{
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      btnCancel.disabled = true;
      btnComplete.disabled = true;
      status.className = '';
      status.textContent = 'Working…';
      try {{
        const res = await fetch(`/api/v1/jobs/${{jobId}}/${{action}}`, {{ method: 'POST' }});
        if (!res.ok) throw new Error(`HTTP ${{res.status}}`);
        await res.json();
        signaled = true;
        status.className = 'ok';
        status.textContent = action === 'complete'
          ? 'Booking marked complete. Browser closing, job moved to Booking Complete. Safe to close this tab.'
          : 'Hold cancelled. Browser closing, job moved to Cancelled. Re-trigger the job from the dashboard to resume checking.';
      }} catch (e) {{
        status.className = 'err';
        status.textContent = 'Failed: ' + e.message;
        btnCancel.disabled = false;
        btnComplete.disabled = false;
      }}
    }}

    btnCancel.addEventListener('click', () => post('cancel',
      'Cancel this hold?\\n\\n' +
      'The browser will close and the job will move to "Cancelled". ' +
      'Re-trigger it later to resume checking.'));
    btnComplete.addEventListener('click', () => post('complete',
      'Mark this booking as complete?\\n\\n' +
      'The browser will close and the job will move to ' +
      '"Booking Complete". Polling will stop for this job.'));

    // Warn if the user tries to close/reload before signaling. Modern
    // browsers show a generic "Changes may not be saved" dialog — returning
    // any truthy string is enough to trigger it. This is best-effort: some
    // browsers (esp. mobile) ignore this entirely.
    window.addEventListener('beforeunload', (e) => {{
      if (signaled) return;
      const msg =
        'Closing now leaves the hold in limbo. Click Cancel or ' +
        'Booking Complete so Hut Hunter knows what to do with this job.';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }});
  </script>
</body>
</html>"""

    return HTMLResponse(html)