"""Unit tests for CamisParksCanadaAdapter (HH-108 config-only spike).

Third Camis instance, added to validate that a new site is pure configuration
over ``BaseCamisAdapter`` — the first validation target for the Agentic
Adapter Builder pipeline. Same thin shape as the Ontario tests.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.adapters import (
    adapter_park_url,
    adapter_requires_credentials,
    adapter_supports_automated_booking,
    get_adapter,
    list_adapters,
)
from app.adapters.base import AvailabilityStatus, BookingWindowInfo, StayPatternInfo
from app.adapters.base_camis import (
    BaseCamisAdapter,
    _parse_equipment_option,
    _parse_park_option,
)
from app.adapters.camis_parks_canada import CamisParksCanadaAdapter

_ACCOM_FIXTURE = (
    Path(__file__).parent / "fixtures" / "camis_parks_canada_accommodation_fundy.json"
)


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
    assert set(fields) == {
        "park", "booking_category", "date", "nights", "people",
        "equipment", "occupants",
    }
    park = fields["park"]
    # parks_canada.json ships 114 locations; every option must round-trip.
    assert park.options and len(park.options) > 100
    assert all(_parse_park_option(opt) is not None for opt in park.options)
    # "Campsite" is booking category 0 on this instance too.
    assert fields["booking_category"].default == "Campsite"

    # THR-132: Parks Canada exposes TWO equipment groups (frontcountry
    # "Equipment" + "Backcountry"); the default is the frontcountry "Small
    # Tent" (-32768/-32768), and the grouped tree carries both.
    equipment = fields["equipment"]
    assert _parse_equipment_option(equipment.default) == (-32768, -32768)
    assert equipment.default.startswith("Small Tent ")
    groups = {g["group"] for g in (equipment.options_tree or [])}
    assert {"Equipment", "Backcountry"} <= groups


def test_config_only_no_behaviour_overrides():
    for name in ("param_fields", "_resolve_params", "detect_availability",
                 "attempt_hold", "fill_form", "occupant_fields"):
        assert name not in CamisParksCanadaAdapter.__dict__


def test_adapter_park_url_builds_results_deep_link():
    # THR-129 item 2: WatchJobRead.park_url is populated via this helper —
    # exercise it against the real parks_canada.json catalog (Banff - Castle
    # Mountain, -2147483511) so a genuine "Name (id)" option round-trips into
    # a results-page deep-link the frontend can hyperlink.
    park_option = next(
        opt for opt in CamisParksCanadaAdapter.param_fields()[0].options
        if opt.startswith("Banff - Castle Mountain")
    )
    url = adapter_park_url(
        "camis_parks_canada",
        {"park": park_option, "booking_category": "Campsite", "date": "01/08/2099", "nights": 1, "people": 2},
    )
    assert url is not None
    assert url.startswith("https://reservation.pc.gc.ca/create-booking/results")
    assert "resourceLocationId=-2147483511" in url


def test_adapter_park_url_none_when_unresolvable():
    # No park selected yet — fails soft to None, same as the adapter method.
    assert adapter_park_url("camis_parks_canada", {}) is None


def test_adapter_park_url_none_for_unknown_adapter():
    # Unknown adapter id: tolerated, same fail-open posture as the rest of
    # this module. (THR-130: DOC adapters now DO return a page-level
    # results_url — see test_get_job_park_url_* in test_jobs_api.py.)
    assert adapter_park_url("nope", {}) is None


def test_availability_query_includes_confirmed_ui_extras():
    # Parks Canada's Campsite query carries the full /api/availability/map
    # shape: the equipment filter (equipmentCategoryId/subEquipmentCategoryId/
    # isReserving/filterData/numEquipment — THR-132, now shared across all
    # Camis adapters) PLUS the party-size capacity filter
    # (peopleCapacityCategoryCounts), which stays Parks-Canada-only via
    # DEFAULT_CAPACITY_CATEGORY_ID (confirmed live only against
    # reservation.pc.gc.ca).
    adapter = CamisParksCanadaAdapter()
    assert adapter.DEFAULT_CAPACITY_CATEGORY_ID == -32767
    query = adapter._build_availability_query({
        "resource_location_id": -2147483511,
        "map_id": -1,
        "booking_category_id": 0,
        "date": "01/08/2026",
        "nights": 2,
        "people": 2,
    })
    assert query["isReserving"] == "true"
    assert query["filterData"] == "[]"
    assert query["numEquipment"] == 0
    assert query["equipmentCategoryId"] == -32768
    assert query["subEquipmentCategoryId"] == -32768
    # THR-131: peopleCapacityCategoryCounts is now a JSON *string*, not a
    # Python list — the live API accepts the URL-encoded JSON array and 400s
    # on anything httpx/Playwright produce from a nested list/dict value.
    assert isinstance(query["peopleCapacityCategoryCounts"], str)
    assert json.loads(query["peopleCapacityCategoryCounts"]) == [{
        "capacityCategoryId": -32767,
        "subCapacityCategoryId": None,
        "count": 2,
    }]


def test_accommodation_query_omits_equipment_but_keeps_capacity():
    # THR-131: the "Parks Canada Accommodation" category (id 1 — the huts)
    # takes NO equipment filter (a tent size is meaningless for an oTENTik/
    # cabin/yurt; confirmed live that availability reads correctly without
    # one), but it DOES take the party-size capacity filter — same
    # capacityCategoryId (-32767) as Campsite, honored live for category 1.
    adapter = CamisParksCanadaAdapter()
    query = adapter._build_availability_query({
        "resource_location_id": -2147483621,
        "map_id": -1,
        "booking_category_id": 1,
        "date": "19/09/2026",
        "nights": 2,
        "people": 3,
    })
    for key in (
        "equipmentCategoryId", "subEquipmentCategoryId",
        "isReserving", "numEquipment", "filterData",
    ):
        assert key not in query, f"accommodation query must not send {key}"
    assert json.loads(query["peopleCapacityCategoryCounts"]) == [{
        "capacityCategoryId": -32767,
        "subCapacityCategoryId": None,
        "count": 3,
    }]


async def test_accommodation_detection_from_live_fixture():
    # THR-131: the huts (Parks Canada Accommodation, category 1) detect
    # correctly through the shared BaseCamisAdapter availability path — same
    # /api/availability/map endpoint, map tree, drill and per-site code shape
    # as Campsite. Fixture captured live from reservation.pc.gc.ca (Fundy -
    # Headquarters, 2026-09-19, 2 nights): 6 of 117 units free for the full
    # stay. Offline + deterministic — the network reads are stubbed.
    fixture = json.loads(_ACCOM_FIXTURE.read_text())
    responses = fixture["responses_by_map_id"]
    adapter = CamisParksCanadaAdapter()

    async def fake_map(page, query):
        return responses[str(query["mapId"])]

    async def fake_window(params):
        return BookingWindowInfo(is_open=True)

    async def fake_stay_pattern(params):
        return StayPatternInfo(is_compliant=True)

    adapter._get_map_availability = fake_map  # type: ignore[method-assign]
    adapter.check_booking_window = fake_window  # type: ignore[method-assign]
    adapter.check_stay_pattern = fake_stay_pattern  # type: ignore[method-assign]

    results = await adapter.detect_availability(None, {
        "resource_location_id": -2147483621,
        "booking_category": "Parks Canada Accommodation",
        "date": "19/09/2026",
        "nights": 2,
        "people": 2,
    })
    assert len(results) == 1
    assert results[0].status == AvailabilityStatus.AVAILABLE
    assert results[0].total_available == 6
    assert "6 sites available" in results[0].evidence
