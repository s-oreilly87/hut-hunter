from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import adapter_ids_for_credential_key, credential_key_for_adapter
from app.core.crypto import decrypt, encrypt
from app.models.credential import AdapterCredential, AdapterCredentialSecret, CredentialVerificationState
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
    """Look up the stored credential for ``adapter_id``.

    THR-126: resolved through ``credential_key_for_adapter`` first, so
    adapters sharing a ``credential_realm`` (the DOC adapters) all read/write
    the exact same row regardless of which concrete adapter_id the caller
    passed in.

    Falls back to a lookup by the literal ``adapter_id`` if the realm key
    finds nothing — a credential saved under its own concrete adapter_id
    BEFORE that adapter declared a ``credential_realm`` (a pre-existing row
    from before this migration) must still resolve, not silently vanish the
    moment the realm is introduced. The next save through
    ``upsert_user_adapter_credentials`` consolidates it under the realm key.
    """
    key = credential_key_for_adapter(adapter_id)
    record = (
        await session.execute(
            select(AdapterCredential).where(
                AdapterCredential.user_id == user_id,
                AdapterCredential.adapter_id == key,
            )
        )
    ).scalars().first()
    if record is not None or key == adapter_id:
        return record
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
    """Concrete adapter_ids the user has a usable saved sign-in for.

    THR-126: a row stored under a shared ``credential_realm`` key (e.g.
    "doc_govt_nz") is expanded back into every concrete adapter_id that
    realm covers, so callers checking ``job.adapter_id in
    configured_adapter_ids`` keep working unchanged whether or not that
    adapter shares its credentials with another one.
    """
    result = await session.execute(
        select(AdapterCredential.adapter_id).where(AdapterCredential.user_id == user_id)
    )
    expanded: set[str] = set()
    for key in result.scalars().all():
        if not key:
            continue
        expanded.update(adapter_ids_for_credential_key(key))
    return expanded


async def get_user_failed_adapter_ids(
    session: AsyncSession,
    user_id: str,
) -> set[str]:
    """Adapter IDs whose stored credential failed verification (THR-123).

    A failed credential is treated as unusable everywhere
    ``credentials_configured`` is consumed — same UX as no credentials at
    all — so this is meant to be subtracted from
    ``get_user_configured_adapter_ids``'s result, not used standalone.

    THR-126: keys off ``verification_status`` (the persisted source of
    truth) rather than the legacy ``is_verified`` boolean, and expands
    shared-realm rows the same way ``get_user_configured_adapter_ids`` does.
    """
    result = await session.execute(
        select(AdapterCredential.adapter_id).where(
            AdapterCredential.user_id == user_id,
            AdapterCredential.verification_status == CredentialVerificationState.FAILED.value,
        )
    )
    expanded: set[str] = set()
    for key in result.scalars().all():
        if not key:
            continue
        expanded.update(adapter_ids_for_credential_key(key))
    return expanded


async def mark_credential_pending(
    session: AsyncSession,
    user_id: str,
    adapter_id: str,
) -> None:
    """Flip a credential to PENDING right before enqueuing a verification
    check (THR-126) — so the UI badge is driven by the server's own state
    from the moment the check is queued, not a client-side timer guessing
    when the worker will get to it.

    No-op if the credential doesn't exist (a delete raced the enqueue).
    """
    record = await get_adapter_credential_record(session, user_id, adapter_id)
    if record is None:
        return
    record.verification_status = CredentialVerificationState.PENDING.value
    record.verification_message = None
    session.add(record)
    await session.commit()


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
            # THR-126: store under the realm key (defaults to adapter_id for
            # adapters with no realm) so a shared-realm save always lands on
            # the one row every member adapter resolves to.
            adapter_id=credential_key_for_adapter(adapter_id),
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
        record.verification_status = CredentialVerificationState.UNVERIFIED.value
        record.verification_message = None
        record.verified_at = None

    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record
