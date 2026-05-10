"""Notification settings routes — encrypted per-user delivery targets."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.database import get_session
from app.core.notification_settings import (
    get_user_notification_settings_read,
    upsert_user_notification_settings,
)
from app.models.notification import UserNotificationSettingsRead, UserNotificationSettingsUpdate
from app.models.user import AppUser

router = APIRouter()


@router.get("/notifications", response_model=UserNotificationSettingsRead)
async def get_notification_settings(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    return await get_user_notification_settings_read(session, current_user.id)


@router.put("/notifications", response_model=UserNotificationSettingsRead)
async def update_notification_settings(
    body: UserNotificationSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    try:
        await upsert_user_notification_settings(
            session,
            user_id=current_user.id,
            email_enabled=body.email_enabled,
            email_address=body.email_address,
            gotify_enabled=body.gotify_enabled,
            gotify_url=body.gotify_url,
            gotify_token=body.gotify_token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await get_user_notification_settings_read(session, current_user.id)
