from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.crypto import decrypt, encrypt
from app.models.job import utcnow
from app.models.notification import (
    UserNotificationSettings,
    UserNotificationSettingsRead,
    UserNotificationSettingsSecret,
)


def _clean_email_address(value: str) -> str:
    cleaned = value.strip().lower()
    if "@" not in cleaned or cleaned.startswith("@") or cleaned.endswith("@"):
        raise ValueError("A valid notification email address is required.")
    return cleaned


def _clean_secret_text(value: str, *, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} is required.")
    return cleaned


def _clean_gotify_url(value: str) -> str:
    return _clean_secret_text(value, field_name="Gotify URL").rstrip("/")


def _decrypt_optional(value: str | None) -> str | None:
    if not value:
        return None
    return decrypt(value)


async def get_user_notification_settings_record(
    session: AsyncSession,
    user_id: str,
) -> UserNotificationSettings | None:
    return (
        await session.execute(
            select(UserNotificationSettings).where(
                UserNotificationSettings.user_id == user_id
            )
        )
    ).scalars().first()


async def get_user_notification_settings_secret(
    session: AsyncSession,
    user_id: str,
) -> UserNotificationSettingsSecret:
    if not user_id:
        return UserNotificationSettingsSecret()

    record = await get_user_notification_settings_record(session, user_id)
    if record is None:
        return UserNotificationSettingsSecret()

    return UserNotificationSettingsSecret(
        email_enabled=record.email_enabled,
        email_address=_decrypt_optional(record.encrypted_email_address),
        gotify_enabled=record.gotify_enabled,
        gotify_url=_decrypt_optional(record.encrypted_gotify_url),
        gotify_token=_decrypt_optional(record.encrypted_gotify_token),
    )


async def get_user_notification_settings_read(
    session: AsyncSession,
    user_id: str,
) -> UserNotificationSettingsRead:
    secret = await get_user_notification_settings_secret(session, user_id)
    return UserNotificationSettingsRead.from_secret(secret)


async def upsert_user_notification_settings(
    session: AsyncSession,
    *,
    user_id: str,
    email_enabled: bool | None,
    email_address: str | None,
    gotify_enabled: bool | None,
    gotify_url: str | None,
    gotify_token: str | None,
) -> UserNotificationSettings:
    record = await get_user_notification_settings_record(session, user_id)
    now = utcnow()

    if record is None:
        record = UserNotificationSettings(
            user_id=user_id,
            created_at=now,
            updated_at=now,
        )

    next_email_address = _decrypt_optional(record.encrypted_email_address)
    next_gotify_url = _decrypt_optional(record.encrypted_gotify_url)
    next_gotify_token = _decrypt_optional(record.encrypted_gotify_token)

    if email_address is not None:
        next_email_address = _clean_email_address(email_address)
        record.encrypted_email_address = encrypt(next_email_address)

    if gotify_url is not None:
        next_gotify_url = _clean_gotify_url(gotify_url)
        record.encrypted_gotify_url = encrypt(next_gotify_url)

    if gotify_token is not None:
        next_gotify_token = _clean_secret_text(
            gotify_token,
            field_name="Gotify token",
        )
        record.encrypted_gotify_token = encrypt(next_gotify_token)

    if email_enabled is not None:
        if email_enabled and not next_email_address:
            raise ValueError(
                "Save an email address before enabling email notifications."
            )
        record.email_enabled = email_enabled

    if gotify_enabled is not None:
        if gotify_enabled and not (next_gotify_url and next_gotify_token):
            raise ValueError(
                "Save a Gotify URL and token before enabling Gotify notifications."
            )
        record.gotify_enabled = gotify_enabled

    record.updated_at = now
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record
