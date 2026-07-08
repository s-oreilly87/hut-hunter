import json
from datetime import timedelta

import pytest

from app.core.config import settings
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


async def test_pay_page_renders_vnc_embed_for_active_hold(client, seed_job, seed_cart, monkeypatch):
    monkeypatch.setattr(settings, "vnc_url", "http://localhost:6080")
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert 'const vncConfig = {"base_url": null, "host": null, "port": 6080, "path": "websockify"};' in response.text
    assert "/vnc.html" in response.text
    assert "window.location.hostname" in response.text
    assert "resize', 'scale'" in response.text
    assert "view_clip', '0'" in response.text
    assert "syncViewportHeight" in response.text
    assert "Open VNC directly" in response.text
    assert "Open Keyboard" in response.text
    assert "Prev Field" in response.text
    assert "Next Field" in response.text
    assert "Use two fingers to scroll inside the booking page" in response.text
    assert 'data-assist="keyboard"' in response.text
    assert "/api/v1/jobs/${jobId}/assist/${action}" in response.text
    assert "primeMobileField" in response.text
    assert "mobile-embed" in response.text
    assert "Booking Complete" in response.text
    assert "Hold expires in ~" in response.text


async def test_pay_page_prefers_explicit_vnc_url_override(client, seed_job, seed_cart, monkeypatch):
    monkeypatch.setattr(settings, "vnc_url", "https://vnc.example.test")
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert 'const vncConfig = {"base_url": "https://vnc.example.test", "host": "vnc.example.test", "port": null, "path": "websockify"};' in response.text
    assert "/vnc.html" in response.text


async def test_pay_page_uses_vnc_port_when_no_vnc_url_override(client, seed_job, seed_cart, monkeypatch):
    monkeypatch.setattr(settings, "vnc_url", None)
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "vnc_port", 6090)
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert 'const vncConfig = {"base_url": null, "host": null, "port": 6090, "path": "websockify"};' in response.text
    assert "/vnc.html" in response.text


async def test_pay_page_uses_app_url_for_vnc_in_production(client, seed_job, seed_cart, monkeypatch):
    monkeypatch.setattr(settings, "vnc_url", None)
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_url", "https://hut-hunter.example.test")
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert (
        'const vncConfig = {"base_url": "https://hut-hunter.example.test", '
        '"host": "hut-hunter.example.test", "port": null, "path": "websockify"};'
    ) in response.text


async def test_pay_page_uses_request_origin_in_production(client, seed_job, seed_cart, monkeypatch):
    monkeypatch.setattr(settings, "vnc_url", None)
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_url", "http://localhost:8000")
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(
        f"/pay/{job.id}",
        headers={
            "Host": "hut-hunter.example.test",
            "X-Forwarded-Proto": "https",
        },
    )

    assert response.status_code == 200
    assert (
        'const vncConfig = {"base_url": "https://hut-hunter.example.test", '
        '"host": "hut-hunter.example.test", "port": null, "path": "websockify"};'
    ) in response.text
    assert "window.location.origin" in response.text


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


async def test_pay_page_renders_takeover_copy_for_needs_attention(client, seed_job, seed_cart, monkeypatch):
    """THR-122: a NEEDS_ATTENTION job parks its cart exactly like a
    successful hold does, so /pay/{job_id} renders the same noVNC iframe —
    just with takeover copy instead of the normal payment banner."""
    monkeypatch.setattr(settings, "vnc_url", "http://localhost:6080")
    job = await seed_job(status=JobStatus.NEEDS_ATTENTION.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=12))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert "take over this booking" in response.text
    assert "something unexpected placing this hold" in response.text
    assert "finish or cancel it yourself" in response.text
    # Same underlying noVNC mechanics as the normal payment page.
    assert "/vnc.html" in response.text
    assert "Hold expires in ~" in response.text
    assert "Booking Complete" in response.text
    # The normal-mode payment banner copy should not also be present.
    assert "click <strong>Booking Complete</strong> after you've paid — the job moves" not in response.text


async def test_pay_page_uses_normal_copy_for_hold_placed(client, seed_job, seed_cart, monkeypatch):
    """Sanity check that the default 'pay' mode is unaffected by the new
    takeover branch — same assertions as the pre-existing active-hold test,
    just re-checking the copy variant explicitly."""
    monkeypatch.setattr(settings, "vnc_url", "http://localhost:6080")
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 200
    assert "Hut Hunter — complete your booking" in response.text
    assert "take over this booking" not in response.text
    assert "something unexpected placing this hold" not in response.text


async def test_pay_page_returns_gone_when_needs_attention_cart_has_expired(client, seed_job, seed_cart):
    job = await seed_job(status=JobStatus.NEEDS_ATTENTION.value)
    await seed_cart(job.id, expires_at=utcnow() - timedelta(minutes=1))

    response = await client.get(f"/pay/{job.id}")

    assert response.status_code == 410
    assert "Hold expired" in response.text


async def test_assist_live_booking_page_enqueues_hold_worker_action(
    client,
    fake_redis,
    seed_job,
    seed_cart,
):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.post(f"/api/v1/jobs/{job.id}/assist/focus-next")

    assert response.status_code == 202
    assert response.json() == {
        "queued": True,
        "job_id": job.id,
        "action": "focus-next",
    }
    assert fake_redis.calls[-1]["job_name"] == "assist_live_browser_task"
    assert fake_redis.calls[-1]["args"] == [job.id, "focus-next"]


async def test_assist_live_booking_page_works_during_needs_attention(
    client,
    fake_redis,
    seed_job,
    seed_cart,
):
    """THR-122: the mobile remote-assist controls (scroll/focus/keyboard
    relay) must keep working during a takeover session, not just a normal
    HOLD_PLACED payment."""
    job = await seed_job(status=JobStatus.NEEDS_ATTENTION.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=12))

    response = await client.post(f"/api/v1/jobs/{job.id}/assist/focus-next")

    assert response.status_code == 202
    assert fake_redis.calls[-1]["job_name"] == "assist_live_browser_task"
    assert fake_redis.calls[-1]["args"] == [job.id, "focus-next"]


async def test_assist_live_booking_page_rejects_unknown_action(
    client,
    seed_job,
    seed_cart,
):
    job = await seed_job(status=JobStatus.HOLD_PLACED.value)
    await seed_cart(job.id, expires_at=utcnow() + timedelta(minutes=20))

    response = await client.post(f"/api/v1/jobs/{job.id}/assist/tap-random-thing")

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown assist action"


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
