"""Booking credential routes — encrypted per-user adapter logins."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.adapters import adapter_requires_credentials
from app.api.auth import get_current_user
from app.api._route_deps import _credential_record_to_read, get_redis
from app.core.adapter_credentials import (
    get_adapter_credential_record,
    upsert_user_adapter_credentials,
)
from app.core.database import get_session
from app.models.credential import AdapterCredential, AdapterCredentialRead, AdapterCredentialUpsert
from app.models.user import AppUser
from app.workers.hold_worker import HOLD_QUEUE_NAME

logger = logging.getLogger(__name__)

router = APIRouter()


async def _enqueue_verify_credentials(user_id: str, adapter_id: str, redis) -> None:
    """Fire-and-forget verify_credentials_task — a Redis hiccup shouldn't
    fail the credential save itself (THR-123)."""
    try:
        await redis.enqueue_job("verify_credentials_task", user_id, adapter_id, _queue_name=HOLD_QUEUE_NAME)
    except Exception:
        logger.exception("Failed to enqueue verify_credentials_task for %s/%s", user_id, adapter_id)


@router.get("/credentials", response_model=list[AdapterCredentialRead])
async def list_credentials(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    result = await session.execute(
        select(AdapterCredential)
        .where(AdapterCredential.user_id == current_user.id)
        .order_by(AdapterCredential.adapter_id)
    )
    return [_credential_record_to_read(c) for c in result.scalars().all()]


@router.put("/credentials/{adapter_id}", response_model=AdapterCredentialRead)
async def upsert_credential(
    adapter_id: str,
    body: AdapterCredentialUpsert,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    redis=Depends(get_redis),
):
    try:
        if not adapter_requires_credentials(adapter_id):
            raise HTTPException(status_code=400, detail="This adapter does not use stored booking credentials.")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        credential = await upsert_user_adapter_credentials(
            session,
            user_id=current_user.id,
            adapter_id=adapter_id,
            username=body.username,
            password=body.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # THR-123: every save (new or rotated) starts a fresh login check —
    # is_verified is already reset to None by upsert_user_adapter_credentials.
    await _enqueue_verify_credentials(current_user.id, adapter_id, redis)

    return _credential_record_to_read(credential)


@router.post("/credentials/{adapter_id}/verify", status_code=202)
async def verify_credential(
    adapter_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    redis=Depends(get_redis),
):
    """Trigger an on-demand login check ("Verify now" / "Re-verify")."""
    credential = await get_adapter_credential_record(session, current_user.id, adapter_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="Credential not found")

    await _enqueue_verify_credentials(current_user.id, adapter_id, redis)
    return {"status": "enqueued"}


@router.delete("/credentials/{adapter_id}", status_code=204)
async def delete_credential(
    adapter_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    credential = await get_adapter_credential_record(session, current_user.id, adapter_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="Credential not found")
    await session.delete(credential)
    await session.commit()
    return None
