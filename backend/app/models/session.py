from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, Column
from sqlalchemy import DateTime
from app.models.job import utcnow
import uuid


class AdapterSession(SQLModel, table=True):
    """Stores encrypted Playwright storageState per adapter."""
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )
    adapter_id: str = Field(index=True, unique=True)  # one session per adapter for now
    encrypted_state: str                               # encrypted storageState JSON
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class CartSession(SQLModel, table=True):
    """Stores encrypted cart cookies for resume flow."""
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )
    job_id: str = Field(index=True)
    encrypted_cookies: str                             # encrypted cookies JSON
    cart_url: str
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )  # 25 minutes from cart creation