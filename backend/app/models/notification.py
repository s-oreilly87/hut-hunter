from dataclasses import dataclass
from datetime import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, String
from sqlmodel import Field, SQLModel

from app.models.job import utcnow


class UserNotificationSettings(SQLModel, table=True):
    __tablename__ = "usernotificationsettings"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str = Field(
        foreign_key="appuser.id",
        index=True,
        unique=True,
    )
    email_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    encrypted_email_address: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    gotify_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    encrypted_gotify_url: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    encrypted_gotify_token: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


@dataclass(frozen=True)
class UserNotificationSettingsSecret:
    email_enabled: bool = False
    email_address: str | None = None
    gotify_enabled: bool = False
    gotify_url: str | None = None
    gotify_token: str | None = None

    @property
    def email_configured(self) -> bool:
        return bool(self.email_address)

    @property
    def gotify_configured(self) -> bool:
        return bool(self.gotify_url and self.gotify_token)


class UserNotificationSettingsRead(SQLModel):
    email_enabled: bool = False
    email_configured: bool = False
    email_address: str | None = None
    gotify_enabled: bool = False
    gotify_configured: bool = False
    gotify_url: str | None = None
    gotify_has_token: bool = False

    @classmethod
    def from_secret(
        cls,
        secret: UserNotificationSettingsSecret,
    ) -> "UserNotificationSettingsRead":
        return cls(
            email_enabled=secret.email_enabled,
            email_configured=secret.email_configured,
            email_address=secret.email_address,
            gotify_enabled=secret.gotify_enabled,
            gotify_configured=secret.gotify_configured,
            gotify_url=secret.gotify_url,
            gotify_has_token=bool(secret.gotify_token),
        )


class UserNotificationSettingsUpdate(SQLModel):
    email_enabled: bool | None = None
    email_address: str | None = None
    gotify_enabled: bool | None = None
    gotify_url: str | None = None
    gotify_token: str | None = None
