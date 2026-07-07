"""Tests for THR-124's booking-window arming logic in the poll worker:

- ``_effective_interval_minutes`` (app/workers/_shared.py) — the tight
  poll-burst cadence right after a window arms, falling back to the job's
  configured interval.
- ``scheduler_tick``'s Pass 0 — flips AWAITING_WINDOW jobs whose computed
  window_opens_at has passed to WAITING with next_check_at=now and a fresh
  burst window, skipping jobs whose start date has already expired.
"""

from datetime import timedelta

import pytest

import app.workers.poll_worker as poll_worker
from app.models.job import JobStatus, WatchJob, as_utc, utcnow
from app.workers._shared import (
    WINDOW_BURST_MINUTES,
    WINDOW_BURST_INTERVAL_MINUTES,
    _effective_interval_minutes,
)


@pytest.fixture(autouse=True)
def _patch_poll_worker_session(session_factory, monkeypatch):
    monkeypatch.setattr(poll_worker, "AsyncSessionLocal", session_factory)


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
