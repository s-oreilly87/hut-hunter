from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel
from sqlalchemy import Column, DateTime
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
    category: str    # Visitor type string — adapter-specific values,
                     # e.g. DOC: "NZ Adult (18+)", "International Child (5-17)"
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OccupantCreate(SQLModel):
    first_name: str
    last_name: str
    age: int
    gender: str
    country: str
    category: str


class OccupantUpdate(SQLModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    country: Optional[str] = None
    category: Optional[str] = None


class OccupantRead(SQLModel):
    id: str
    first_name: str
    last_name: str
    age: int
    gender: str
    country: str
    category: str
    created_at: datetime
