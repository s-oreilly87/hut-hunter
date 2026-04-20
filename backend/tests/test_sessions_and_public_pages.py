import json
from datetime import timedelta

import pytest

from app.core.crypto import decrypt
from app.models.job import JobStatus, utcnow

pytestmark = pytest.mark.asyncio


async def test_store_adapter_session_encrypts_and_updates_existing_record(
    client,
    fetch_adapter_sessions,
):
    first_state = {"cookies": [{"name": "doc", "value": "abc"}]}
    second_state = {"cookies": [{"name": "doc", "value": "xyz"}]}

    create_response = await client.post(
        "/api/v1/adapters/doc_great_walk/session",
        json=first_state,
    )
    assert create_response.status_code == 201
    assert create_response.json() == {"status": "ok", "adapter_id": "doc_great_walk"}

    sessions = await fetch_adapter_sessions()
    assert len(sessions) == 1
    assert sessions[0].encrypted_state != json.dumps(first_state)
    assert json.loads(decrypt(sessions[0].encrypted_state)) == first_state

    status_response = await client.get("/api/v1/adapters/doc_great_walk/session/status")
    assert status_response.status_code == 200
    assert status_response.json()["has_session"] is True

    update_response = await client.post(
        "/api/v1/adapters/doc_great_walk/session",
        json=second_state,
    )
    assert update_response.status_code == 201

    sessions = await fetch_adapter_sessions()
    assert len(sessions) == 1
    assert json.loads(decrypt(sessions[0].encrypted_state)) == second_state


async def test_resume_cart_restores_cookies_and_redirects(client, seed_job, seed_cart):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    cookies = [
        {
            "name": "doc_session",
            "value": "abc123",
            "domain": "bookings.doc.govt.nz",
            "path": "/checkout",
        }
    ]
    await seed_cart(job.id, cookies=cookies, cart_url="https://bookings.doc.govt.nz/cart/999")

    response = await client.get(f"/api/v1/jobs/{job.id}/resume")

    assert response.status_code == 200
    assert 'document.cookie = "doc_session" + "=" + "abc123"' in response.text
    assert 'window.location.href = "https://bookings.doc.govt.nz/cart/999";' in response.text


async def test_resume_cart_returns_gone_for_expired_session(client, seed_job, seed_cart):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() - timedelta(minutes=1))

    response = await client.get(f"/api/v1/jobs/{job.id}/resume")

    assert response.status_code == 410
    assert "Cart session has expired" in response.text


async def test_pay_page_renders_vnc_embed_for_active_hold(client, seed_job, seed_cart):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert "vnc_lite.html?autoconnect=1&resize=remote" in response.text
    assert "Booking Complete" in response.text
    assert "Hold expires in ~" in response.text


@pytest.mark.parametrize(
    ("status", "expected_status_code", "expected_copy"),
    [
        (JobStatus.BOOKING_COMPLETE.value, 410, "Booking complete"),
        (JobStatus.CANCELLED.value, 410, "Hold cancelled"),
        (JobStatus.CHECKING.value, 404, "No active hold"),
    ],
)
async def test_pay_page_handles_non_live_job_statuses(
    client,
    seed_job,
    status,
    expected_status_code,
    expected_copy,
):
    job = await seed_job(status=status)

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == expected_status_code
    assert expected_copy in response.text


async def test_pay_page_returns_gone_when_hold_cart_has_expired(client, seed_job, seed_cart):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() - timedelta(minutes=1))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 410
    assert "Hold expired" in response.text
