import json
from datetime import timedelta

import pytest

from app.models.job import JobStatus, WatchJob, utcnow

pytestmark = pytest.mark.asyncio


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


async def test_resume_and_pay_routes_require_authentication(
    anonymous_client,
    seed_cart,
    session_factory,
    make_job_params,
):
    job = WatchJob(
        user_id="some-user",
        name="Private Job",
        adapter_id="doc_great_walk",
        params=json.dumps(make_job_params()),
        status=JobStatus.HOLD_PLACED.value,
    )
    async with session_factory() as session:
        session.add(job)
        await session.commit()
        await session.refresh(job)

    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    resume_response = await anonymous_client.get(f"/api/v1/jobs/{job.id}/resume")
    pay_response = await anonymous_client.get(f"/pay/{job.id}")

    assert resume_response.status_code == 401
    assert pay_response.status_code == 401
