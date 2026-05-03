from datetime import datetime
from typing import Any, Optional
from sqlmodel import Field, SQLModel
from sqlalchemy import JSON, Column, DateTime, UniqueConstraint
import uuid

from app.models.job import utcnow


class Occupant(SQLModel, table=True):
    """A saved occupant for use across booking jobs.

    Stored as a reusable roster entry. When a job is created the selected
    occupants are snapshotted into job.params["occupants"] so that edits to
    the roster don't silently change existing jobs."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str | None = Field(default=None, foreign_key="appuser.id", index=True)
    first_name: str
    last_name: str
    age: int
    gender: str      # "Male" | "Female" | "Non-binary" | "Prefer not to say"
    country: str     # e.g. "New Zealand"
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AdapterOccupant(SQLModel, table=True):
    """Adapter-specific occupant values stored separately from the global roster."""

    __tablename__ = "adapter_occupant"
    __table_args__ = (
        UniqueConstraint(
            "occupant_id",
            "adapter_id",
            name="uq_adapter_occupant_occupant_id_adapter_id",
        ),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    occupant_id: str = Field(foreign_key="occupant.id", index=True)
    adapter_id: str = Field(index=True)
    extra_fields: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OccupantCreate(SQLModel):
    first_name: str
    last_name: str
    age: int
    gender: str
    country: str
    adapter_values: dict[str, dict[str, Any]] = Field(default_factory=dict)


class OccupantUpdate(SQLModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    country: Optional[str] = None
    adapter_values: Optional[dict[str, dict[str, Any]]] = None


class OccupantAdapterValueRead(SQLModel):
    adapter_id: str
    extra_fields: dict[str, Any] = Field(default_factory=dict)


class OccupantRead(SQLModel):
    id: str
    first_name: str
    last_name: str
    age: int
    gender: str
    country: str
    adapter_values: dict[str, dict[str, Any]] = Field(default_factory=dict)
    created_at: datetime
