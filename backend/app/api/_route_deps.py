"""Shared dependencies, helpers, and validation used across route modules."""

import json
import logging
from typing import Any

from fastapi import Depends, HTTPException
from arq.connections import RedisSettings, create_pool
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.adapters import adapter_requires_credentials, get_adapter
from app.core.adapter_credentials import get_user_configured_adapter_ids
from app.core.config import settings
from app.core.crypto import decrypt
from app.models.credential import AdapterCredential, AdapterCredentialRead
from app.models.job import JobStatus, WatchJob, WatchJobRead, as_utc, utcnow
from app.models.occupant import AdapterOccupant, Occupant
from app.models.session import CartSession
from app.models.user import AppUser
from app.workers._shared import _artifact_file_paths, _params_have_occupants

logger = logging.getLogger(__name__)

MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 120


async def get_redis():
    """Dependency — yields an ARQ redis connection."""
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        yield pool
    finally:
        await pool.aclose()


def _clamp_interval(minutes: int | None) -> int:
    """Clamp interval_minutes to [MIN, MAX]; falls back to 15 if None."""
    if minutes is None:
        return 15
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, int(minutes)))


# ---------------------------------------------------------------------------
# Artifact cleanup
# ---------------------------------------------------------------------------

def _job_artifact_bases(job: WatchJob) -> set[str]:
    bases: set[str] = set()
    if job.last_artifact:
        bases.add(job.last_artifact)
    try:
        parsed = json.loads(job.artifact_history) if job.artifact_history else []
    except Exception:
        parsed = []
    if isinstance(parsed, list):
        for entry in parsed:
            if isinstance(entry, dict):
                base = entry.get("base")
                if isinstance(base, str) and base:
                    bases.add(base)
    return bases


def _delete_job_artifacts(job: WatchJob) -> None:
    for base in _job_artifact_bases(job):
        for path in _artifact_file_paths(base):
            try:
                path.unlink(missing_ok=True)
            except Exception:
                logger.exception("Failed to delete artifact file %s", path)


# ---------------------------------------------------------------------------
# Ownership guards
# ---------------------------------------------------------------------------

async def _get_owned_job(session: AsyncSession, user_id: str, job_id: str) -> WatchJob:
    job = (await session.execute(
        select(WatchJob).where(WatchJob.id == job_id, WatchJob.user_id == user_id)
    )).scalars().first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _get_owned_occupant(session: AsyncSession, user_id: str, occupant_id: str) -> Occupant:
    occupant = (await session.execute(
        select(Occupant).where(Occupant.id == occupant_id, Occupant.user_id == user_id)
    )).scalars().first()
    if occupant is None:
        raise HTTPException(status_code=404, detail="Occupant not found")
    return occupant


# ---------------------------------------------------------------------------
# Job serialization
# ---------------------------------------------------------------------------

async def _latest_cart(session: AsyncSession, job_id: str) -> CartSession | None:
    return (await session.execute(
        select(CartSession)
        .where(CartSession.job_id == job_id)
        .order_by(CartSession.created_at.desc())
    )).scalars().first()


def _job_has_required_credentials(adapter_id: str, configured_adapter_ids: set[str]) -> bool:
    try:
        return not adapter_requires_credentials(adapter_id) or adapter_id in configured_adapter_ids
    except ValueError:
        return True


async def _serialize_job(
    session: AsyncSession,
    job: WatchJob,
    *,
    configured_adapter_ids: set[str] | None = None,
) -> WatchJobRead:
    cart = await _latest_cart(session, job.id)
    cart_expires_at = cart.expires_at if cart is not None else None
    if configured_adapter_ids is None:
        configured_adapter_ids = await get_user_configured_adapter_ids(session, job.user_id or "")
    try:
        needs_credentials = adapter_requires_credentials(job.adapter_id)
    except ValueError:
        needs_credentials = False
    credentials_configured = not needs_credentials or job.adapter_id in configured_adapter_ids
    return WatchJobRead.from_db(
        job,
        cart_expires_at=cart_expires_at,
        credentials_configured=credentials_configured,
    )


def _credential_record_to_read(credential: AdapterCredential) -> AdapterCredentialRead:
    return AdapterCredentialRead(
        id=credential.id,
        adapter_id=credential.adapter_id,
        username=decrypt(credential.encrypted_username),
        has_password=True,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


# ---------------------------------------------------------------------------
# Occupant validation (shared by job and occupant routes)
# ---------------------------------------------------------------------------

def _value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def _occupant_display_name(occupant: dict[str, Any], index: int) -> str:
    first = str(occupant.get("first_name", "")).strip()
    last = str(occupant.get("last_name", "")).strip()
    return f"{first} {last}".strip() or f"Occupant {index + 1}"


def _validate_adapter_values_payload(
    adapter_values: dict[str, dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    if adapter_values is None:
        return {}
    if not isinstance(adapter_values, dict):
        raise HTTPException(status_code=400, detail="adapter_values must be an object keyed by adapter ID.")

    normalized: dict[str, dict[str, Any]] = {}
    for adapter_id, raw_values in adapter_values.items():
        if not isinstance(adapter_id, str) or not adapter_id.strip():
            raise HTTPException(status_code=400, detail="adapter_values keys must be non-empty adapter IDs.")
        if not isinstance(raw_values, dict):
            raise HTTPException(status_code=400, detail=f"adapter_values.{adapter_id} must be an object.")

        try:
            adapter = get_adapter(adapter_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        fields = adapter.__class__.occupant_fields()
        fields_by_key = {field.key: field for field in fields}
        cleaned: dict[str, Any] = {}

        for field_key, value in raw_values.items():
            field = fields_by_key.get(field_key)
            if field is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"{adapter.name} does not define an occupant field named '{field_key}'.",
                )
            if not _value_present(value):
                continue
            if field.options and str(value) not in field.options:
                raise HTTPException(
                    status_code=400,
                    detail=f"{adapter.name} occupant field '{field.label}' must be one of the configured options.",
                )
            cleaned[field_key] = value

        if not cleaned:
            continue

        missing = [field.label for field in fields if field.required and not _value_present(cleaned.get(field.key))]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"{adapter.name} occupant details are incomplete: {', '.join(missing)}.",
            )
        normalized[adapter_id] = cleaned

    return normalized


async def _enqueue_browser_close(job_id: str, redis) -> None:
    """Ask the hold worker to tear down the headed browser. Fire-and-forget."""
    from app.workers.hold_worker import HOLD_QUEUE_NAME
    await redis.enqueue_job("close_browser_task", job_id, _queue_name=HOLD_QUEUE_NAME)


def _validate_job_occupants_for_adapter(adapter_id: str, params: dict) -> None:
    occupants = params.get("occupants")
    if not isinstance(occupants, list) or not occupants:
        return

    try:
        adapter = get_adapter(adapter_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    fields = adapter.__class__.occupant_fields()
    if not fields:
        return

    problems: list[str] = []
    for index, occupant in enumerate(occupants):
        if not isinstance(occupant, dict):
            problems.append(f"Occupant {index + 1} (invalid payload)")
            continue
        missing = [field.label for field in fields if field.required and not _value_present(occupant.get(field.key))]
        invalid = [
            field.label for field in fields
            if _value_present(occupant.get(field.key))
            and field.options
            and str(occupant.get(field.key)) not in field.options
        ]
        if missing or invalid:
            reasons: list[str] = []
            if missing:
                reasons.append(f"missing {', '.join(missing)}")
            if invalid:
                reasons.append(f"invalid {', '.join(invalid)}")
            problems.append(f"{_occupant_display_name(occupant, index)} ({'; '.join(reasons)})")

    if problems:
        raise HTTPException(
            status_code=409,
            detail=f"Selected occupants are missing required {adapter.name} details: {'; '.join(problems)}.",
        )
