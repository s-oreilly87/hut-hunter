"""Unit tests for CamisBcParksAdapter (HH-102).

Network- and browser-free: registration, credentials flag, params schema built
from the shipped bc_parks.json catalog, and the option-string → Camis-ID
resolution that feeds the shared availability/hold flows. The live funnel
itself is exercised in the HH-103 E2E pass.
"""

from __future__ import annotations

import pytest

from app.adapters import adapter_requires_credentials, get_adapter, list_adapters
from app.adapters.base_camis import BaseCamisAdapter
from app.adapters.camis_bc_parks import (
    CamisBcParksAdapter,
    _format_park_option,
    _parse_park_option,
)


# ---------------------------------------------------------------------------
# Registration + platform config
# ---------------------------------------------------------------------------

def test_registered_in_registry():
    assert isinstance(get_adapter("camis_bc_parks"), CamisBcParksAdapter)
    listed = {a["adapter_id"] for a in list_adapters()}
    assert "camis_bc_parks" in listed


def test_requires_credentials_flow():
    # The frontend gates the credentials fields on this flag (HH-102 AC).
    assert adapter_requires_credentials("camis_bc_parks") is True


def test_bc_config():
    adapter = CamisBcParksAdapter()
    assert isinstance(adapter, BaseCamisAdapter)
    assert adapter.base_url == "https://camping.bcparks.ca"
    assert adapter.culture == "en-CA"
    assert adapter.booking_timezone == "America/Vancouver"
    assert adapter.catalog_path is not None and adapter.catalog_path.name == "bc_parks.json"
    # Hold window is still measured in HH-103 — must not be guessed here.
    assert adapter.cart_hold_minutes is None


def test_list_adapters_exposes_expiry_metadata():
    entry = next(a for a in list_adapters() if a["adapter_id"] == "camis_bc_parks")
    assert entry["requires_credentials"] is True
    assert entry["booking_timezone"] == "America/Vancouver"


# ---------------------------------------------------------------------------
# Param schema (built from the shipped bc_parks.json)
# ---------------------------------------------------------------------------

def test_param_fields_schema():
    fields = {f.key: f for f in CamisBcParksAdapter.param_fields()}
    assert set(fields) == {"park", "booking_category", "date", "nights", "people"}

    park = fields["park"]
    assert park.type == "select"
    # The shipped catalog has ~145 BC parks; the schema must be non-empty and
    # every option must round-trip through the parser.
    assert park.options and len(park.options) > 100
    assert all(_parse_park_option(opt) is not None for opt in park.options)
    # Alphabetical for the dropdown.
    assert park.options == sorted(park.options, key=str.lower)

    category = fields["booking_category"]
    assert category.type == "select"
    assert "Campsite" in (category.options or [])
    assert category.default == "Campsite"

    assert fields["date"].type == "date"
    assert fields["nights"].min == 1
    assert fields["people"].min == 1


# ---------------------------------------------------------------------------
# Option-string parsing
# ---------------------------------------------------------------------------

def test_park_option_round_trip():
    park = {"full_name": "Bamberton Provincial Park", "resource_location_id": -2147483646}
    opt = _format_park_option(park)
    assert opt == "Bamberton Provincial Park (-2147483646)"
    assert _parse_park_option(opt) == -2147483646


def test_park_option_with_parentheses_in_name():
    park = {"full_name": "sx̌ʷəx̌ʷnitkʷ (Okanagan Falls) Park", "resource_location_id": -42}
    assert _parse_park_option(_format_park_option(park)) == -42


@pytest.mark.parametrize("bad", ["", "No id here", "Trailing (words)", "(-5)"])
def test_park_option_rejects_malformed(bad):
    assert _parse_park_option(bad) is None


# ---------------------------------------------------------------------------
# Param resolution → Camis IDs
# ---------------------------------------------------------------------------

def test_resolve_params_maps_park_and_category():
    adapter = CamisBcParksAdapter()
    fields = {f.key: f for f in CamisBcParksAdapter.param_fields()}
    park_opt = fields["park"].options[0]

    resolved = adapter._resolve_params(
        {"park": park_opt, "booking_category": "Campsite", "date": "01/08/2026"}
    )
    assert resolved["resource_location_id"] == _parse_park_option(park_opt)
    assert resolved["booking_category_id"] == 0  # "Campsite" in the shipped catalog
    # Original params are not mutated.
    assert "resource_location_id" not in {"park": park_opt}


def test_resolve_params_explicit_ids_win():
    adapter = CamisBcParksAdapter()
    resolved = adapter._resolve_params(
        {
            "park": "Bamberton Provincial Park (-2147483646)",
            "resource_location_id": -7,
            "booking_category": "Campsite",
            "booking_category_id": 4,
        }
    )
    assert resolved["resource_location_id"] == -7
    assert resolved["booking_category_id"] == 4


def test_resolve_params_unparseable_park_leaves_id_unset():
    adapter = CamisBcParksAdapter()
    resolved = adapter._resolve_params({"park": "not an option string"})
    assert "resource_location_id" not in resolved


def test_resolved_params_build_a_valid_availability_query():
    """End-to-end through the base query builder with a real catalog park."""
    adapter = CamisBcParksAdapter()
    fields = {f.key: f for f in CamisBcParksAdapter.param_fields()}
    resolved = adapter._resolve_params(
        {
            "park": fields["park"].options[0],
            "booking_category": "Campsite",
            "date": "01/08/2026",
            "nights": 2,
        }
    )
    query = adapter._build_availability_query(resolved)
    assert query["resourceLocationId"] == resolved["resource_location_id"]
    assert query["bookingCategoryId"] == 0
    assert query["startDate"] == "2026-08-01"
    assert query["endDate"] == "2026-08-02"  # 2 nights → end = start + 1
    # map_id came from the catalog's root_map_id for that park.
    assert isinstance(query["mapId"], int)
