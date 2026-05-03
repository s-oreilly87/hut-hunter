import pytest

pytestmark = pytest.mark.asyncio


async def test_notification_settings_default_to_none(client):
    response = await client.get("/api/v1/notifications")

    assert response.status_code == 200
    assert response.json() == {
        "email_enabled": False,
        "email_configured": False,
        "email_address": None,
        "gotify_enabled": False,
        "gotify_configured": False,
        "gotify_url": None,
        "gotify_has_token": False,
    }


async def test_notification_settings_can_save_and_enable_email(client):
    save_response = await client.put(
        "/api/v1/notifications",
        json={"email_address": "alerts@example.com"},
    )

    assert save_response.status_code == 200
    assert save_response.json()["email_configured"] is True
    assert save_response.json()["email_enabled"] is False

    enable_response = await client.put(
        "/api/v1/notifications",
        json={"email_enabled": True},
    )

    assert enable_response.status_code == 200
    payload = enable_response.json()
    assert payload["email_enabled"] is True
    assert payload["email_address"] == "alerts@example.com"


async def test_notification_settings_require_email_before_enabling(client):
    response = await client.put(
        "/api/v1/notifications",
        json={"email_enabled": True},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Save an email address before enabling email notifications."
    )


async def test_notification_settings_can_save_and_enable_gotify(client):
    save_response = await client.put(
        "/api/v1/notifications",
        json={
            "gotify_url": "https://gotify.example.com/",
            "gotify_token": "secret-token",
        },
    )

    assert save_response.status_code == 200
    payload = save_response.json()
    assert payload["gotify_configured"] is True
    assert payload["gotify_enabled"] is False
    assert payload["gotify_url"] == "https://gotify.example.com"
    assert payload["gotify_has_token"] is True

    enable_response = await client.put(
        "/api/v1/notifications",
        json={"gotify_enabled": True},
    )

    assert enable_response.status_code == 200
    assert enable_response.json()["gotify_enabled"] is True


async def test_notification_settings_are_scoped_per_user(client):
    create_response = await client.put(
        "/api/v1/notifications",
        json={
            "email_address": "owner@example.com",
            "email_enabled": True,
        },
    )
    assert create_response.status_code == 200

    logout_response = await client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "password123",
        },
    )
    assert register_response.status_code == 201

    list_response = await client.get("/api/v1/notifications")
    assert list_response.status_code == 200
    assert list_response.json()["email_enabled"] is False
    assert list_response.json()["email_address"] is None


async def test_notification_settings_require_authentication(anonymous_client):
    response = await anonymous_client.get("/api/v1/notifications")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"
