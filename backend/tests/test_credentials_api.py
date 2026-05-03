import pytest

pytestmark = pytest.mark.asyncio


async def test_credentials_crud_flow(client):
    list_response = await client.get("/api/v1/credentials")
    assert list_response.status_code == 200
    assert list_response.json() == []

    create_response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={
            "username": "walker@example.com",
            "password": "secret-pass",
        },
    )
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["adapter_id"] == "doc_great_walk"
    assert created["username"] == "walker@example.com"
    assert created["has_password"] is True

    update_response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={
            "username": "updated@example.com",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["username"] == "updated@example.com"

    list_response = await client.get("/api/v1/credentials")
    assert list_response.status_code == 200
    assert [item["adapter_id"] for item in list_response.json()] == ["doc_great_walk"]

    delete_response = await client.delete("/api/v1/credentials/doc_great_walk")
    assert delete_response.status_code == 204

    final_list = await client.get("/api/v1/credentials")
    assert final_list.status_code == 200
    assert final_list.json() == []


async def test_credentials_are_scoped_per_user(client):
    create_response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={
            "username": "owner@example.com",
            "password": "owner-pass",
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

    list_response = await client.get("/api/v1/credentials")
    assert list_response.status_code == 200
    assert list_response.json() == []

    delete_response = await client.delete("/api/v1/credentials/doc_great_walk")
    assert delete_response.status_code == 404


async def test_credentials_require_password_on_first_save(client):
    response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={
            "username": "owner@example.com",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Password is required."


async def test_credentials_reject_non_credential_adapter(client):
    response = await client.put(
        "/api/v1/credentials/not_real_adapter",
        json={
            "username": "owner@example.com",
            "password": "owner-pass",
        },
    )

    assert response.status_code == 404


async def test_credentials_require_authentication(anonymous_client):
    response = await anonymous_client.get("/api/v1/credentials")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"
