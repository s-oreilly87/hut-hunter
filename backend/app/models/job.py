from datetime import datetime, timezone
from typing import Optional
from sqlmodel import Field, SQLModel
import uuid
import json
from sqlalchemy import Column
from sqlalchemy import DateTime

def utcnow() -> datetime:
    """Timezone-aware UTC now — use this everywhere instead of datetime.utcnow()."""
    return datetime.now(timezone.utc)

class WatchJob(SQLModel, table=True):
    """A configured availability watch job."""
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )
    name: str                          # e.g. "Tongariro Alpine Crossing"
    adapter_id: str                    # which site adapter to use e.g. "doc_nz"
    params: str                        # JSON blob of search params
    is_active: bool = Field(default=True)
    auto_book: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_checked_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    last_result: Optional[str] = None  # JSON blob of last check result


class WatchJobCreate(SQLModel):
    """Request body for creating a job."""
    name: str
    adapter_id: str
    params: dict                       # accepts a dict, we serialize to JSON
    auto_book: bool = False


class WatchJobRead(SQLModel):
    """Response schema — what we return to the client."""
    id: str
    name: str
    adapter_id: str
    params: dict                       # deserialize back to dict for response
    is_active: bool
    auto_book: bool
    created_at: datetime
    last_checked_at: Optional[datetime]
    last_result: list[dict] | None = None

    @classmethod
    def from_db(cls, job: WatchJob) -> "WatchJobRead":
        raw = json.loads(job.last_result) if job.last_result else None
        if isinstance(raw, list):
            last_result = raw
        elif isinstance(raw, dict):
            last_result = [raw]  # wrap error dicts in a list
        else:
            last_result = None

        return cls(
            id=job.id,
            name=job.name,
            adapter_id=job.adapter_id,
            params=json.loads(job.params),
            is_active=job.is_active,
            auto_book=job.auto_book,
            created_at=job.created_at,
            last_checked_at=job.last_checked_at,
            last_result=last_result,
        )