import json
import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel
from app.core.artifacts import DEBUG_SNAPSHOT_TERMS
from app.core.config import settings

def utcnow() -> datetime:
    """Timezone-aware UTC now — use this everywhere instead of datetime.utcnow()."""
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """Normalize DB-loaded datetimes to timezone-aware UTC.

    Some backends used in tests, especially SQLite, round-trip timezone-aware
    columns as naive datetimes. Normalize them before any Python-side
    comparisons or API serialization so behavior stays consistent across
    environments.
    """
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def as_optional_utc(value: datetime | None) -> datetime | None:
    return as_utc(value) if value is not None else None


def _artifact_should_include_html(value: str) -> bool:
    return any(term in value.lower() for term in DEBUG_SNAPSHOT_TERMS)


def artifact_urls(base: str, *, label: str | None = None) -> tuple[str, str | None]:
    html_source = label or base
    if base.startswith("artifacts/"):
        base = base[len("artifacts/"):]

    artifact_base = settings.artifacts_dir / base
    image_ext = ".png" if artifact_base.with_suffix(".png").exists() else ".jpg"
    html_url = (
        f"/artifacts/{base}.html"
        if (
            _artifact_should_include_html(html_source)
            and artifact_base.with_suffix(".html").exists()
        )
        else None
    )
    return f"/artifacts/{base}{image_ext}", html_url


class JobStatus(str, Enum):
    """Lifecycle states for a WatchJob.

    Transitions:
        (create)                 -> PAUSED (or WAITING if monitoring enabled)
        manual trigger           -> PAUSED/CANCELLED -> CHECKING
        scheduler dispatch       -> WAITING -> CHECKING
        check no-avail +
         monitoring on           -> CHECKING -> WAITING
        check no-avail +
         monitoring off          -> CHECKING -> PAUSED
        check found +
         hold in flight          -> CHECKING (unchanged; flips on hold result)
        hold secured             -> CHECKING -> HOLD_PLACED
        hold failed              -> CHECKING -> PAUSED/WAITING
        hold hit unexpected
         condition mid-funnel    -> CHECKING -> NEEDS_ATTENTION (browser parked,
                                    same as a successful hold — see THR-122)
        user Complete            -> HOLD_PLACED -> BOOKING_COMPLETE (terminal)
        user Cancel              -> HOLD_PLACED -> CANCELLED (terminal-ish; trigger resumes)
        user Cancel              -> NEEDS_ATTENTION -> CANCELLED (same as HOLD_PLACED)
        hold expired             -> HOLD_PLACED -> WAITING/CHECKING (lazy; checked by
                                    /trigger, check_availability, scheduler_tick)
        takeover expired         -> NEEDS_ATTENTION -> WAITING/CHECKING (same lazy
                                    expiry path as HOLD_PLACED)
        (create) on a
         not-yet-released date   -> AWAITING_WINDOW (THR-124; instead of
                                    PAUSED/WAITING — monitoring stays off until
                                    the computed window_opens_at)
        window opens             -> AWAITING_WINDOW -> WAITING (scheduler_tick
                                    arms it with next_check_at=now and a tight
                                    poll-burst cadence — see poll_worker.py)
        edit lands on a still-
         not-yet-released date   -> AWAITING_WINDOW -> AWAITING_WINDOW (params
                                    edit recomputes window_opens_at)

    EXPIRED is a virtual/computed status returned by the API when a DOC-adapter
    job's start date has passed 8pm New Zealand time. It is never written to the
    DB — from_db() injects it on the fly. Expired jobs cannot be triggered.

    WAITING means "monitoring on, between scheduled runs" — the scheduler will
    pick this job up on its next tick once next_check_at is due.

    AWAITING_WINDOW (THR-124): the job's requested date isn't inside the
    adapter's booking window yet (Camis' rolling per-park/per-province
    release schedule — see BaseAdapter.check_booking_window). Monitoring is
    off (next_check_at is null) so no polls are wasted; window_opens_at holds
    the computed go-live time and scheduler_tick's arm pass flips the job to
    WAITING with next_check_at=now the moment that time passes, so the first
    check happens as close to window-open as the 30s scheduler tick allows.

    NEEDS_ATTENTION (THR-122): the hold worker hit an unexpected condition mid-
    funnel (an unrecognized blocking dialog, a locator timeout — anything the
    adapter doesn't have specific handling for) rather than a known clean
    negative outcome. The session is parked exactly like a successful hold
    (same CartSession row, same noVNC browser kept alive) so the user can open
    /pay/{job_id} and drive the browser themselves to finish or cancel. Treated
    identically to HOLD_PLACED everywhere cart expiry/cleanup is checked.
    """
    PAUSED = "paused"
    CHECKING = "checking"
    WAITING = "waiting"
    HOLD_PLACED = "hold_placed"
    NEEDS_ATTENTION = "needs_attention"
    AWAITING_WINDOW = "awaiting_window"
    BOOKING_COMPLETE = "booking_complete"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


# Terminal states where a new check cannot be triggered until the user
# explicitly reactivates (e.g. re-trigger after cancellation).
TERMINAL_STATUSES = {JobStatus.BOOKING_COMPLETE}


def is_job_expired(adapter_id: str, params: dict) -> bool:
    """Delegate expiry check to the adapter. Each adapter defines its own
    booking timezone and cutoff hour. Lazy import avoids a circular dependency
    (doc_great_walk.py imports utcnow from this module)."""
    from app.adapters import is_job_expired as _adapter_is_expired  # noqa: PLC0415
    return _adapter_is_expired(adapter_id, params)


def _adapter_supports_automated_booking(adapter_id: str) -> bool:
    """Lazy-import wrapper (same circular-dependency reason as above)."""
    from app.adapters import adapter_supports_automated_booking  # noqa: PLC0415
    return adapter_supports_automated_booking(adapter_id)


def _adapter_park_url(adapter_id: str, params: dict) -> str | None:
    """Lazy-import wrapper (same circular-dependency reason as above).

    THR-129 item 2: surfaces a deep-link to the adapter's results page for
    the job's current params (Camis only, today) so the ShowJob info bar can
    hyperlink the selected park. None for adapters that don't support one.
    """
    from app.adapters import adapter_park_url  # noqa: PLC0415
    return adapter_park_url(adapter_id, params)


class WatchJob(SQLModel, table=True):
    """A configured availability watch job."""
    __tablename__ = "watch_job"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )
    user_id: str | None = Field(default=None, foreign_key="app_user.id", index=True)
    name: str                          # e.g. "Tongariro Alpine Crossing"
    adapter_id: str                    # which site adapter to use e.g. "doc_nz"
    params: str                        # JSON blob of search params
    status: str = Field(default=JobStatus.PAUSED.value, index=True)
    auto_book: bool = Field(default=False)
    # When true, the scheduler periodically enqueues check_availability on
    # interval_minutes cadence. When false, the job only runs on manual Force
    # Check. See scheduler_tick in app/workers/poll_worker.py.
    enable_monitoring: bool = Field(default=False)
    # Minutes between scheduled checks. UI clamps to 1..120; the DB column is
    # unbounded but sane values only come through the API.
    interval_minutes: int = Field(default=15)
    # Wall-clock timestamp of the next scheduled check. Null when monitoring
    # is off or a check is currently in flight that we haven't rescheduled yet.
    # Scheduler enqueues when next_check_at <= utcnow().
    next_check_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True, index=True),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_checked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    last_result: str | None = None  # JSON blob of last check result
    # Relative base path of the most recent debug/success snapshot (no
    # extension). The snapshot adapter saves {base}.png + {base}.html; the API
    # serves them via the StaticFiles mount at /artifacts/. Set on any failure
    # during check/hold and on booking-complete.
    last_artifact: str | None = None
    # JSON list of snapshot bases/labels captured across the current booking
    # flow. Used by the frontend to render a lightweight artifact gallery for
    # holds and receipts.
    artifact_history: str | None = None
    # THR-124: computed booking-window-open time (UTC) for a job parked in
    # AWAITING_WINDOW. Null once the job has ever left that state. See
    # BaseAdapter.check_booking_window / BaseCamisAdapter for how this is
    # computed, and poll_worker.scheduler_tick for the arm pass that reads it.
    window_opens_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # False when window_opens_at is a best-effort fallback (e.g. local
    # midnight on the first day the season calendar considers reservable)
    # rather than a confirmed go-live timestamp. Purely informational —
    # surfaced so the UI can hedge ("opens {date}" vs "opens sometime on
    # {date}").
    window_opens_precise: bool = Field(default=True)
    # THR-124: while set and in the future, the poll worker/scheduler use a
    # tight poll-burst cadence instead of interval_minutes — set when a job
    # arms at its computed window_opens_at, since the first few minutes after
    # a Camis launch are the actual competitive window.
    window_burst_until: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class WatchJobCreate(SQLModel):
    """Request body for creating a job."""
    name: str
    adapter_id: str
    params: dict                       # accepts a dict, we serialize to JSON
    auto_book: bool = False
    enable_monitoring: bool = True
    interval_minutes: int = 15


class WatchJobUpdate(SQLModel):
    """Request body for PATCHing a job. All fields optional — only the ones
    supplied by the client get written. `adapter_id` is intentionally omitted:
    params are adapter-specific, so changing adapters should be done by
    deleting + recreating the job rather than mutating in place."""
    name: str | None = None
    params: dict | None = None
    auto_book: bool | None = None
    enable_monitoring: bool | None = None
    interval_minutes: int | None = None


class WindowCheckRequest(SQLModel):
    """Request body for POST /jobs/window-check (THR-124) — lets the wizard
    ask "is this date released yet?" before the user saves the hunt."""
    adapter_id: str
    params: dict


class WindowCheckResponse(SQLModel):
    """Response body for POST /jobs/window-check — mirrors
    ``BookingWindowInfo`` (see app/adapters/base.py)."""
    is_open: bool
    opens_at: datetime | None = None
    opens_at_precise: bool = True
    evidence: str = ""


class WatchJobRead(SQLModel):
    """Response schema — what we return to the client."""
    id: str
    name: str
    adapter_id: str
    params: dict                       # deserialize back to dict for response
    status: str                        # JobStatus enum value (see above)
    auto_book: bool
    # THR-123: "usable" — a credential row exists AND it hasn't failed
    # verification. True when the adapter doesn't require credentials at all.
    credentials_configured: bool
    # THR-123: True when a stored credential exists but failed its login
    # check — distinct from "no credential at all" so the UI can show the
    # right notice (see JobBlockingNotices.FailedCredentialsNotice).
    credentials_failed: bool = False
    # False for watch/notify-only adapters (IdP-only sign-in, e.g. Parks
    # Canada). The UI hides auto-book and manual-booking affordances on it.
    supports_automated_booking: bool = True
    enable_monitoring: bool
    interval_minutes: int
    next_check_at: datetime | None
    cart_expires_at: datetime | None
    created_at: datetime
    last_checked_at: datetime | None
    last_result: list[dict] | None = None
    # URLs (relative to the API host) for the most recent snapshot. Null when
    # no artifact has been captured. See WatchJob.last_artifact for where this
    # comes from.
    last_artifact_png: str | None = None
    last_artifact_html: str | None = None
    artifact_history: list[dict] | None = None
    # THR-124: set while status == "awaiting_window" — the computed UTC
    # go-live time and whether it's a confirmed timestamp or a best-effort
    # fallback (see WatchJob.window_opens_precise). Null otherwise.
    window_opens_at: datetime | None = None
    window_opens_precise: bool = True
    # THR-129 item 2: deep-link to the booking site's results page for this
    # job's current params (Camis only, today — see BaseAdapter.results_url).
    # Null when the adapter has no such link or the params aren't resolvable
    # yet (e.g. no park selected).
    park_url: str | None = None

    @classmethod
    def from_db(
        cls,
        job: WatchJob,
        *,
        cart_expires_at: datetime | None = None,
        credentials_configured: bool = True,
        credentials_failed: bool = False,
    ) -> "WatchJobRead":
        raw = json.loads(job.last_result) if job.last_result else None
        if isinstance(raw, list):
            last_result = raw
        elif isinstance(raw, dict):
            last_result = [raw]  # wrap error dicts in a list
        else:
            last_result = None

        # Build the image/HTML URLs from the stored base path. The base is e.g.
        # "artifacts/20260418_123045_doc_great_walk_hold_error". StaticFiles is
        # mounted at /artifacts/<filename>, so strip the "artifacts/" prefix
        # and prepend the URL root. HTML is only returned for debug/error
        # snapshots, where the file exists.
        png_url: str | None = None
        html_url: str | None = None
        if job.last_artifact:
            png_url, html_url = artifact_urls(job.last_artifact)

        artifact_history = None
        if job.artifact_history:
            try:
                parsed_history = json.loads(job.artifact_history)
            except Exception:
                parsed_history = []

            if isinstance(parsed_history, list):
                artifact_history = []
                for entry in parsed_history:
                    if not isinstance(entry, dict):
                        continue
                    base = entry.get("base")
                    label = entry.get("label")
                    if not isinstance(base, str) or not base:
                        continue
                    artifact_png_url, artifact_html_url = artifact_urls(
                        base,
                        label=label if isinstance(label, str) else None,
                    )
                    artifact_history.append({
                        "label": label if isinstance(label, str) else "artifact",
                        "png_url": artifact_png_url,
                        "html_url": artifact_html_url,
                    })

                if not artifact_history:
                    artifact_history = None

        parsed_params = json.loads(job.params)

        # Compute expiry on the fly — EXPIRED is never stored, just surfaced
        # when the adapter says the start date has passed its booking cutoff,
        # unless the job is already in a terminal state (like BOOKING_COMPLETE).
        is_terminal = job.status in {s.value for s in TERMINAL_STATUSES}
        effective_status = (
            JobStatus.EXPIRED.value
            if not is_terminal and is_job_expired(job.adapter_id, parsed_params)
            else job.status
        )

        return cls(
            id=job.id,
            name=job.name,
            adapter_id=job.adapter_id,
            params=parsed_params,
            status=effective_status,
            auto_book=job.auto_book,
            credentials_configured=credentials_configured,
            credentials_failed=credentials_failed,
            supports_automated_booking=_adapter_supports_automated_booking(job.adapter_id),
            enable_monitoring=job.enable_monitoring,
            interval_minutes=job.interval_minutes,
            next_check_at=as_optional_utc(job.next_check_at),
            cart_expires_at=as_optional_utc(cart_expires_at),
            created_at=as_utc(job.created_at),
            last_checked_at=as_optional_utc(job.last_checked_at),
            last_result=last_result,
            last_artifact_png=png_url,
            last_artifact_html=html_url,
            artifact_history=artifact_history,
            window_opens_at=as_optional_utc(job.window_opens_at),
            window_opens_precise=job.window_opens_precise,
            park_url=_adapter_park_url(job.adapter_id, parsed_params),
        )
