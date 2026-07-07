import pytest

from app.core.adapter_credentials import get_user_failed_adapter_ids

pytestmark = pytest.mark.asyncio


async def test_get_user_failed_adapter_ids_only_returns_explicitly_failed(
    session_factory, seed_credential, auth_user,
):
    """THR-123: only is_verified=False counts as failed — None (legacy/
    pending) and True (verified) must not show up here."""
    await seed_credential(adapter_id="doc_great_walk", is_verified=False)
    await seed_credential(adapter_id="doc_standard_hut", is_verified=True)
    await seed_credential(adapter_id="camis_bc_parks", is_verified=None)

    async with session_factory() as session:
        failed_ids = await get_user_failed_adapter_ids(session, auth_user.id)

    assert failed_ids == {"doc_great_walk"}


async def test_credential_save_enqueues_verification_and_starts_unverified(client, fake_redis, auth_user):
    """THR-123: a fresh save starts unverified (is_verified=None) and
    auto-triggers a login check on the hold queue."""
    response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={"username": "walker@example.com", "password": "secret-pass"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_verified"] is None
    assert body["verified_at"] is None
    assert fake_redis.calls == [
        {
            "job_name": "verify_credentials_task",
            "args": [auth_user.id, "doc_great_walk"],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_credential_update_resets_verification_state(client, seed_credential):
    """THR-123: any change to a credential's sign-in resets is_verified — a
    stale True would otherwise keep gating holds open on a credential nobody
    has actually re-checked since the change."""
    await seed_credential(adapter_id="doc_great_walk", is_verified=True)

    response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={"username": "updated@example.com"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_verified"] is None
    assert body["verified_at"] is None


async def test_verify_now_enqueues_verify_credentials_task(client, fake_redis, seed_credential, auth_user):
    await seed_credential(adapter_id="doc_great_walk")

    response = await client.post("/api/v1/credentials/doc_great_walk/verify")

    assert response.status_code == 202
    assert fake_redis.calls == [
        {
            "job_name": "verify_credentials_task",
            "args": [auth_user.id, "doc_great_walk"],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_verify_now_requires_existing_credential(client):
    response = await client.post("/api/v1/credentials/doc_great_walk/verify")

    assert response.status_code == 404


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
