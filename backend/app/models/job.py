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

    EXPIRED is a virtual/computed status returned by the API when a DOC-adapter
    job's start date has passed 8pm New Zealand time. It is never written to the
    DB — from_db() injects it on the fly. Expired jobs cannot be triggered.

    WAITING is reserved for the future periodic-poll flow (between scheduled
    runs). For now jobs never enter WAITING automatically.
    """
    PAUSED = "paused"
    CHECKING = "checking"
    WAITING = "waiting"
    HOLD_PLACED = "hold_placed"
    BOOKING_COMPLETE = "booking_complete"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


# Terminal-ish states where triggering a check is blocked (user must reactivate
# via the front-end / an explicit API call — NOT in the current minimal flow,
# but the set is useful for the workers' guard logic).
TERMINAL_STATUSES = {JobStatus.BOOKING_COMPLETE}


def is_job_expired(adapter_id: str, params: dict) -> bool:
    """Delegate expiry check to the adapter. Each adapter defines its own
    booking timezone and cutoff hour. Lazy import avoids a circular dependency
    (doc_great_walk.py imports utcnow from this module)."""
    from app.adapters import is_job_expired as _adapter_is_expired  # noqa: PLC0415
    return _adapter_is_expired(adapter_id, params)


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
    # Relative base path of the most recent debug/success snapshot (no
    # extension). The snapshot adapter saves {base}.png + {base}.html; the API
    # serves them via the StaticFiles mount at /artifacts/. Set on any failure
    # during check/hold and on booking-complete.
    last_artifact: Optional[str] = None


class WatchJobCreate(SQLModel):
    """Request body for creating a job."""
    name: str
    adapter_id: str
    params: dict                       # accepts a dict, we serialize to JSON
    auto_book: bool = False


class WatchJobUpdate(SQLModel):
    """Request body for PATCHing a job. All fields optional — only the ones
    supplied by the client get written. `adapter_id` is intentionally omitted:
    params are adapter-specific, so changing adapters should be done by
    deleting + recreating the job rather than mutating in place."""
    name: Optional[str] = None
    params: Optional[dict] = None
    auto_book: Optional[bool] = None


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
    # URLs (relative to the API host) for the most recent snapshot. Null when
    # no artifact has been captured. See WatchJob.last_artifact for where this
    # comes from.
    last_artifact_png: Optional[str] = None
    last_artifact_html: Optional[str] = None

    @classmethod
    def from_db(cls, job: WatchJob) -> "WatchJobRead":
        raw = json.loads(job.last_result) if job.last_result else None
        if isinstance(raw, list):
            last_result = raw
        elif isinstance(raw, dict):
            last_result = [raw]  # wrap error dicts in a list
        else:
            last_result = None

        # Build the PNG/HTML URLs from the stored base path. The base is e.g.
        # "artifacts/20260418_123045_doc_great_walk_hold_error". StaticFiles is
        # mounted at /artifacts/<filename>, so strip the "artifacts/" prefix
        # and prepend the URL root.
        png_url: Optional[str] = None
        html_url: Optional[str] = None
        if job.last_artifact:
            base = job.last_artifact
            if base.startswith("artifacts/"):
                base = base[len("artifacts/"):]
            png_url = f"/artifacts/{base}.png"
            html_url = f"/artifacts/{base}.html"

        parsed_params = json.loads(job.params)

        # Compute expiry on the fly — EXPIRED is never stored, just surfaced
        # when the adapter says the start date has passed its booking cutoff.
        effective_status = (
            JobStatus.EXPIRED.value
            if is_job_expired(job.adapter_id, parsed_params)
            else job.status
        )

        return cls(
            id=job.id,
            name=job.name,
            adapter_id=job.adapter_id,
            params=parsed_params,
            status=effective_status,
            auto_book=job.auto_book,
            created_at=job.created_at,
            last_checked_at=job.last_checked_at,
            last_result=last_result,
            last_artifact_png=png_url,
            last_artifact_html=html_url,
        )