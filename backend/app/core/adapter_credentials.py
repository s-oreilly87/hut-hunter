from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt, encrypt
from app.models.credential import AdapterCredential, AdapterCredentialSecret
from app.models.job import utcnow


def _clean_credential_text(value: str, *, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} is required.")
    return cleaned


async def get_adapter_credential_record(
    session: AsyncSession,
    user_id: str,
    adapter_id: str,
) -> AdapterCredential | None:
    return (
        await session.execute(
            select(AdapterCredential).where(
                AdapterCredential.user_id == user_id,
                AdapterCredential.adapter_id == adapter_id,
            )
        )
    ).scalars().first()


async def get_user_adapter_credentials(
    session: AsyncSession,
    user_id: str,
    adapter_id: str,
) -> AdapterCredentialSecret | None:
    record = await get_adapter_credential_record(session, user_id, adapter_id)
    if record is None:
        return None
    return AdapterCredentialSecret(
        username=decrypt(record.encrypted_username),
        password=decrypt(record.encrypted_password),
    )


async def get_user_configured_adapter_ids(
    session: AsyncSession,
    user_id: str,
) -> set[str]:
    result = await session.execute(
        select(AdapterCredential.adapter_id).where(AdapterCredential.user_id == user_id)
    )
    return {adapter_id for adapter_id in result.scalars().all() if adapter_id}


async def get_user_failed_adapter_ids(
    session: AsyncSession,
    user_id: str,
) -> set[str]:
    """Adapter IDs whose stored credential failed verification (THR-123).

    A failed credential is treated as unusable everywhere
    ``credentials_configured`` is consumed — same UX as no credentials at
    all — so this is meant to be subtracted from
    ``get_user_configured_adapter_ids``'s result, not used standalone.
    """
    result = await session.execute(
        select(AdapterCredential.adapter_id).where(
            AdapterCredential.user_id == user_id,
            AdapterCredential.is_verified.is_(False),
        )
    )
    return {adapter_id for adapter_id in result.scalars().all() if adapter_id}


async def upsert_user_adapter_credentials(
    session: AsyncSession,
    *,
    user_id: str,
    adapter_id: str,
    username: str,
    password: str | None,
) -> AdapterCredential:
    cleaned_username = _clean_credential_text(username, field_name="Username")
    cleaned_password = password.strip() if password is not None else None

    record = await get_adapter_credential_record(session, user_id, adapter_id)
    now = utcnow()

    if record is None:
        if not cleaned_password:
            raise ValueError("Password is required.")
        record = AdapterCredential(
            user_id=user_id,
            adapter_id=adapter_id,
            encrypted_username=encrypt(cleaned_username),
            encrypted_password=encrypt(cleaned_password),
            created_at=now,
            updated_at=now,
        )
    else:
        record.encrypted_username = encrypt(cleaned_username)
        if cleaned_password:
            record.encrypted_password = encrypt(cleaned_password)
        record.updated_at = now
        # THR-123: any change to the sign-in resets verification — a stale
        # is_verified=True would otherwise keep gating holds open on a
        # credential nobody has actually re-checked yet.
        record.is_verified = None
        record.verified_at = None

    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record
