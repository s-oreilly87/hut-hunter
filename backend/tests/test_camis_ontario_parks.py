"""Unit tests for CamisOntarioParksAdapter (HH-104).

Network- and browser-free. Deliberately thin: after the HH-104 hoist the
Ontario adapter is pure configuration over ``BaseCamisAdapter``, so these tests
pin the config values and prove the shared, catalog-driven machinery works
against the shipped ``ontario_parks.json`` — the config-reuse benchmark the
milestone exists to measure.
"""

from __future__ import annotations

from app.adapters import adapter_requires_credentials, get_adapter, list_adapters
from app.adapters.base_camis import (
    BaseCamisAdapter,
    _parse_equipment_option,
    _parse_park_option,
)
from app.adapters.camis_ontario_parks import CamisOntarioParksAdapter


def test_registered_in_registry():
    assert isinstance(get_adapter("camis_ontario_parks"), CamisOntarioParksAdapter)
    assert "camis_ontario_parks" in {a["adapter_id"] for a in list_adapters()}


def test_requires_credentials_flow():
    assert adapter_requires_credentials("camis_ontario_parks") is True


def test_ontario_config():
    adapter = CamisOntarioParksAdapter()
    assert isinstance(adapter, BaseCamisAdapter)
    assert adapter.base_url == "https://reservations.ontarioparks.ca"
    assert adapter.culture == "en-CA"
    assert adapter.booking_timezone == "America/Toronto"
    assert adapter.catalog_path is not None and adapter.catalog_path.name == "ontario_parks.json"
    # Platform-wide measured hold window (HH-103) inherited; re-confirm in HH-105.
    assert adapter.cart_hold_minutes == 15


def test_param_fields_from_ontario_catalog():
    fields = {f.key: f for f in CamisOntarioParksAdapter.param_fields()}
    assert set(fields) == {
        "park", "booking_category", "date", "nights", "people",
        "equipment", "occupants",
    }

    # THR-132: equipment select from the scraped tree; Ontario's frontcountry
    # small tent is labelled "Single Tent", id -32768/-32768 (shared enum).
    equipment = fields["equipment"]
    assert _parse_equipment_option(equipment.default) == (-32768, -32768)
    assert equipment.default.startswith("Single Tent ")

    park = fields["park"]
    # ontario_parks.json ships 129 parks; every option must round-trip.
    assert park.options and len(park.options) > 100
    assert all(_parse_park_option(opt) is not None for opt in park.options)

    category = fields["booking_category"]
    # Ontario's taxonomy differs from BC's, but Campsite is category 0 on both.
    assert "Campsite" in (category.options or [])
    assert category.default == "Campsite"
    assert "Roofed Accommodation" in (category.options or [])


def test_resolution_builds_valid_query_from_ontario_catalog():
    adapter = CamisOntarioParksAdapter()
    fields = {f.key: f for f in CamisOntarioParksAdapter.param_fields()}
    resolved = adapter._resolve_params(
        {
            "park": fields["park"].options[0],
            "booking_category": "Campsite",
            "date": "15/09/2026",
            "nights": 2,
        }
    )
    query = adapter._build_availability_query(resolved)
    assert query["resourceLocationId"] == _parse_park_option(fields["park"].options[0])
    assert query["bookingCategoryId"] == 0
    assert query["startDate"] == "2026-09-15"
    assert query["endDate"] == "2026-09-17"  # checkout date = start + nights
    assert isinstance(query["mapId"], int)  # root_map_id resolved from catalog


def test_adapters_share_base_machinery_and_differ_only_in_config():
    """The HH-104 benchmark: BC and Ontario share every method; only class
    config attributes differ."""
    from app.adapters.camis_bc_parks import CamisBcParksAdapter

    for name in ("param_fields", "_resolve_params", "detect_availability",
                 "attempt_hold", "fill_form", "occupant_fields"):
        # Neither subclass overrides behaviour — everything is the base impl.
        assert name not in CamisBcParksAdapter.__dict__
        assert name not in CamisOntarioParksAdapter.__dict__
        assert name in BaseCamisAdapter.__dict__ or hasattr(BaseCamisAdapter, name)

    assert CamisBcParksAdapter.base_url != CamisOntarioParksAdapter.base_url
    assert CamisBcParksAdapter.booking_timezone != CamisOntarioParksAdapter.booking_timezone
    assert CamisBcParksAdapter.catalog_path != CamisOntarioParksAdapter.catalog_path
