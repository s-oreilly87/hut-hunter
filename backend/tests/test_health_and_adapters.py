import pytest

from app.core.config import settings

pytestmark = pytest.mark.asyncio


async def test_health_check_reports_environment(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "environment": settings.environment,
    }


async def test_get_adapters_returns_doc_metadata(client):
    response = await client.get("/api/v1/adapters")

    assert response.status_code == 200
    adapters = response.json()
    adapter = next(item for item in adapters if item["adapter_id"] == "doc_great_walk")

    assert adapter["name"] == "DOC Great Walk"
    assert adapter["requires_credentials"] is True
    assert adapter["booking_timezone"] == "Pacific/Auckland"
    assert adapter["booking_cutoff_time"] == "20:00:00"
    assert any(
        field["key"] == "track" and field["type"] == "select"
        for field in adapter["param_fields"]
    )
    assert any(
        field["key"] == "direction" and field["filter_by"] == "track"
        for field in adapter["param_fields"]
    )
