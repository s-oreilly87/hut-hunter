"""Booking credential routes — encrypted per-user adapter logins."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.adapters import adapter_requires_credentials
from app.api.auth import get_current_user
from app.api._route_deps import _credential_record_to_read
from app.core.adapter_credentials import (
    get_adapter_credential_record,
    upsert_user_adapter_credentials,
)
from app.core.database import get_session
from app.models.credential import AdapterCredential, AdapterCredentialRead, AdapterCredentialUpsert
from app.models.user import AppUser

logger = logging.getLogger(__name__)

router = APIRouter()


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

    return _credential_record_to_read(credential)


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
