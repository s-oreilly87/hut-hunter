"""THR-124: /jobs and /jobs/window-check API behavior around the
booking-window (AWAITING_WINDOW) state.

Monkeypatches ``app.api._route_jobs._check_booking_window`` — the single
seam every route calls through — so these tests exercise the route branching
logic (create/update/window-check) independent of any adapter's own
window-computation correctness, which is covered separately in
test_base_camis.py.
"""

import pytest

import app.api._route_jobs as route_jobs
from app.adapters.base import BookingWindowInfo, StayPatternInfo
from app.models.job import JobStatus, utcnow

pytestmark = pytest.mark.asyncio


def _fake_check(window: BookingWindowInfo):
    async def _check(adapter_id, params):
        return window
    return _check


def _fake_stay_pattern_check(stay: StayPatternInfo):
    async def _check(adapter_id, params):
        return stay
    return _check


async def test_create_job_open_window_is_unaffected(
    monkeypatch, client, fake_redis, make_job_payload,
):
    monkeypatch.setattr(route_jobs, "_check_booking_window", _fake_check(BookingWindowInfo(is_open=True)))

    response = await client.post(
        "/api/v1/jobs",
        json=make_job_payload(enable_monitoring=True),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == JobStatus.CHECKING.value
    assert payload["window_opens_at"] is None
    assert len(fake_redis.calls) == 1


async def test_create_job_not_yet_released_parks_awaiting_window(
    monkeypatch, client, fake_redis, make_job_payload,
):
    opens_at = utcnow()
    monkeypatch.setattr(
        route_jobs, "_check_booking_window",
        _fake_check(BookingWindowInfo(is_open=False, opens_at=opens_at, opens_at_precise=False)),
    )

    response = await client.post(
        "/api/v1/jobs",
        # Even with enable_monitoring=False in the request, arming requires
        # monitoring — the route forces it on.
        json=make_job_payload(enable_monitoring=False),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == JobStatus.AWAITING_WINDOW.value
    assert payload["enable_monitoring"] is True
    assert payload["next_check_at"] is None
    assert payload["window_opens_at"] is not None
    assert payload["window_opens_precise"] is False
    # No check enqueued — there's nothing to check yet.
    assert fake_redis.calls == []


async def test_window_check_endpoint_fails_open_for_non_windowed_adapter(client):
    response = await client.post(
        "/api/v1/jobs/window-check",
        json={"adapter_id": "doc_great_walk", "params": {"date": "01/01/2099"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_open"] is True
    assert body["opens_at"] is None


async def test_window_check_endpoint_surfaces_not_open(monkeypatch, client):
    opens_at = utcnow()
    monkeypatch.setattr(
        route_jobs, "_check_booking_window",
        _fake_check(BookingWindowInfo(is_open=False, opens_at=opens_at, opens_at_precise=True)),
    )

    response = await client.post(
        "/api/v1/jobs/window-check",
        json={"adapter_id": "camis_bc_parks", "params": {"date": "01/01/2099"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_open"] is False
    assert body["opens_at_precise"] is True


async def test_window_check_endpoint_surfaces_stay_pattern_violation(monkeypatch, client):
    # THR-133: an open window doesn't mean the requested stay pattern is
    # bookable — the endpoint surfaces both independently.
    monkeypatch.setattr(
        route_jobs, "_check_booking_window", _fake_check(BookingWindowInfo(is_open=True)),
    )
    monkeypatch.setattr(
        route_jobs, "_check_stay_pattern",
        _fake_stay_pattern_check(StayPatternInfo(
            is_compliant=False,
            evidence="departure 2026-10-10 is a Saturday — this period only "
                     "allows arrival or departure on Monday, Friday",
        )),
    )

    response = await client.post(
        "/api/v1/jobs/window-check",
        json={"adapter_id": "camis_bc_parks", "params": {"date": "08/10/2026"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_open"] is True
    assert body["stay_pattern_compliant"] is False
    assert "Monday, Friday" in body["stay_pattern_evidence"]


async def test_window_check_endpoint_defaults_stay_pattern_compliant(client):
    # doc_great_walk has no rolling window (or stay-pattern concept) — both
    # checks fail open with no monkeypatching needed.
    response = await client.post(
        "/api/v1/jobs/window-check",
        json={"adapter_id": "doc_great_walk", "params": {"date": "01/01/2099"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["stay_pattern_compliant"] is True
    assert body["stay_pattern_evidence"] == ""


async def test_update_job_params_edit_moves_into_awaiting_window(
    monkeypatch, client, fake_redis, seed_job, fetch_job, make_job_params,
):
    # THR-129 item 4: seeded with a DIFFERENT date than the patch sends, so
    # this is a genuine params edit (params_actually_changed=True) rather
    # than a no-op resubmission of identical params, which no longer
    # triggers the window recheck at all — see
    # test_update_job_no_op_save_does_not_dispatch_or_clear_results.
    job = await seed_job(
        status=JobStatus.PAUSED.value,
        enable_monitoring=False,
        params=make_job_params(date="01/06/2026"),
    )
    opens_at = utcnow()
    monkeypatch.setattr(
        route_jobs, "_check_booking_window",
        _fake_check(BookingWindowInfo(is_open=False, opens_at=opens_at, opens_at_precise=True)),
    )

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"params": make_job_params(date="01/01/2099")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == JobStatus.AWAITING_WINDOW.value
    assert payload["enable_monitoring"] is True
    assert payload["next_check_at"] is None
    assert payload["window_opens_at"] is not None
    assert fake_redis.calls == []

    updated = await fetch_job(job.id)
    assert updated.window_burst_until is None


async def test_update_job_resumes_when_window_reopens(
    monkeypatch, client, fake_redis, seed_job, make_job_params,
):
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        window_opens_at=utcnow(),
    )
    monkeypatch.setattr(route_jobs, "_check_booking_window", _fake_check(BookingWindowInfo(is_open=True)))

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"params": make_job_params(date="02/01/2099")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == JobStatus.CHECKING.value
    assert payload["window_opens_at"] is None
    assert payload["next_check_at"] is not None
    assert len(fake_redis.calls) == 1


async def test_update_job_disabling_monitoring_cancels_pending_arm(
    client, fake_redis, seed_job,
):
    job = await seed_job(
        status=JobStatus.AWAITING_WINDOW.value,
        enable_monitoring=True,
        window_opens_at=utcnow(),
    )

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"enable_monitoring": False},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == JobStatus.PAUSED.value
    assert payload["window_opens_at"] is None
    assert payload["enable_monitoring"] is False
