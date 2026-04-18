from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from sqlmodel import Field, SQLModel
import uuid
import json
from sqlalchemy import Column
from sqlalchemy import DateTime

def utcnow() -> datetime:
    """Timezone-aware UTC now — use this everywhere instead of datetime.utcnow()."""
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    """Lifecycle states for a WatchJob.

    Transitions (current, without periodic scheduling):
        (create)         -> PAUSED
        trigger          -> PAUSED/CANCELLED/BOOKING_COMPLETE -> CHECKING
        check no-avail   -> CHECKING -> PAUSED
        check found +
         hold in flight  -> CHECKING (unchanged; flips on hold result)
        hold secured     -> CHECKING -> HOLD_PLACED
        hold failed      -> CHECKING -> PAUSED
        user Complete    -> HOLD_PLACED -> BOOKING_COMPLETE (terminal)
        user Cancel      -> HOLD_PLACED -> CANCELLED (terminal-ish; trigger resumes)
        hold expired     -> HOLD_PLACED -> CHECKING (lazy; checked by /trigger and
                            check_availability)

    WAITING is reserved for the future periodic-poll flow (between scheduled
    runs). For now jobs never enter WAITING automatically.
    """
    PAUSED = "paused"
    CHECKING = "checking"
    WAITING = "waiting"
    HOLD_PLACED = "hold_placed"
    BOOKING_COMPLETE = "booking_complete"
    CANCELLED = "cancelled"


# Terminal-ish states where triggering a check is blocked (user must reactivate
# via the front-end / an explicit API call — NOT in the current minimal flow,
# but the set is useful for the workers' guard logic).
TERMINAL_STATUSES = {JobStatus.BOOKING_COMPLETE}


class WatchJob(SQLModel, table=True):
    """A configured availability watch job."""
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )
    name: str                          # e.g. "Tongariro Alpine Crossing"
    adapter_id: str                    # which site adapter to use e.g. "doc_nz"
    params: str                        # JSON blob of search params
    status: str = Field(default=JobStatus.PAUSED.value, index=True)
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
    status: str                        # JobStatus enum value (see above)
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
            status=job.status,
            auto_book=job.auto_book,
            created_at=job.created_at,
            last_checked_at=job.last_checked_at,
            last_result=last_result,
        )