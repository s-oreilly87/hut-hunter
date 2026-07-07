from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import uuid

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.job import utcnow


class CredentialVerificationState(str, Enum):
    """Persisted verification outcome for a stored ``AdapterCredential``
    (THR-126).

    Distinct from ``app.adapters.base.VerificationStatus`` — that's the
    result an adapter's ``verify_credentials`` hands back for a single check;
    this is the durable, server-side state the API/UI read, which also needs
    ``PENDING`` (a check is queued/running) and ``UNVERIFIED`` (never
    checked) states that no single check result can represent on its own.

    THR-123 shipped only ``is_verified: bool | None`` and dropped INCONCLUSIVE
    results on the floor (logged, never persisted) — the frontend's "Verifying…"
    was a client-only timer that reverted to "Unverified" with no explanation.
    THR-126: every outcome is now persisted so the UI is always server-driven.
    """
    VERIFIED = "verified"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    PENDING = "pending"
    UNVERIFIED = "unverified"


class AdapterCredential(SQLModel, table=True):
    __tablename__ = "adapter_credential"
    __table_args__ = (
        UniqueConstraint("user_id", "adapter_id", name="uq_adapter_credential_user_adapter"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="app_user.id", index=True)
    # THR-126: for adapters sharing a credential_realm (e.g. the two DOC
    # adapters, both bookings.doc.govt.nz accounts), this is the REALM key,
    # not necessarily the concrete adapter_id the caller asked about — see
    # app.core.adapter_credentials for the resolution. Camis/other adapters
    # with no realm store their own adapter_id here unchanged.
    adapter_id: str = Field(
        sa_column=Column(String, nullable=False, index=True),
    )
    encrypted_username: str = Field(sa_column=Column(String, nullable=False))
    encrypted_password: str = Field(sa_column=Column(String, nullable=False))
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # THR-123: null = never checked (legacy rows, or a fresh save whose
    # verify_credentials_task hasn't landed yet). True/False are only ever
    # set by verify_credentials_task after an actual login attempt.
    #
    # THR-126: kept in sync with ``verification_status`` for any code that
    # still reads the boolean (gating logic keys off ``verification_status``
    # now), but is no longer the source of truth — it can't represent
    # PENDING or INCONCLUSIVE, which is exactly the bug this ticket fixes.
    is_verified: bool | None = Field(
        default=None,
        sa_column=Column(Boolean, nullable=True),
    )
    verification_status: str = Field(
        default=CredentialVerificationState.UNVERIFIED.value,
        sa_column=Column(String, nullable=False, server_default=CredentialVerificationState.UNVERIFIED.value),
    )
    # Human-readable detail for the current verification_status — e.g. the
    # rejection reason (FAILED) or the infra error (INCONCLUSIVE). Null for
    # UNVERIFIED/PENDING/a bare VERIFIED.
    verification_message: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    verified_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


@dataclass(frozen=True)
class AdapterCredentialSecret:
    username: str
    password: str


class AdapterCredentialUpsert(SQLModel):
    username: str
    password: str | None = None


class AdapterCredentialRead(SQLModel):
    id: str
    adapter_id: str
    username: str
    has_password: bool
    is_verified: bool | None
    verification_status: str
    verification_message: str | None = None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime

