import pytest

pytestmark = pytest.mark.asyncio


async def test_register_sets_session_and_returns_user(anonymous_client):
    response = await anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "password123",
        },
    )

    assert response.status_code == 201
    assert response.json()["email"] == "newuser@example.com"

    me_response = await anonymous_client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "newuser@example.com"


async def test_login_and_logout_flow(anonymous_client):
    register_response = await anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "password123",
        },
    )
    assert register_response.status_code == 201

    logout_response = await anonymous_client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    me_response = await anonymous_client.get("/api/v1/auth/me")
    assert me_response.status_code == 401

    login_response = await anonymous_client.post(
        "/api/v1/auth/login",
        json={
            "email": "newuser@example.com",
            "password": "password123",
        },
    )
    assert login_response.status_code == 200
    assert login_response.json()["email"] == "newuser@example.com"

    me_response = await anonymous_client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "newuser@example.com"


async def test_register_rejects_duplicate_email(anonymous_client):
    first = await anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "password123",
        },
    )
    assert first.status_code == 201

    second = await anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "password123",
        },
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "An account with that email already exists."
