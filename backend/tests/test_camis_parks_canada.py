"""Unit tests for CamisParksCanadaAdapter (HH-108 config-only spike).

Third Camis instance, added to validate that a new site is pure configuration
over ``BaseCamisAdapter`` — the first validation target for the Agentic
Adapter Builder pipeline. Same thin shape as the Ontario tests.
"""

from __future__ import annotations

from app.adapters import (
    adapter_requires_credentials,
    adapter_supports_automated_booking,
    get_adapter,
    list_adapters,
)
from app.adapters.base_camis import BaseCamisAdapter, _parse_park_option
from app.adapters.camis_parks_canada import CamisParksCanadaAdapter


def test_registered_in_registry():
    assert isinstance(get_adapter("camis_parks_canada"), CamisParksCanadaAdapter)
    assert "camis_parks_canada" in {a["adapter_id"] for a in list_adapters()}


def test_watch_notify_only_flags():
    # Parks Canada sign-in is Google/Facebook/GCKey SSO only (HH-118): no
    # automated booking, and no storable credential either — so it must not
    # appear in the Sign-Ins dialog (requires_credentials False).
    assert adapter_supports_automated_booking("camis_parks_canada") is False
    assert adapter_requires_credentials("camis_parks_canada") is False
    # Every other adapter still supports booking (the default).
    for entry in list_adapters():
        expected = entry["adapter_id"] != "camis_parks_canada"
        assert entry["supports_automated_booking"] is expected
    # Unknown adapters are tolerated (True) so other validation surfaces first.
    assert adapter_supports_automated_booking("nope") is True


def test_parks_canada_config():
    adapter = CamisParksCanadaAdapter()
    assert isinstance(adapter, BaseCamisAdapter)
    assert adapter.base_url == "https://reservation.pc.gc.ca"
    # Westernmost of the 7 zones Parks Canada spans, so is_expired never
    # retires a job before its park-local cutoff (see module docstring).
    assert adapter.booking_timezone == "America/Vancouver"
    assert adapter.catalog_path is not None and adapter.catalog_path.name == "parks_canada.json"
    assert adapter.cart_hold_minutes == 15  # platform default; hold unproven here


def test_param_fields_from_parks_canada_catalog():
    fields = {f.key: f for f in CamisParksCanadaAdapter.param_fields()}
    assert set(fields) == {"park", "booking_category", "date", "nights", "people", "occupants"}
    park = fields["park"]
    # parks_canada.json ships 114 locations; every option must round-trip.
    assert park.options and len(park.options) > 100
    assert all(_parse_park_option(opt) is not None for opt in park.options)
    # "Campsite" is booking category 0 on this instance too.
    assert fields["booking_category"].default == "Campsite"


def test_config_only_no_behaviour_overrides():
    for name in ("param_fields", "_resolve_params", "detect_availability",
                 "attempt_hold", "fill_form", "occupant_fields"):
        assert name not in CamisParksCanadaAdapter.__dict__
