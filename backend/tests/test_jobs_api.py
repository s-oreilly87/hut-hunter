from datetime import timedelta, timezone

import pytest

from app.api.routes import MAX_INTERVAL_MINUTES
from app.models.job import JobStatus, utcnow

pytestmark = pytest.mark.asyncio


async def test_create_job_with_monitoring_enqueues_immediate_check(
    client,
    fake_redis,
    make_job_payload,
):
    response = await client.post(
        "/api/v1/jobs",
        json=make_job_payload(enable_monitoring=True, interval_minutes=30),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == JobStatus.CHECKING.value
    assert payload["interval_minutes"] == 30
    assert payload["next_check_at"] is not None
    assert fake_redis.calls == [
        {
            "job_name": "check_availability",
            "args": [payload["id"]],
            "kwargs": {"_job_id": f"check_availability:{payload['id']}"},
        }
    ]


async def test_create_job_without_monitoring_starts_paused(client, fake_redis, make_job_payload):
    response = await client.post(
        "/api/v1/jobs",
        json=make_job_payload(enable_monitoring=False),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == JobStatus.PAUSED.value
    assert payload["next_check_at"] is None
    assert fake_redis.calls == []


async def test_create_job_rejects_auto_book_without_occupants(
    client,
    fake_redis,
    make_job_params,
    make_job_payload,
):
    response = await client.post(
        "/api/v1/jobs",
        json=make_job_payload(
            auto_book=True,
            params=make_job_params(occupants=[]),
        ),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Occupants are required before auto-book can be enabled."
    )
    assert fake_redis.calls == []


async def test_get_job_surfaces_expiry_and_artifact_urls(client, seed_job, seed_cart, make_job_params):
    job = await seed_job(
        params=make_job_params(date="01/01/2000"),
        status=JobStatus.PAUSED.value,
        last_result=[{"site": "Lake Mackenzie Hut", "status": "unavailable", "evidence": "sold out"}],
        last_artifact="artifacts/latest-check",
        artifact_history=[
            {"label": "reservation", "base": "artifacts/reservation-step"},
            {"label": "cart", "base": "cart-step"},
        ],
    )
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=25))

    response = await client.get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == JobStatus.EXPIRED.value
    assert payload["cart_expires_at"] is not None
    assert payload["params"]["date"] == "01/01/2000"
    assert payload["last_result"] == [
        {"site": "Lake Mackenzie Hut", "status": "unavailable", "evidence": "sold out"}
    ]
    assert payload["last_artifact_png"] == "/artifacts/latest-check.png"
    assert payload["last_artifact_html"] == "/artifacts/latest-check.html"
    assert payload["artifact_history"] == [
        {
            "label": "reservation",
            "png_url": "/artifacts/reservation-step.png",
            "html_url": "/artifacts/reservation-step.html",
        },
        {
            "label": "cart",
            "png_url": "/artifacts/cart-step.png",
            "html_url": "/artifacts/cart-step.html",
        },
    ]


async def test_update_job_enabling_monitoring_clamps_interval_and_dispatches(
    client,
    fake_redis,
    seed_job,
    fetch_job,
):
    job = await seed_job(
        status=JobStatus.PAUSED.value,
        enable_monitoring=False,
        interval_minutes=15,
    )

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"enable_monitoring": True, "interval_minutes": 999},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == JobStatus.CHECKING.value
    assert payload["interval_minutes"] == MAX_INTERVAL_MINUTES
    assert payload["next_check_at"] is not None
    assert fake_redis.calls == [
        {
            "job_name": "check_availability",
            "args": [job.id],
            "kwargs": {"_job_id": f"check_availability:{job.id}"},
        }
    ]

    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.enable_monitoring is True
    assert refreshed.interval_minutes == MAX_INTERVAL_MINUTES


async def test_update_job_changing_params_clears_stale_results_and_artifacts(
    client,
    seed_job,
    fetch_job,
    make_job_params,
):
    job = await seed_job(
        last_checked_at=utcnow(),
        last_result=[{"site": "Lake Mackenzie Hut", "status": "available", "evidence": "4 bunks"}],
        last_artifact="artifacts/last-good-run",
        artifact_history=[{"label": "payment", "base": "artifacts/payment"}],
    )

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"params": make_job_params(track="Milford Track", sites="Mintaro Hut")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["params"]["track"] == "Milford Track"
    assert payload["last_checked_at"] is None
    assert payload["last_result"] is None
    assert payload["last_artifact_png"] is None
    assert payload["artifact_history"] is None

    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.last_checked_at is None
    assert refreshed.last_result is None
    assert refreshed.last_artifact is None
    assert refreshed.artifact_history is None


async def test_update_job_removing_occupants_disables_auto_book(
    client,
    seed_job,
    fetch_job,
    make_job_params,
):
    job = await seed_job(
        auto_book=True,
        params=make_job_params(
            occupants=[
                {
                    "first_name": "Alex",
                    "last_name": "Walker",
                    "category": "NZ Adult (18+)",
                    "country": "New Zealand",
                    "age": 32,
                    "gender": "Male",
                }
            ],
        ),
    )

    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"params": make_job_params(occupants=[])},
    )

    assert response.status_code == 200
    assert response.json()["auto_book"] is False

    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.auto_book is False


async def test_delete_job_removes_cart_sessions_and_enqueues_browser_close(
    client,
    fake_redis,
    seed_job,
    seed_cart,
    fetch_job,
    list_carts,
):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id)

    response = await client.delete(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 204
    assert await fetch_job(job.id) is None
    assert await list_carts(job.id) == []
    assert fake_redis.calls == [
        {
            "job_name": "close_browser_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_trigger_job_rejects_expired_jobs(client, seed_job, make_job_params):
    job = await seed_job(params=make_job_params(date="01/01/2000"))

    response = await client.post(f"/api/v1/jobs/{job.id}/trigger")

    assert response.status_code == 409
    assert response.json()["detail"] == "This job's start date has passed — it cannot be triggered."


async def test_trigger_job_handles_arq_dedup_and_reschedules_monitoring(
    client,
    fake_redis,
    seed_job,
    fetch_job,
):
    job = await seed_job(
        status=JobStatus.PAUSED.value,
        enable_monitoring=True,
        interval_minutes=45,
    )
    fake_redis.return_values.append(None)

    response = await client.post(f"/api/v1/jobs/{job.id}/trigger")

    assert response.status_code == 202
    assert response.json() == {"status": "already_queued", "job_id": job.id}
    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.CHECKING.value
    assert refreshed.next_check_at is not None
    scheduled_at = refreshed.next_check_at
    if scheduled_at.tzinfo is None or scheduled_at.utcoffset() is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    assert scheduled_at > utcnow() + timedelta(minutes=44)


async def test_trigger_job_allows_retry_after_hold_expired(
    client,
    fake_redis,
    seed_job,
    seed_cart,
    fetch_job,
):
    job = await seed_job(
        status=JobStatus.HOLD_PLACED.value,
        enable_monitoring=True,
        interval_minutes=30,
    )
    await seed_cart(job.id, expires_at=utcnow() - timedelta(minutes=1))

    response = await client.post(f"/api/v1/jobs/{job.id}/trigger")

    assert response.status_code == 202
    assert response.json() == {"status": "enqueued", "job_id": job.id}
    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.CHECKING.value
    assert fake_redis.calls == [
        {
            "job_name": "close_browser_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        },
        {
            "job_name": "check_availability",
            "args": [job.id],
            "kwargs": {"_job_id": f"check_availability:{job.id}"},
        }
    ]


async def test_book_job_requires_full_recent_availability(client, seed_job):
    job = await seed_job(
        last_result=[
            {
                "site": "Lake Mackenzie Hut",
                "status": "partially_available",
                "evidence": "Only 2 bunks left",
            }
        ]
    )

    response = await client.post(f"/api/v1/jobs/{job.id}/book")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Not every site is fully available. Create a new watch job scoped to the partial "
        "site(s) to book those separately."
    )


async def test_book_job_requires_occupants_on_job(client, seed_job, make_job_params):
    job = await seed_job(
        params=make_job_params(occupants=[]),
        last_result=[
            {"site": "Lake Mackenzie Hut", "status": "available", "evidence": "4 bunks"},
        ],
    )

    response = await client.post(f"/api/v1/jobs/{job.id}/book")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Occupants are required on this job before booking can start."
    )


async def test_book_job_enqueues_hold_worker_when_all_sites_available(
    client,
    fake_redis,
    seed_job,
    fetch_job,
):
    job = await seed_job(
        last_result=[
            {"site": "Lake Mackenzie Hut", "status": "available", "evidence": "4 bunks"},
            {"site": "Routeburn Falls Hut", "status": "available", "evidence": "6 bunks"},
        ]
    )

    response = await client.post(f"/api/v1/jobs/{job.id}/book")

    assert response.status_code == 202
    assert response.json() == {"status": "enqueued", "job_id": job.id}
    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.CHECKING.value
    assert fake_redis.calls == [
        {
            "job_name": "attempt_hold_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_book_job_allows_retry_after_hold_expired(
    client,
    fake_redis,
    seed_job,
    seed_cart,
    fetch_job,
):
    job = await seed_job(
        status=JobStatus.HOLD_PLACED.value,
        last_result=[
            {"site": "Lake Mackenzie Hut", "status": "available", "evidence": "4 bunks"},
        ],
    )
    await seed_cart(job.id, expires_at=utcnow() - timedelta(minutes=1))

    response = await client.post(f"/api/v1/jobs/{job.id}/book")

    assert response.status_code == 202
    assert response.json() == {"status": "enqueued", "job_id": job.id}
    refreshed = await fetch_job(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.CHECKING.value
    assert fake_redis.calls == [
        {
            "job_name": "close_browser_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        },
        {
            "job_name": "attempt_hold_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_complete_booking_marks_cart_complete_and_closes_browser(
    client,
    fake_redis,
    seed_job,
    seed_cart,
    fetch_job,
    fetch_latest_cart,
):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id)

    response = await client.post(f"/api/v1/jobs/{job.id}/complete")

    assert response.status_code == 200
    assert response.json() == {"status": "completed", "job_id": job.id}

    refreshed = await fetch_job(job.id)
    cart = await fetch_latest_cart(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.BOOKING_COMPLETE.value
    assert cart is not None
    assert cart.completed_at is not None
    assert fake_redis.calls == [
        {
            "job_name": "snapshot_complete_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        },
        {
            "job_name": "close_browser_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        },
    ]


async def test_cancel_booking_marks_cart_complete_and_stops_hold(
    client,
    fake_redis,
    seed_job,
    seed_cart,
    fetch_job,
    fetch_latest_cart,
):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id)

    response = await client.post(f"/api/v1/jobs/{job.id}/cancel")

    assert response.status_code == 200
    assert response.json() == {"status": "cancelled", "job_id": job.id}

    refreshed = await fetch_job(job.id)
    cart = await fetch_latest_cart(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.CANCELLED.value
    assert cart is not None
    assert cart.completed_at is not None
    assert fake_redis.calls == [
        {
            "job_name": "close_browser_task",
            "args": [job.id],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]
