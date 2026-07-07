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


async def test_credential_save_enqueues_verification_and_starts_pending(client, fake_redis, auth_user):
    """THR-126: a fresh save immediately flips to PENDING (server-driven —
    not a client timer) and auto-triggers a login check on the hold queue."""
    response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={"username": "walker@example.com", "password": "secret-pass"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_verified"] is None
    assert body["verification_status"] == "pending"
    assert body["verification_message"] is None
    assert body["verified_at"] is None
    assert fake_redis.calls == [
        {
            "job_name": "verify_credentials_task",
            "args": [auth_user.id, "doc_great_walk"],
            "kwargs": {"_queue_name": "arq:holds"},
        }
    ]


async def test_credential_update_resets_verification_state(client, seed_credential):
    """THR-123: any change to a credential's sign-in resets verification — a
    stale True would otherwise keep gating holds open on a credential nobody
    has actually re-checked since the change. THR-126: it then immediately
    moves to PENDING rather than sitting at unverified, since the save always
    re-triggers a check."""
    await seed_credential(adapter_id="doc_great_walk", is_verified=True)

    response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={"username": "updated@example.com"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_verified"] is None
    assert body["verification_status"] == "pending"
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


async def test_verify_now_marks_credential_pending(client, seed_credential):
    """THR-126: "Verify now"/"Re-verify" flips the badge to PENDING right
    away via the server, instead of the frontend guessing from a local timer."""
    await seed_credential(adapter_id="doc_great_walk", verification_status="failed")

    response = await client.post("/api/v1/credentials/doc_great_walk/verify")
    assert response.status_code == 202

    list_response = await client.get("/api/v1/credentials")
    assert list_response.status_code == 200
    [credential] = list_response.json()
    assert credential["verification_status"] == "pending"


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


async def test_doc_adapters_share_one_credential_realm(client):
    """THR-126: DocStandardHutAdapter and DocGreatWalkAdapter are both
    bookings.doc.govt.nz accounts — saving one covers the other, and both
    surface under the same (alphabetically-first) adapter_id so the frontend
    renders a single combined card rather than asking for the login twice."""
    create_response = await client.put(
        "/api/v1/credentials/doc_standard_hut",
        json={"username": "walker@example.com", "password": "secret-pass"},
    )
    assert create_response.status_code == 200
    # Canonical display id is the alphabetically-first member of the realm.
    assert create_response.json()["adapter_id"] == "doc_great_walk"

    list_response = await client.get("/api/v1/credentials")
    assert list_response.status_code == 200
    rows = list_response.json()
    # One shared row, not two — displayed under doc_great_walk regardless of
    # which member adapter_id the save happened through.
    assert [row["adapter_id"] for row in rows] == ["doc_great_walk"]

    # Reading/writing via the OTHER member id resolves to the same row.
    other_get = await client.post("/api/v1/credentials/doc_great_walk/verify")
    assert other_get.status_code == 202

    update_response = await client.put(
        "/api/v1/credentials/doc_great_walk",
        json={"username": "updated@example.com"},
    )
    assert update_response.status_code == 200
    list_response = await client.get("/api/v1/credentials")
    rows = list_response.json()
    assert len(rows) == 1
    assert rows[0]["username"] == "updated@example.com"

    # Camis adapters are unaffected — no realm, one row per adapter.
    camis_response = await client.put(
        "/api/v1/credentials/camis_bc_parks",
        json={"username": "camper@example.com", "password": "secret-pass"},
    )
    assert camis_response.status_code == 200
    assert camis_response.json()["adapter_id"] == "camis_bc_parks"


async def test_verify_credentials_task_persists_inconclusive(
    seed_credential, auth_user, session_factory, monkeypatch,
):
    """THR-126 (fixes THR-123 §3b): an INCONCLUSIVE result used to be logged
    and dropped — no DB write, so the UI's "Verifying…" spinner just reverted
    to Unverified with zero explanation. It must now persist the status and
    the message so the frontend can show "Couldn't verify — retry"."""
    from contextlib import asynccontextmanager

    from app.adapters.base import CredentialVerificationResult, VerificationStatus
    from app.core.adapter_credentials import get_adapter_credential_record
    import app.workers.hold_worker as hw

    await seed_credential(adapter_id="doc_great_walk", verification_status="pending")

    class _StubAdapter:
        def set_login_credentials(self, credentials):
            pass

        async def verify_credentials(self, page):
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, "Could not reach the login form: timeout"
            )

    @asynccontextmanager
    async def _fake_browser_page(*, headless, display=None):
        yield object(), (lambda job_id: None)

    monkeypatch.setattr(hw, "get_adapter", lambda adapter_id: _StubAdapter())
    monkeypatch.setattr(hw, "_browser_page", _fake_browser_page)
    monkeypatch.setattr(hw, "AsyncSessionLocal", session_factory)

    result = await hw.verify_credentials_task({}, auth_user.id, "doc_great_walk")

    assert result["status"] == "inconclusive"

    async with session_factory() as session:
        record = await get_adapter_credential_record(session, auth_user.id, "doc_great_walk")
        assert record.verification_status == "inconclusive"
        assert record.verification_message == "Could not reach the login form: timeout"
        # Neither true nor false — the check simply didn't complete.
        assert record.is_verified is None
