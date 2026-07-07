"""Shared helpers used by both the poll worker and the hold worker."""

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import cast

from playwright.async_api import async_playwright, ViewportSize
from sqlmodel import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
import app.models  # noqa: F401 - registers SQLModel metadata
from app.models.job import JobStatus, WatchJob, as_optional_utc, utcnow
from app.models.session import CartSession

logger = logging.getLogger(__name__)

UNAVAILABLE_SNAPSHOT_LABEL = "unavailable"

# THR-124: once a hunt auto-arms at its computed booking-window-open time,
# poll it aggressively for a short burst — this is the actual competitive
# window for beating the launch-morning rush on a Camis site — then fall
# back to the job's own configured interval_minutes.
WINDOW_BURST_MINUTES = 15
WINDOW_BURST_INTERVAL_MINUTES = 1


def _effective_interval_minutes(job: WatchJob) -> int:
    """Minutes until the next scheduled check for ``job``.

    Returns the tight THR-124 burst cadence while ``window_burst_until`` is
    set and still in the future, otherwise the job's configured
    ``interval_minutes`` (unchanged pre-THR-124 behavior).
    """
    burst_until = as_optional_utc(job.window_burst_until)
    if burst_until is not None and utcnow() < burst_until:
        return WINDOW_BURST_INTERVAL_MINUTES
    return job.interval_minutes

# Stable ARQ job ID for check_availability dedup.
# ARQ rejects a duplicate enqueue with the same _job_id while one is
# pending/running — giving us at-most-one-queued per watch job.
# Must stay in sync with any caller that constructs this ID manually.
def _check_job_arq_id(job_id: str) -> str:
    return f"check_availability:{job_id}"


def _params_have_occupants(params: dict) -> bool:
    occupants = params.get("occupants")
    return isinstance(occupants, list) and len(occupants) > 0


# ---------------------------------------------------------------------------
# Artifact helpers
# ---------------------------------------------------------------------------

def _artifact_file_paths(base: str) -> list[Path]:
    if base.startswith("artifacts/"):
        base = base[len("artifacts/"):]
    artifact_base = settings.artifacts_dir / base
    return [
        artifact_base.with_suffix(".jpg"),
        artifact_base.with_suffix(".png"),
        artifact_base.with_suffix(".html"),
    ]


def _delete_artifact_files(base: str) -> None:
    for path in _artifact_file_paths(base):
        try:
            path.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Failed to delete artifact file {path}: {e}")


async def _snapshot_safe(adapter, page, label: str) -> str | None:
    """Best-effort snapshot — never raises, so it's safe to call inside except blocks.

    Returns the saved base path (no extension) on success, or None on failure.
    """
    try:
        base = await adapter.snapshot(page, label)
        logger.info(f"Saved artifact: {base}")
        return base
    except Exception as snap_e:
        logger.error(f"Failed to snapshot '{label}': {snap_e}", exc_info=True)
        return None


def _remove_artifacts_from_job(job: WatchJob, labels: set[str]) -> set[str]:
    try:
        parsed = json.loads(job.artifact_history) if job.artifact_history else []
    except Exception:
        parsed = []
    history = parsed if isinstance(parsed, list) else []

    kept_history: list[dict] = []
    removed_bases: set[str] = set()
    for entry in history:
        if not isinstance(entry, dict):
            continue
        base = entry.get("base")
        if entry.get("label") in labels and isinstance(base, str) and base:
            removed_bases.add(base)
            continue
        kept_history.append(entry)

    if not removed_bases:
        return set()

    for base in removed_bases:
        _delete_artifact_files(base)

    if job.last_artifact in removed_bases:
        job.last_artifact = None
    job.artifact_history = json.dumps(kept_history) if kept_history else None
    return removed_bases


def _remove_hold_artifacts_from_job(job: WatchJob) -> set[str]:
    return _remove_artifacts_from_job(job, {"reservation_details", "shopping_cart"})


async def _clear_unavailable_snapshot(job_id: str) -> None:
    """Delete the previous unavailable snapshot for this job.

    Every unavailable poll produces one; keeping only the latest prevents
    unattended monitoring from filling the artifact directory.
    """
    try:
        async with AsyncSessionLocal() as session:
            job = cast(WatchJob | None, await session.get(WatchJob, job_id))
            if job is None:
                return
            removed_bases = _remove_artifacts_from_job(job, {UNAVAILABLE_SNAPSHOT_LABEL})
            if not removed_bases:
                return
            session.add(job)
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to clear unavailable snapshot for job {job_id}: {e}", exc_info=True)


async def _save_artifacts(
    job_id: str,
    artifacts: list[dict],
    *,
    last_base: str | None = None,
    reset_history: bool = False,
) -> None:
    """Persist artifact base path and history. Swallows DB errors so callers
    never mask their own exceptions."""
    if not last_base and not artifacts and not reset_history:
        return
    try:
        async with AsyncSessionLocal() as session:
            job = cast(WatchJob | None, await session.get(WatchJob, job_id))
            if job is None:
                return

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
        logger.error(f"Failed to save artifacts for job {job_id}: {e}", exc_info=True)


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


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def _get_active_cart(session, job_id: str) -> CartSession | None:
    """Return the most recent non-expired, non-completed cart for this job."""
    return (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .where(CartSession.expires_at > utcnow())
        .where(CartSession.completed_at.is_(None))
        .order_by(CartSession.created_at.desc())
    )).scalars().first()


async def _set_status(session, job: WatchJob, status: JobStatus) -> None:
    """Commit a status transition. Idempotent — skips the write if already in that state."""
    if job.status == status.value:
        return
    logger.info(f"Job {job.id} status: {job.status} -> {status.value}")
    job.status = status.value
    session.add(job)
    await session.commit()


_LIVE_HOLD_STATUS_VALUES = {JobStatus.HOLD_PLACED.value, JobStatus.NEEDS_ATTENTION.value}


async def _resolve_lazy_expired_hold(session, job: WatchJob) -> None:
    """Flip HOLD_PLACED/NEEDS_ATTENTION back to CHECKING if no active cart remains.

    Handles the case where a hold's cart expired without an explicit signal —
    the next poll or hold attempt detects this and resumes checking.

    THR-122: NEEDS_ATTENTION (an unexpected-failure takeover session) parks a
    cart exactly like HOLD_PLACED, so it expires the same way — reusing this
    check rather than a parallel one.
    """
    if job.status not in _LIVE_HOLD_STATUS_VALUES:
        return
    if await _get_active_cart(session, job.id) is None:
        logger.info(f"Lazy-expiring {job.status} for job {job.id} (no live cart)")
        _remove_hold_artifacts_from_job(job)
        await _set_status(session, job, JobStatus.CHECKING)


async def _save_error(job_id: str, error: str) -> None:
    async with AsyncSessionLocal() as session:
        job = cast(WatchJob | None, await session.get(WatchJob, job_id))
        if job:
            job.last_result = json.dumps([{"error": error}])
            job.last_checked_at = utcnow()
            session.add(job)
            await session.commit()


def _was_previously_partial(last_result_json: str | None) -> bool:
    """Return True if the last stored result was a partial or mixed-availability outcome.

    Partial means at least one "partially_available" entry, or a mix of
    "available" and "unavailable". Error-shaped entries (no "status" key) are ignored.
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
    return "available" in statuses and "unavailable" in statuses


# ---------------------------------------------------------------------------
# Browser context manager
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _browser_page(
    *,
    headless: bool,
    display: str | None = None,
    registry: dict | None = None,
):
    """Open a Playwright Chromium page and yield ``(page, keep_alive)``.

    Calling ``keep_alive(job_id)`` before the context exits transfers browser
    ownership into ``registry[job_id]`` and suppresses the normal close. Pass
    ``registry=LIVE_BROWSERS`` from the hold worker to enable this; the poll
    worker omits it and the browser always closes on exit.

    When ``headless=False`` and ``display`` is set, Chromium is launched
    against that X display (e.g. ":99" with Xvfb). Falls back to the default
    display if the targeted launch fails.
    """
    launch_kwargs: dict = {"headless": headless}
    if not headless and display:
        launch_kwargs["env"] = {**os.environ, "DISPLAY": display}

    # Mutable sentinel so keep_alive() can signal back to the finally block.
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
        if keep_key[0] is not None and registry is not None and browser is not None and page is not None:
            registry[keep_key[0]] = {
                "pw_cm": pw_cm,
                "browser": browser,
                "context": context,
                "page": page,
                "created_at": utcnow(),
                "last_keepalive_at": utcnow(),
            }
            logger.info(
                f"Browser kept alive for job {keep_key[0]} "
                f"(total live: {len(registry)})"
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


async def startup(ctx: dict) -> None:
    logger.info("Hut Hunter worker starting up")
