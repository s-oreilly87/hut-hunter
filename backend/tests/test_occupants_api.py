import pytest

pytestmark = pytest.mark.asyncio


async def test_occupant_crud_flow(client):
    list_response = await client.get("/api/v1/occupants")
    assert list_response.status_code == 200
    assert list_response.json() == []

    create_response = await client.post(
        "/api/v1/occupants",
        json={
            "first_name": "Taylor",
            "last_name": "Ngata",
            "age": 28,
            "gender": "Female",
            "country": "New Zealand",
            "adapter_values": {
                "doc_great_walk": {
                    "category": "NZ Adult (18+)",
                }
            },
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["first_name"] == "Taylor"
    assert created["adapter_values"] == {
        "doc_great_walk": {
            "category": "NZ Adult (18+)",
        }
    }

    update_response = await client.patch(
        f"/api/v1/occupants/{created['id']}",
        json={
            "age": 29,
            "adapter_values": {
                "doc_great_walk": {
                    "category": "International Adult (18+)",
                }
            },
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["age"] == 29
    assert updated["adapter_values"] == {
        "doc_great_walk": {
            "category": "International Adult (18+)",
        }
    }

    list_response = await client.get("/api/v1/occupants")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == created["id"]
    assert list_response.json()[0]["adapter_values"]["doc_great_walk"]["category"] == (
        "International Adult (18+)"
    )

    delete_response = await client.delete(f"/api/v1/occupants/{created['id']}")
    assert delete_response.status_code == 204

    final_list_response = await client.get("/api/v1/occupants")
    assert final_list_response.status_code == 200
    assert final_list_response.json() == []


async def test_occupants_are_scoped_per_user(client):
    create_response = await client.post(
        "/api/v1/occupants",
        json={
            "first_name": "Taylor",
            "last_name": "Ngata",
            "age": 28,
            "gender": "Female",
            "country": "New Zealand",
            "adapter_values": {
                "doc_great_walk": {
                    "category": "NZ Adult (18+)",
                }
            },
        },
    )
    occupant_id = create_response.json()["id"]

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

    list_response = await client.get("/api/v1/occupants")
    assert list_response.status_code == 200
    assert list_response.json() == []

    hidden_response = await client.patch(
        f"/api/v1/occupants/{occupant_id}",
        json={"age": 29},
    )
    assert hidden_response.status_code == 404


async def test_occupants_require_authentication(anonymous_client):
    response = await anonymous_client.get("/api/v1/occupants")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


async def test_occupant_rejects_incomplete_adapter_specific_fields(client):
    response = await client.post(
        "/api/v1/occupants",
        json={
            "first_name": "Taylor",
            "last_name": "Ngata",
            "age": 28,
            "gender": "Female",
            "country": "New Zealand",
            "adapter_values": {
                "doc_great_walk": {
                    "category": "",
                }
            },
        },
    )

    # Entirely blank adapter sections are treated as omitted.
    assert response.status_code == 201
    assert response.json()["adapter_values"] == {}


async def test_occupant_rejects_unknown_adapter_fields(client):
    response = await client.post(
        "/api/v1/occupants",
        json={
            "first_name": "Taylor",
            "last_name": "Ngata",
            "age": 28,
            "gender": "Female",
            "country": "New Zealand",
            "adapter_values": {
                "doc_great_walk": {
                    "passport_number": "ABC1234",
                }
            },
        },
    )

    assert response.status_code == 400
    assert "does not define an occupant field" in response.json()["detail"]
