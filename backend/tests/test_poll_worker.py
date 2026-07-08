"""Tests for THR-124's booking-window arming logic in the poll worker:

- ``_effective_interval_minutes`` (app/workers/_shared.py) — the tight
  poll-burst cadence right after a window arms, falling back to the job's
  configured interval.
- ``scheduler_tick``'s Pass 0 — flips AWAITING_WINDOW jobs whose computed
  window_opens_at has passed to WAITING with next_check_at=now and a fresh
  burst window, skipping jobs whose start date has already expired.

THR-127 adds ``check_availability``'s own defense-in-depth re-gate: before
ever trusting an adapter's availability codes, re-check the booking window
and self-heal an existing CHECKING/WAITING job back to AWAITING_WINDOW if
it's still closed — this is what heals a job that was created active while
the THR-124/126 gate was broken (or simply never got the memo).
"""

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta

import pytest

import app.workers.poll_worker as poll_worker
from app.adapters.base import AvailabilityResult, AvailabilityStatus, BookingWindowInfo
from app.models.job import JobStatus, WatchJob, as_utc, utcnow
from app.workers._shared import (
    WINDOW_BURST_MINUTES,
    WINDOW_BURST_INTERVAL_MINUTES,
    _effective_interval_minutes,
)


@pytest.fixture(autouse=True)
def _patch_poll_worker_session(session_factory, monkeypatch):
    monkeypatch.setattr(poll_worker, "AsyncSessionLocal", session_factory)
    # THR-127: check_availability (unlike scheduler_tick) also calls into
    # app.workers._shared helpers (_clear_unavailable_snapshot, _save_artifacts,
    # etc.) that hold their own imported AsyncSessionLocal reference — mirrors
    # test_hold_worker.py's equivalent fixture.
    import app.workers._shared as worker_shared
    monkeypatch.setattr(worker_shared, "AsyncSessionLocal", session_factory)


# ---------------------------------------------------------------------------
# _effective_interval_minutes — pure function, no DB needed
# ---------------------------------------------------------------------------

def test_effective_interval_uses_burst_cadence_while_active():
    job = WatchJob(
        name="x", adapter_id="doc_great_walk", params="{}",
        interval_minutes=15, window_burst_until=utcnow() + timedelta(minutes=5),
    )
    assert _effective_interval_minutes(job) == WINDOW_BURST_INTERVAL_MINUTES


def test_effective_interval_falls_back_once_burst_expires():
    job = WatchJob(
        name="x", adapter_id="doc_great_walk", params="{}",
        interval_minutes=15, window_burst_until=utcnow() - timedelta(minutes=1),
    )
    assert _effective_interval_minutes(job) == 15


def test_effective_interval_falls_back_with_no_burst_set():
    job = WatchJob(name="x", adapter_id="doc_great_walk", params="{}", interval_minutes=20)
    assert _effective_interval_minutes(job) == 20


# ---------------------------------------------------------------------------
# scheduler_tick Pass 0 — arming AWAITING_WINDOW jobs
# ---------------------------------------------------------------------------

async def test_scheduler_arms_job_whose_window_has_opened(seed_job, fetch_job, fake_redis):
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        interval_minutes=10,
        window_opens_at=utcnow() - timedelta(minutes=1),
        window_opens_precise=True,
    )

    result = await poll_worker.scheduler_tick({"redis": fake_redis})

    updated = await fetch_job(job.id)
    assert result["armed"] == 1
    # Pass 0 flips AWAITING_WINDOW -> WAITING with next_check_at=now; Pass 2
    # runs in the same tick and immediately picks that up, flipping it on to
    # CHECKING and enqueuing check_availability — exactly the "begins search
    # the moment it opens" behavior this feature is for.
    assert updated.status == JobStatus.CHECKING.value
    assert result["dispatched"] == 1
    assert any(c["job_name"] == "check_availability" for c in fake_redis.calls)
    assert updated.window_burst_until is not None
    assert as_utc(updated.window_burst_until) > utcnow()
    assert as_utc(updated.window_burst_until) <= utcnow() + timedelta(minutes=WINDOW_BURST_MINUTES + 1)


async def test_scheduler_leaves_job_parked_before_window_opens(seed_job, fetch_job, fake_redis):
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        window_opens_at=utcnow() + timedelta(hours=1),
    )

    result = await poll_worker.scheduler_tick({"redis": fake_redis})

    updated = await fetch_job(job.id)
    assert result["armed"] == 0
    assert updated.status == JobStatus.AWAITING_WINDOW.value
    assert updated.next_check_at is None


async def test_scheduler_does_not_arm_a_job_with_no_computed_open_time(seed_job, fetch_job, fake_redis):
    # window_opens_at is null — the invariant is that AWAITING_WINDOW jobs
    # only exist with a computed open time, but the query still shouldn't
    # crash or arm one that somehow lacks it.
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        window_opens_at=None,
    )

    result = await poll_worker.scheduler_tick({"redis": fake_redis})

    updated = await fetch_job(job.id)
    assert result["armed"] == 0
    assert updated.status == JobStatus.AWAITING_WINDOW.value


async def test_scheduler_skips_arming_an_already_expired_job(
    monkeypatch, seed_job, fetch_job, fake_redis,
):
    monkeypatch.setattr(poll_worker, "is_job_expired", lambda adapter_id, params: True)
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        window_opens_at=utcnow() - timedelta(minutes=1),
    )

    result = await poll_worker.scheduler_tick({"redis": fake_redis})

    updated = await fetch_job(job.id)
    assert result["armed"] == 0
    # Left parked — the API's EXPIRED overlay (WatchJobRead.from_db) already
    # surfaces this to the user regardless of the stored status.
    assert updated.status == JobStatus.AWAITING_WINDOW.value


# ---------------------------------------------------------------------------
# THR-127 — check_availability's defense-in-depth booking-window re-gate
# ---------------------------------------------------------------------------

@dataclass
class _FakeWindowedAdapter:
    """Minimal BaseAdapter stand-in for exercising the poll worker's own
    re-gate, independent of any real Camis DOM/JSON plumbing."""
    adapter_id: str = "camis_bc_parks"
    has_booking_windows: bool = True
    window_result: object = None  # BookingWindowInfo, or an Exception to raise
    detect_result: object = None  # list[AvailabilityResult]

    async def fill_form(self, page, params):
        return None

    async def check_booking_window(self, params):
        if isinstance(self.window_result, Exception):
            raise self.window_result
        return self.window_result

    async def detect_availability(self, page, params):
        if self.detect_result is not None:
            return self.detect_result
        return []

    async def snapshot(self, page, label, *, include_html=None):
        return f"artifacts/fake_{label}"

    def consume_artifacts(self):
        return []


@asynccontextmanager
async def _fake_detect_browser_page(*, headless, display=None, registry=None):
    yield object(), (lambda job_id: None)


async def test_check_availability_regates_and_parks_awaiting_window(
    monkeypatch, seed_job, fetch_job,
):
    """THE key defense-in-depth case: a job sitting in CHECKING (created
    active while the THR-124/126 gate was broken, or simply an existing job
    that predates the fix) self-heals to AWAITING_WINDOW on its next poll —
    never proceeding to the detect phase / reporting availability at all."""
    opens_at = utcnow() + timedelta(days=30)
    adapter = _FakeWindowedAdapter(
        window_result=BookingWindowInfo(is_open=False, opens_at=opens_at, opens_at_precise=True),
    )
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    job = await seed_job(
        adapter_id="camis_bc_parks",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
    )

    result = await poll_worker.check_availability({}, job.id)

    assert result == {"job_id": job.id, "status": "awaiting_window"}

    updated = await fetch_job(job.id)
    assert updated.status == JobStatus.AWAITING_WINDOW.value
    assert updated.enable_monitoring is True
    assert updated.next_check_at is None
    assert as_utc(updated.window_opens_at) == opens_at
    assert updated.window_opens_precise is True


async def test_check_availability_proceeds_normally_when_window_open(
    monkeypatch, seed_job, fetch_job,
):
    """Within-window dates must poll exactly as before this fix — the
    re-gate must not block or alter a normal, already-open check."""
    detect_calls: list[dict] = []

    async def fake_detect(page, params):
        detect_calls.append(params)
        return [AvailabilityResult(site="Test Park", status=AvailabilityStatus.UNAVAILABLE, evidence="none")]

    adapter = _FakeWindowedAdapter(window_result=BookingWindowInfo(is_open=True))
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    job = await seed_job(
        adapter_id="camis_bc_parks",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
    )

    result = await poll_worker.check_availability({}, job.id)

    assert result["status"] == "checked"
    assert len(detect_calls) == 1
    updated = await fetch_job(job.id)
    assert updated.status == JobStatus.WAITING.value


async def test_check_availability_regate_fails_open_on_lookup_error(
    monkeypatch, seed_job, fetch_job,
):
    """check_booking_window's own fail-open contract still applies here — a
    lookup hiccup in the re-gate must never block a check that would
    otherwise have run exactly as before this feature."""
    async def fake_detect(page, params):
        return []

    adapter = _FakeWindowedAdapter(window_result=RuntimeError("dateschedule unreachable"))
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    job = await seed_job(
        adapter_id="camis_bc_parks",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
    )

    result = await poll_worker.check_availability({}, job.id)

    assert result["status"] == "checked"
    updated = await fetch_job(job.id)
    assert updated.status == JobStatus.WAITING.value


async def test_check_availability_skips_regate_for_non_windowed_adapter(
    monkeypatch, seed_job, fetch_job,
):
    """DOC (and any other has_booking_windows=False adapter) must be
    completely unaffected — check_booking_window is never even called."""
    called = {"checked": False}

    class _NonWindowedAdapter(_FakeWindowedAdapter):
        async def check_booking_window(self, params):
            called["checked"] = True
            raise AssertionError("must not be called for a non-windowed adapter")

    async def fake_detect(page, params):
        return []

    adapter = _NonWindowedAdapter(has_booking_windows=False)
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
    )

    result = await poll_worker.check_availability({}, job.id)

    assert called["checked"] is False
    assert result["status"] == "checked"
    updated = await fetch_job(job.id)
    assert updated.status == JobStatus.WAITING.value


# ---------------------------------------------------------------------------
# THR-129 item 4 — discard a stale in-flight result instead of persisting it
# over a concurrent edit, and reschedule immediately rather than waiting a
# full interval.
# ---------------------------------------------------------------------------

async def test_check_availability_discards_stale_result_when_edited_mid_flight(
    monkeypatch, seed_job, fetch_job, session_factory, make_job_params,
):
    """The exact race update_job's dropped ARQ enqueue can create: an edit
    commits new params to the DB while this run is already mid-flight
    (having already read the OLD params at the top of check_availability).
    This run's result — computed from those old params — must not be
    persisted as the job's last_result, and the job must be scheduled for
    an immediate recheck (not a full interval out) so the edit's new params
    actually get checked shortly after, matching update_job's own promise."""
    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
        interval_minutes=15,
    )

    async def fake_detect(page, params):
        # Simulate update_job committing an edit while this run is still
        # executing — it already captured the pre-edit params at dispatch
        # time (see check_availability's dispatched_params_json snapshot).
        async with session_factory() as session:
            db_job = await session.get(WatchJob, job.id)
            db_job.params = json.dumps(make_job_params(track="Milford Track"))
            session.add(db_job)
            await session.commit()
        return [AvailabilityResult(site="Test Park", status=AvailabilityStatus.UNAVAILABLE, evidence="none")]

    adapter = _FakeWindowedAdapter(has_booking_windows=False)
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    result = await poll_worker.check_availability({}, job.id)

    assert result["status"] == "checked"  # this run did complete its own detect

    updated = await fetch_job(job.id)
    assert updated is not None
    assert updated.status == JobStatus.WAITING.value
    # The stale result must NOT have been persisted.
    assert updated.last_result is None
    assert updated.last_checked_at is None
    # Scheduled for (near-)immediate recheck, not the full 15-minute interval
    # — so the mid-flight edit's new params get checked shortly after.
    next_at = as_utc(updated.next_check_at)
    assert next_at <= utcnow() + timedelta(seconds=5)
    # The edit's own params are what's actually on the job now.
    assert json.loads(updated.params)["track"] == "Milford Track"


async def test_check_availability_persists_normally_when_params_unchanged_mid_flight(
    monkeypatch, seed_job, fetch_job,
):
    """Sanity check / regression guard: the common case (no concurrent edit)
    must be completely unaffected by the staleness comparison — the result
    persists and next_check_at is the normal full-interval reschedule."""
    async def fake_detect(page, params):
        return [AvailabilityResult(site="Test Park", status=AvailabilityStatus.UNAVAILABLE, evidence="none")]

    adapter = _FakeWindowedAdapter(has_booking_windows=False)
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)

    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
        interval_minutes=15,
    )

    result = await poll_worker.check_availability({}, job.id)

    assert result["status"] == "checked"
    updated = await fetch_job(job.id)
    assert updated is not None
    assert updated.last_result is not None
    assert updated.last_checked_at is not None
    next_at = as_utc(updated.next_check_at)
    assert next_at > utcnow() + timedelta(minutes=14)


# ---------------------------------------------------------------------------
# THR-130 — availability notifications carry a booking-site link and a Hut
# Hunter show-hunt link.
# ---------------------------------------------------------------------------

async def test_check_availability_notification_includes_booking_and_hunt_links(
    monkeypatch, seed_job,
):
    """An availability notification must include both the booking-site link
    (here the DOC Great Walk landing page, via the adapter's results_url) and
    a link back to the hunt in Hut Hunter (settings.app_url + hash route)."""
    captured: list[dict] = []

    async def fake_dispatch(settings_secret, *, title, message, priority=5):
        captured.append({"title": title, "message": message})

    async def fake_detect(page, params):
        return [AvailabilityResult(
            site="Routeburn Track", status=AvailabilityStatus.AVAILABLE,
            evidence="2 free", total_available=2,
        )]

    adapter = _FakeWindowedAdapter(has_booking_windows=False, adapter_id="doc_great_walk")
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)
    monkeypatch.setattr(poll_worker, "dispatch_notification_targets", fake_dispatch)
    monkeypatch.setattr(poll_worker.settings, "app_url", "https://hunt.example.com")

    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
        auto_book=False,
    )

    await poll_worker.check_availability({}, job.id)

    assert len(captured) == 1
    message = captured[0]["message"]
    # Booking-site link — the Great Walk landing page from results_url.
    assert "Booking site: https://bookings.doc.govt.nz/Web/Default.aspx#!greatwalk-result" in message
    # Hut Hunter show-hunt link — app_url + the hash route for this job.
    assert f"Open in Hut Hunter: https://hunt.example.com/#/jobs/{job.id}" in message


# ---------------------------------------------------------------------------
# THR-133 — a restriction-only result (arrival/departure changeover, not
# sold out) gets its own distinct notification instead of silent UNAVAILABLE.
# ---------------------------------------------------------------------------

async def test_check_availability_notifies_on_restricted_only_result(
    monkeypatch, seed_job, fake_redis,
):
    captured: list[dict] = []

    async def fake_dispatch(settings_secret, *, title, message, priority=5):
        captured.append({"title": title, "message": message})

    async def fake_detect(page, params):
        return [AvailabilityResult(
            site="Golden Ears Provincial Park", status=AvailabilityStatus.RESTRICTED,
            evidence="2 sites restricted (0/2 sites free for the full 2-night stay, 0 with ≥1 free night)",
            total_available=0,
        )]

    adapter = _FakeWindowedAdapter(has_booking_windows=False, adapter_id="doc_great_walk")
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)
    monkeypatch.setattr(poll_worker, "dispatch_notification_targets", fake_dispatch)

    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
        auto_book=True,
    )

    await poll_worker.check_availability({"redis": fake_redis}, job.id)

    assert len(captured) == 1
    assert captured[0]["title"] == "🔶 Restricted Availability"
    assert "Golden Ears Provincial Park: 2 sites restricted" in captured[0]["message"]
    assert "adjusting the dates or number of nights" in captured[0]["message"]
    # A restricted-only result must never be treated as bookable, even with
    # auto_book on — no hold task should be queued.
    assert fake_redis.calls == []


async def test_check_availability_suppresses_repeat_restricted_notification(
    monkeypatch, seed_job,
):
    captured: list[dict] = []

    async def fake_dispatch(settings_secret, *, title, message, priority=5):
        captured.append({"title": title, "message": message})

    async def fake_detect(page, params):
        return [AvailabilityResult(
            site="Golden Ears Provincial Park", status=AvailabilityStatus.RESTRICTED,
            evidence="2 sites restricted", total_available=0,
        )]

    adapter = _FakeWindowedAdapter(has_booking_windows=False, adapter_id="doc_great_walk")
    adapter.detect_availability = fake_detect  # type: ignore[method-assign]
    monkeypatch.setattr(poll_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(poll_worker, "_browser_page", _fake_detect_browser_page)
    monkeypatch.setattr(poll_worker, "dispatch_notification_targets", fake_dispatch)

    job = await seed_job(
        adapter_id="doc_great_walk",
        status=JobStatus.CHECKING.value,
        enable_monitoring=True,
        auto_book=False,
        last_result=[{
            "site": "Golden Ears Provincial Park",
            "status": "restricted",
            "evidence": "2 sites restricted",
            "total_available": 0,
        }],
    )

    await poll_worker.check_availability({}, job.id)

    assert captured == []
