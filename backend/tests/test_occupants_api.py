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
            "category": "NZ Adult (18+)",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["first_name"] == "Taylor"

    update_response = await client.patch(
        f"/api/v1/occupants/{created['id']}",
        json={"age": 29, "category": "International Adult (18+)"},
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["age"] == 29
    assert updated["category"] == "International Adult (18+)"

    list_response = await client.get("/api/v1/occupants")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == created["id"]

    delete_response = await client.delete(f"/api/v1/occupants/{created['id']}")
    assert delete_response.status_code == 204

    final_list_response = await client.get("/api/v1/occupants")
    assert final_list_response.status_code == 200
    assert final_list_response.json() == []
