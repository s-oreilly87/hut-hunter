from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, Column
from sqlalchemy import DateTime
from app.models.job import utcnow
import uuid


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
    )  # Adapter-defined hold expiry from cart creation
    # Set when the app signals the booking was successfully completed by the user.
    # While this is NULL and expires_at is in the future, the job is considered
    # to have an active cart and check_availability will skip it.
    completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )
