from dataclasses import dataclass
from datetime import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.job import utcnow


class AdapterCredential(SQLModel, table=True):
    __tablename__ = "adapter_credential"
    __table_args__ = (
        UniqueConstraint("user_id", "adapter_id", name="uq_adapter_credential_user_adapter"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="app_user.id", index=True)
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
    is_verified: bool | None = Field(
        default=None,
        sa_column=Column(Boolean, nullable=True),
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
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime

