"""Unit tests for BaseCamisAdapter (HH-98 scaffold + HH-99 availability).

Network- and browser-free: config hooks, URL building, catalog loading, date
helpers, plus the HH-99 availability query builder and status classifier. The
cart/hold flow lands in HH-100 and is tested there.
"""

from __future__ import annotations

import json

import pytest

from app.adapters.base import AvailabilityStatus, BaseAdapter
from app.adapters.base_camis import BaseCamisAdapter


class _StubCamisAdapter(BaseCamisAdapter):
    """Minimal concrete subclass so the abstract base can be instantiated.

    Only ``param_fields`` is still abstract on the base; ``fill_form`` and
    ``detect_availability`` are implemented by the base and inherited here.
    """

    adapter_id = "camis_stub"
    name = "Camis Stub"
    base_url = "https://camping.bcparks.ca"
    booking_timezone = "America/Vancouver"

    @classmethod
    def param_fields(cls):  # abstract in BaseAdapter
        return []


def test_is_a_base_adapter():
    assert issubclass(BaseCamisAdapter, BaseAdapter)


def test_platform_defaults():
    adapter = _StubCamisAdapter()
    # Camis is account-based across every province.
    assert adapter.requires_credentials is True
    # Culture defaults to en-CA; Ontario overrides to bilingual handling.
    assert adapter.culture == "en-CA"
    # Hold timing is intentionally OPEN — must NOT silently equal DOC's 25 min.
    assert adapter.cart_hold_minutes is None


def test_api_url_joins_cleanly():
    adapter = _StubCamisAdapter()
    assert adapter.api_url("/api/maps/root") == "https://camping.bcparks.ca/api/maps/root"
    # Tolerates a missing leading slash and a trailing slash on base_url.
    adapter.base_url = "https://camping.bcparks.ca/"
    assert adapter.api_url("api/bookingcategories") == (
        "https://camping.bcparks.ca/api/bookingcategories"
    )


def test_api_url_requires_base_url():
    class _NoBase(_StubCamisAdapter):
        base_url = ""

    with pytest.raises(ValueError):
        _NoBase().api_url("/api/maps/root")


def test_known_endpoint_constants():
    # These are the endpoints recon verified answer unauthenticated (§2).
    assert BaseCamisAdapter.API_MAPS_ROOT == "/api/maps/root"
    assert BaseCamisAdapter.API_BOOKING_CATEGORIES == "/api/bookingcategories"
    assert BaseCamisAdapter.API_DATE_SCHEDULE == "/api/dateschedule/resourcelocationid"


def test_load_catalog_missing_returns_empty():
    # No catalog_path set (not yet scraped) → empty, never raises.
    assert _StubCamisAdapter()._load_catalog() == {}


def test_load_catalog_reads_file(tmp_path):
    catalog = {"scraped_at": "2026-07-05T00:00:00Z", "parks": [{"id": "1"}]}
    path = tmp_path / "bc_parks.json"
    path.write_text(json.dumps(catalog))

    class _WithCatalog(_StubCamisAdapter):
        catalog_path = path

    assert _WithCatalog()._load_catalog() == catalog


def test_load_catalog_malformed_returns_empty(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{ not valid json")

    class _Broken(_StubCamisAdapter):
        catalog_path = path

    assert _Broken()._load_catalog() == {}


def test_date_helpers():
    adapter = _StubCamisAdapter()
    assert adapter._parse_date_string("07/03/2026") == (7, 3, 2026)
    # DD/MM/YYYY → ISO YYYY-MM-DD for the JSON API.
    assert adapter._to_iso_date("07/03/2026") == "2026-03-07"
    assert adapter._generate_night_dates("07/03/2026", 3) == [
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
    ]
    # nights < 1 still yields the start night.
    assert adapter._generate_night_dates("31/12/2026", 0) == ["2026-12-31"]


def test_registry_unaffected_by_scaffold():
    # The base/stub must not register itself — only concrete province
    # adapters (camis_bc_parks since HH-102) appear in the registry.
    from app.adapters import list_adapters

    ids = {a["adapter_id"] for a in list_adapters()}
    assert "camis_stub" not in ids
    assert {"doc_great_walk", "doc_standard_hut", "camis_bc_parks"} <= ids


# ---------------------------------------------------------------------------
# HH-99 — availability query builder + status classifier
# ---------------------------------------------------------------------------

_CATALOG = {
    "parks": [
        {
            "resource_location_id": -100,
            "full_name": "Alice Lake Provincial Park",
            "root_map_id": -900,
            "timezone": "America/Vancouver",
        },
    ],
    "booking_categories": [
        {"booking_category_id": 0, "booking_model": 0, "name": "Campsite"},
    ],
}


def _catalog_adapter(tmp_path):
    path = tmp_path / "bc_parks.json"
    path.write_text(json.dumps(_CATALOG))

    class _WithCatalog(_StubCamisAdapter):
        catalog_path = path

    return _WithCatalog()


def test_available_code_is_zero():
    # Decoded empirically in HH-102 (BC Day weekend vs quiet September
    # weekday): 0 = available. HH-99 shipped 1, which is "booked" — inverted.
    assert BaseCamisAdapter.AVAILABILITY_AVAILABLE_CODE == 0


def test_classify_full_stay_site_available():
    # Two sites free every night, one booked → AVAILABLE, count = full-stay sites.
    r = _StubCamisAdapter()._classify_site_days(
        {"-1": [0, 0, 0], "-2": [0, 0, 0], "-3": [1, 1, 1]}, "Park"
    )
    assert r.status == AvailabilityStatus.AVAILABLE
    assert r.total_available == 2


def test_classify_no_single_site_covers_stay_is_partial():
    # Free nights exist but no one site covers the whole stay — a booking is
    # impossible, so this must NOT read as AVAILABLE.
    r = _StubCamisAdapter()._classify_site_days(
        {"-1": [0, 1], "-2": [1, 0]}, "Park"
    )
    assert r.status == AvailabilityStatus.PARTIALLY_AVAILABLE
    assert r.total_available == 0


@pytest.mark.parametrize("codes", [[1, 1], [3, 3], [1, 3], [2, 6]])
def test_classify_unavailable_site_codes(codes):
    # 1 (booked), 3 (non-reservable/filter mismatch), 2/6 (closed / not
    # released) — and any unknown code — are all "not bookable".
    r = _StubCamisAdapter()._classify_site_days({"-1": codes}, "Park")
    assert r.status == AvailabilityStatus.UNAVAILABLE
    assert r.total_available == 0


def test_classify_empty_is_unknown():
    r = _StubCamisAdapter()._classify_site_days({}, "Park")
    assert r.status == AvailabilityStatus.UNKNOWN


def test_extract_site_days_tolerates_shapes():
    data = {
        "resourceAvailabilities": {
            "-10": [{"availability": 0, "remainingQuota": None}, {"availability": 1}],
            "-11": [0, 1],          # bare ints
            "-12": [{"availability": None}],  # unreadable → never available
        }
    }
    out = BaseCamisAdapter._extract_site_days(data)
    assert out == {"-10": [0, 1], "-11": [0, 1], "-12": [-1]}


def test_build_query_resolves_map_id_and_category_from_catalog(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    query = adapter._build_availability_query(
        {"resource_location_id": -100, "date": "01/08/2026", "nights": 3}
    )
    assert query == {
        "resourceLocationId": -100,
        "mapId": -900,  # resolved from catalog root_map_id
        "bookingCategoryId": 0,  # resolved from catalog first booking category
        "startDate": "2026-08-01",
        "endDate": "2026-08-03",  # N nights inclusive → start + (N-1)
        "getDailyAvailability": "true",
    }


def test_build_query_explicit_values_win(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    query = adapter._build_availability_query(
        {
            "resource_location_id": -100,
            "map_id": -555,
            "booking_category_id": 4,
            "date": "15/09/2026",
            "nights": 1,
        }
    )
    assert query["mapId"] == -555
    assert query["bookingCategoryId"] == 4
    assert query["startDate"] == query["endDate"] == "2026-09-15"


def test_build_query_missing_fields_raise(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    with pytest.raises(ValueError):
        adapter._build_availability_query({"date": "01/08/2026"})  # no rl id
    with pytest.raises(ValueError):
        adapter._build_availability_query({"resource_location_id": -100})  # no date


def test_build_query_unresolvable_map_id_raises(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    # Resource location not in the catalog and no explicit map_id.
    with pytest.raises(ValueError):
        adapter._build_availability_query(
            {"resource_location_id": -999, "booking_category_id": 0, "date": "01/08/2026"}
        )


async def test_detect_availability_drills_open_loops(tmp_path):
    """Park query returns loop aggregates; open loops are drilled for sites."""
    adapter = _catalog_adapter(tmp_path)
    calls: list[int] = []

    async def fake_get(page, query):
        calls.append(query["mapId"])
        if query["mapId"] == -900:  # park root map (from catalog)
            return {"mapLinkAvailabilities": {"-901": [0, 0, 0], "-902": [1, 1, 1]}}
        assert query["mapId"] == -901  # only the open loop is drilled
        return {"resourceAvailabilities": {
            "-50": [{"availability": 0}, {"availability": 0}, {"availability": 0}],
            "-51": [{"availability": 1}, {"availability": 1}, {"availability": 1}],
        }}

    adapter._get_map_availability = fake_get  # type: ignore[method-assign]
    results = await adapter.detect_availability(
        None, {"resource_location_id": -100, "date": "01/08/2026", "nights": 3}
    )
    assert calls == [-900, -901]  # fully-booked loop -902 is never queried
    assert len(results) == 1
    assert results[0].site == "Alice Lake Provincial Park"  # name from catalog
    assert results[0].status == AvailabilityStatus.AVAILABLE
    assert results[0].total_available == 1  # only -50 covers the full stay


async def test_detect_availability_all_loops_booked_short_circuits(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    calls: list[int] = []

    async def fake_get(page, query):
        calls.append(query["mapId"])
        return {"mapLinkAvailabilities": {"-901": [1, 1], "-902": [2, 6]}}

    adapter._get_map_availability = fake_get  # type: ignore[method-assign]
    results = await adapter.detect_availability(
        None, {"resource_location_id": -100, "date": "01/08/2026", "nights": 2}
    )
    assert calls == [-900]  # no drilling — nothing open
    assert results[0].status == AvailabilityStatus.UNAVAILABLE


async def test_detect_availability_empty_response_is_unknown(tmp_path):
    adapter = _catalog_adapter(tmp_path)

    async def fake_get(page, query):
        return {"mapLinkAvailabilities": {}, "resourceAvailabilities": {}}

    adapter._get_map_availability = fake_get  # type: ignore[method-assign]
    results = await adapter.detect_availability(
        None, {"resource_location_id": -100, "date": "01/08/2026"}
    )
    assert results[0].status == AvailabilityStatus.UNKNOWN


async def test_detect_availability_bad_params_returns_unknown(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    results = await adapter.detect_availability(None, {"resource_location_id": -100})
    assert results[0].status == AvailabilityStatus.UNKNOWN


# ---------------------------------------------------------------------------
# HH-100 — login config + occupant fields + hold safety
# ---------------------------------------------------------------------------

def test_login_selectors_confirmed():
    # Confirmed by driving the live BC Parks login.
    assert BaseCamisAdapter._EMAIL_SELECTOR == "#email"
    assert BaseCamisAdapter._PASSWORD_SELECTOR == "#password"
    assert "#login-cookie-consent" in BaseCamisAdapter._CONSENT_SELECTORS
    assert BaseCamisAdapter.API_AUTH_LOGIN == "/api/auth/login"


def test_occupant_fields_permit_holder():
    fields = _StubCamisAdapter.occupant_fields()
    assert [f.key for f in fields] == ["permit_holder"]
    assert fields[0].required is True


def test_cart_hold_minutes_still_unset():
    # HH-100 could not observe a pre-payment timer; must NOT be silently set.
    assert _StubCamisAdapter().cart_hold_minutes is None


async def test_attempt_hold_bad_params_never_claims_hold(tmp_path):
    # Missing date → cannot build a query → must fail closed, not claim a hold.
    adapter = _catalog_adapter(tmp_path)
    result = await adapter.attempt_hold(None, {"resource_location_id": -100})
    assert result.held is False
    assert result.success is False
