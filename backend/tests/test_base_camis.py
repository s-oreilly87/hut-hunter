"""Unit tests for BaseCamisAdapter (HH-98 scaffold + HH-99 availability).

Network- and browser-free: config hooks, URL building, catalog loading, date
helpers, plus the HH-99 availability query builder and status classifier. The
cart/hold flow lands in HH-100 and is tested there.
"""

from __future__ import annotations

import json
from datetime import date as date_cls, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.adapters.base import AvailabilityStatus, BaseAdapter, UnexpectedHoldFailure
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
    # Hold timing measured on live BC in HH-103 (~15.9 min → 15). Must NOT be
    # DOC's 25 min, and must no longer be the unmeasured None it was in HH-100.
    assert adapter.cart_hold_minutes == 15


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
    # Two sites free every night, one booked → AVAILABLE, count = full-stay
    # sites. Arrays include the checkout-day code (3 nights → 4 entries).
    r = _StubCamisAdapter()._classify_site_days(
        {"-1": [0, 0, 0, 1], "-2": [0, 0, 0, 0], "-3": [1, 1, 1, 0]}, "Park", 3
    )
    assert r.status == AvailabilityStatus.AVAILABLE
    assert r.total_available == 2


def test_classify_checkout_day_code_is_ignored():
    # A site free ONLY on the checkout day is not bookable for the stay.
    r = _StubCamisAdapter()._classify_site_days({"-1": [1, 1, 0]}, "Park", 2)
    assert r.status == AvailabilityStatus.UNAVAILABLE
    assert r.total_available == 0


def test_classify_no_single_site_covers_stay_is_partial():
    # Free nights exist but no one site covers the whole stay — a booking is
    # impossible, so this must NOT read as AVAILABLE.
    r = _StubCamisAdapter()._classify_site_days(
        {"-1": [0, 1, 1], "-2": [1, 0, 1]}, "Park", 2
    )
    assert r.status == AvailabilityStatus.PARTIALLY_AVAILABLE
    assert r.total_available == 0


@pytest.mark.parametrize("codes", [[1, 1], [3, 3], [1, 3], [2, 6]])
def test_classify_unavailable_site_codes(codes):
    # 1 (booked), 3 (non-reservable/filter mismatch), 2/6 (closed / not
    # released) — and any unknown code — are all "not bookable".
    r = _StubCamisAdapter()._classify_site_days({"-1": codes}, "Park", 2)
    assert r.status == AvailabilityStatus.UNAVAILABLE
    assert r.total_available == 0


def test_classify_empty_is_unknown():
    r = _StubCamisAdapter()._classify_site_days({}, "Park", 1)
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
        "endDate": "2026-08-04",  # checkout date = start + nights
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
    # 1 night: endDate is the CHECKOUT day — startDate == endDate is an
    # HTTP 400 on the live API (hit by the first 1-night watch job, HH-103).
    assert query["startDate"] == "2026-09-15"
    assert query["endDate"] == "2026-09-16"


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


async def test_attempt_hold_bad_params_never_claims_hold(tmp_path):
    # Missing date → cannot build a query → must fail closed, not claim a hold.
    adapter = _catalog_adapter(tmp_path)
    result = await adapter.attempt_hold(None, {"resource_location_id": -100})
    assert result.held is False
    assert result.success is False


async def test_attempt_hold_propagates_login_failure_instead_of_swallowing_it(tmp_path):
    """THR-126 (fixes THR-122 §2): attempt_hold used to catch RuntimeError
    from _login and return a clean BookingResult(held=False) — which is
    exactly why the noVNC takeover never fired for a stuck consent banner:
    attempt_hold swallowed the failure before hold_worker's takeover
    except-block ever saw it. Any exception _login raises (RuntimeError,
    UnexpectedHoldFailure, or anything else) must now propagate uncaught."""
    adapter = _catalog_adapter(tmp_path)

    async def fake_login(page):
        raise UnexpectedHoldFailure("Camis cookie-consent banner would not dismiss")

    adapter._login = fake_login  # type: ignore[method-assign]

    with pytest.raises(UnexpectedHoldFailure):
        await adapter.attempt_hold(
            None, {"resource_location_id": -100, "date": "01/08/2026", "nights": 1}
        )


async def test_attempt_hold_propagates_plain_runtime_error_from_login(tmp_path):
    # Even a "boring" RuntimeError (e.g. missing stored credentials) is no
    # longer caught here — attempt_hold's own callers (the hold worker skips
    # straight to a clean BookingResult before ever opening a browser when
    # credentials are missing/failed) are what's responsible for the clean
    # negative now, not a login exception this deep in the funnel.
    adapter = _catalog_adapter(tmp_path)

    async def fake_login(page):
        raise RuntimeError("Camis login required but no stored credentials are configured")

    adapter._login = fake_login  # type: ignore[method-assign]

    with pytest.raises(RuntimeError):
        await adapter.attempt_hold(
            None, {"resource_location_id": -100, "date": "01/08/2026", "nights": 1}
        )


# ---------------------------------------------------------------------------
# HH-103 — E2E hold hardening: honest cart-badge verification
# ---------------------------------------------------------------------------

class _FakePage:
    """Minimal Page stand-in exposing only evaluate() for the cart badge."""
    def __init__(self, badge_text: str):
        self._badge = badge_text

    async def evaluate(self, _script: str):
        return self._badge


@pytest.mark.parametrize("text,expected", [
    ("1 Item\nCart", 1),
    ("2 Items\nCart", 2),
    ("Cart", 0),        # no item → not held
    ("", 0),
    ("11 Items", 11),
])
async def test_cart_item_count_parses_badge(text, expected):
    # The cart badge is the source of truth for a held cart — HH-100's URL
    # substring check was the false-positive bug this replaces.
    assert await _StubCamisAdapter()._cart_item_count(_FakePage(text)) == expected


def test_default_equipment_matches_single_tent_wordings():
    # Camis blocks Reserve until equipment is chosen; the auto-default must hit
    # the single-tent option under both site wordings: "1 Tent" (BC, HH-103)
    # and "Single Tent" (Ontario, HH-105).
    assert _StubCamisAdapter._DEFAULT_EQUIPMENT_RE.search("1 Tent")
    assert _StubCamisAdapter._DEFAULT_EQUIPMENT_RE.search("Single Tent")
    assert not _StubCamisAdapter._DEFAULT_EQUIPMENT_RE.search("2 Tents")
    assert not _StubCamisAdapter._DEFAULT_EQUIPMENT_RE.search("Van/Camper")
    assert not _StubCamisAdapter._DEFAULT_EQUIPMENT_RE.search("Trailer or RV up to 18ft (5.5m)")


class _FakeButton:
    def __init__(self, visible: bool):
        self._visible = visible
        self.clicked = False

    async def is_visible(self):
        return self._visible

    async def click(self):
        self.clicked = True


class _FakeLocator:
    def __init__(self, button: _FakeButton | None):
        self._button = button

    async def count(self):
        return 1 if self._button else 0

    @property
    def first(self):
        return self._button


class _AlertPage:
    """Page stand-in whose only visible button matches ``visible_name`` (a
    substring) — models the Park Alerts modal's Acknowledge button."""
    def __init__(self, visible_name: str | None):
        self._name = visible_name
        self.wait_calls = 0

    def get_by_role(self, role, name=None):
        if role == "button" and self._name is not None and name.search(self._name):
            return _FakeLocator(_FakeButton(visible=True))
        return _FakeLocator(None)

    async def wait_for_timeout(self, _ms):
        self.wait_calls += 1


async def test_dismiss_park_alerts_clicks_acknowledge():
    # Ontario (HH-105): Algonquin gates the results page behind a Park Alerts
    # modal whose Acknowledge button must be clicked or the funnel stalls.
    page = _AlertPage("Acknowledge")
    assert await _StubCamisAdapter()._dismiss_park_alerts(page) is True


async def test_dismiss_park_alerts_noop_when_absent():
    # BC has no such modal — must be a silent no-op, not an error.
    page = _AlertPage(None)
    assert await _StubCamisAdapter()._dismiss_park_alerts(page) is False


# ---------------------------------------------------------------------------
# THR-122 — cookie-consent gate can render later than a fixed delay allows,
# blocking #email and timing out Locator.fill(). _accept_cookie_consent and
# _login_if_prompted must race consent-vs-#email instead of guessing a delay.
# ---------------------------------------------------------------------------

class _ConsentLocator:
    """Stand-in for a consent-button selector locator. ``visible_after``
    polls is when it starts reporting visible; ``None`` means it never
    appears.

    THR-126: ``dismiss_on_click`` models whether clicking this element
    actually dismisses the banner (the real "I consent" button) or not (the
    THR-122 §1 bug — clicking the banner's container instead of its button,
    which "succeeds" but leaves the banner up). Once dismissed, ``is_visible``
    reports False from then on, same as a real detached/hidden element.
    """

    def __init__(self, visible_after: int | None, dismiss_on_click: bool = True):
        self.visible_after = visible_after
        self.polls = 0
        self.clicked = 0
        self.dismiss_on_click = dismiss_on_click
        self.dismissed = False

    async def count(self):
        return 1 if self.visible_after is not None else 0

    async def is_visible(self):
        if self.dismissed:
            return False
        self.polls += 1
        if self.visible_after is None:
            return False
        return self.polls >= self.visible_after

    async def click(self):
        self.clicked += 1
        if self.dismiss_on_click:
            self.dismissed = True

    @property
    def first(self):
        return self


class _EmailLocator:
    """Stand-in for ``page.locator("#email")``. ``visible_after`` is the poll
    count at which ``is_visible()`` flips true; becomes true immediately once
    ``unblocked`` is set (simulates the consent click un-covering the form)."""

    def __init__(self, visible_after: int | None = None):
        self.visible_after = visible_after
        self.polls = 0
        self.unblocked = False
        self.wait_for_calls = 0

    async def is_visible(self):
        self.polls += 1
        if self.unblocked:
            return True
        if self.visible_after is None:
            return False
        return self.polls >= self.visible_after

    async def wait_for(self, state="visible", timeout=None):
        self.wait_for_calls += 1
        if self.unblocked or self.visible_after is not None:
            return
        raise __import__("playwright.async_api", fromlist=["TimeoutError"]).TimeoutError("timeout")


class _ConsentRacePage:
    """Page stand-in for the consent/#email race. Only implements what
    ``_accept_cookie_consent`` / ``_login_if_prompted`` touch."""

    def __init__(self, consent: _ConsentLocator, email: _EmailLocator):
        self._consent = consent
        self._email = email
        self.snapshots: list[str] = []

    def locator(self, selector):
        if selector == BaseCamisAdapter._EMAIL_SELECTOR:
            return self._email
        return self._consent

    async def wait_for_timeout(self, _ms):
        pass


async def test_accept_cookie_consent_returns_immediately_if_email_already_visible():
    # No banner at all — should not click anything, should not raise.
    consent = _ConsentLocator(visible_after=None)
    email = _EmailLocator(visible_after=1)
    page = _ConsentRacePage(consent, email)
    adapter = _StubCamisAdapter()
    await adapter._accept_cookie_consent(page, timeout_ms=2_000)
    assert consent.clicked == 0


async def test_accept_cookie_consent_waits_past_old_fixed_delay():
    # Regression for THR-122: banner renders "late" — well past what the old
    # fixed 1.5s delay would have covered (modelled here as needing several
    # polls before it's visible). The bounded race must still catch it.
    consent = _ConsentLocator(visible_after=8)
    email = _EmailLocator(visible_after=None)

    async def unblock_after_click():
        email.unblocked = True

    class _Page(_ConsentRacePage):
        pass

    page = _Page(consent, email)
    orig_click = consent.click

    async def click_and_unblock():
        await orig_click()
        await unblock_after_click()

    consent.click = click_and_unblock  # type: ignore[method-assign]

    adapter = _StubCamisAdapter()
    await adapter._accept_cookie_consent(page, timeout_ms=5_000)
    assert consent.clicked >= 1
    assert email.unblocked is True


async def test_accept_cookie_consent_raises_and_snapshots_when_nothing_appears():
    # Neither the consent button nor #email ever shows up (e.g. a changed
    # selector) — must fail loudly with a snapshot, not silently return.
    consent = _ConsentLocator(visible_after=None)
    email = _EmailLocator(visible_after=None)
    page = _ConsentRacePage(consent, email)
    adapter = _StubCamisAdapter()

    snapshots = []

    async def fake_snapshot(_page, label):
        snapshots.append(label)
        return f"artifacts/{label}"

    adapter.snapshot = fake_snapshot  # type: ignore[method-assign]

    # THR-126: this is now an UnexpectedHoldFailure (parks for takeover),
    # not a plain RuntimeError (which attempt_hold used to catch and report
    # as a clean Hold Failed — the THR-122 §2 bug this ticket fixes).
    with pytest.raises(UnexpectedHoldFailure, match="did not become visible"):
        await adapter._accept_cookie_consent(page, timeout_ms=500)
    assert snapshots == ["camis_consent_blocked"]


async def test_accept_cookie_consent_raises_when_click_does_not_dismiss_banner():
    """THR-126 (fixes THR-122 §1 — the actual production bug): clicking the
    consent element "succeeds" (no exception) but the banner never actually
    goes away — e.g. the click landed on the container, not the real button.
    The old code treated a non-raising click as proof of dismissal and then
    timed out on #email with a misleading error; the fix must detect the
    banner is still up and fail loudly instead."""
    consent = _ConsentLocator(visible_after=1, dismiss_on_click=False)
    email = _EmailLocator(visible_after=None)
    page = _ConsentRacePage(consent, email)
    adapter = _StubCamisAdapter()

    snapshots = []

    async def fake_snapshot(_page, label):
        snapshots.append(label)
        return f"artifacts/{label}"

    adapter.snapshot = fake_snapshot  # type: ignore[method-assign]

    with pytest.raises(UnexpectedHoldFailure, match="would not dismiss"):
        await adapter._accept_cookie_consent(page, timeout_ms=3_000)
    # Clicked repeatedly (retries), never gave up after just one attempt.
    assert consent.clicked >= 2
    assert snapshots == ["camis_consent_blocked"]


async def test_login_if_prompted_detects_consent_banner_not_just_email():
    # Before THR-122 this waited on #email directly and would time out while
    # a banner sat on top of it. Now the consent banner itself should be
    # enough to recognize "the login form is present" and trigger _login.
    consent = _ConsentLocator(visible_after=1)
    email = _EmailLocator(visible_after=None)
    page = _ConsentRacePage(consent, email)
    adapter = _StubCamisAdapter()

    called = {}

    async def fake_login(_page):
        called["yes"] = True

    adapter._login = fake_login  # type: ignore[method-assign]

    result = await adapter._login_if_prompted(page, timeout_ms=2_000)
    assert result is True
    assert called.get("yes") is True


async def test_login_if_prompted_false_when_nothing_present():
    consent = _ConsentLocator(visible_after=None)
    email = _EmailLocator(visible_after=None)
    page = _ConsentRacePage(consent, email)
    adapter = _StubCamisAdapter()

    called = {}

    async def fake_login(_page):
        called["yes"] = True

    adapter._login = fake_login  # type: ignore[method-assign]

    result = await adapter._login_if_prompted(page, timeout_ms=500)
    assert result is False


# ---------------------------------------------------------------------------
# THR-124 — booking-window gating (check_booking_window / _parse_booking_window)
# ---------------------------------------------------------------------------

def test_has_booking_windows_true_for_camis():
    assert BaseCamisAdapter.has_booking_windows is True
    assert BaseAdapter.has_booking_windows is False


async def test_base_adapter_default_always_open():
    class _Plain(BaseAdapter):
        adapter_id = "plain"
        name = "Plain"
        base_url = "https://example.test"

        @classmethod
        def param_fields(cls):
            return []

        async def fill_form(self, page, params):
            return None

        async def detect_availability(self, page, params):
            return []

    window = await _Plain().check_booking_window({"date": "01/01/2099"})
    assert window.is_open is True
    assert window.opens_at is None


def test_parse_booking_window_date_within_reservable_range():
    data = {"schedules": [{"startDate": "2026-06-01", "endDate": "2026-09-30"}]}
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 7, 15), None)
    assert window.is_open is True


def test_parse_booking_window_go_live_field_is_precise():
    # Target date (2027-07-15) is NOT covered by the reservable range
    # (2027-09-01..2027-09-30 — a different season than requested), so this
    # exercises the not-yet-released branch with a confirmed go-live field.
    data = [{
        "startDate": "2027-09-01", "endDate": "2027-09-30",
        "goLiveDate": "2026-08-01T07:00:00",
    }]
    tz = ZoneInfo("America/Vancouver")
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2027, 7, 15), tz)
    assert window.is_open is False
    assert window.opens_at_precise is True
    # 07:00 America/Vancouver in August (PDT, UTC-7) == 14:00 UTC.
    assert window.opens_at == datetime(2026, 8, 1, 14, 0, tzinfo=timezone.utc)


def test_parse_booking_window_fails_open_when_no_go_live_published():
    # Confirmed live (recon 2026-07-07): a future not-yet-released season
    # commonly has no go-live date published yet, and there's no reliable
    # relationship between a season's start date and its actual go-live time
    # to fall back on (see the module comment on BaseCamisAdapter) — BC
    # go-lives ranged from ~11 months before to months after the season
    # start, Ontario's is typically the start date itself. Guessing "opens on
    # the range start" risks parking a job (polling fully off) until a wildly
    # wrong date, so this must fail open instead.
    data = {"seasons": [{"reservableStartDate": "2026-08-01", "reservableEndDate": "2026-09-30"}]}
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 7, 1), None)
    assert window.is_open is True
    assert "no confirmed go-live date" in window.evidence


def test_parse_booking_window_matches_confirmed_live_schema():
    # Real /api/dateschedule/resourcelocationid shape (BC + Ontario Parks,
    # confirmed live 2026-07-07): a dict keyed by scheduleId, each holding a
    # `reservableDates` list of per-season dicts with a same-named nested
    # `reservableDates: {start, end}` plus goLiveDate/goLiveDateUtc.
    data = {
        "-2147483298": {
            "displayOnline": False,
            "reservableDates": [],
            "operatingDates": [
                {"start": "2022-01-01T05:00:00Z", "end": "9999-12-31T05:00:00Z"},
            ],
        },
        "-2147483631": {
            "displayOnline": True,
            "reservableDates": [
                {
                    "reservableDates": {
                        "start": "2026-05-13T07:00:00Z", "end": "2026-09-29T07:00:00Z",
                    },
                    "goLiveDate": None, "goLiveDateUtc": None,
                    "goLiveTimeZone": "Pacific Standard Time",
                },
                {
                    "reservableDates": {
                        "start": "2027-05-21T07:00:00Z", "end": "2027-09-06T07:00:00Z",
                    },
                    "goLiveDate": None, "goLiveDateUtc": None,
                    "goLiveTimeZone": "Pacific Standard Time",
                },
            ],
        },
    }
    # Inside the 2026 season -> open. The displayOnline=False schedule (empty
    # reservableDates) and the unrelated operatingDates range must not
    # interfere.
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 7, 7), None)
    assert window.is_open is True

    # Falls in the gap between the 2026 season's end (2026-09-29) and the
    # 2027 season's start (2027-05-21); neither has a published go-live date
    # yet -> fails open rather than guessing off the 2027 range's start date.
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2027, 1, 15), None)
    assert window.is_open is True
    assert "no confirmed go-live date" in window.evidence


def test_parse_booking_window_confirmed_live_schema_with_go_live():
    # goLiveDateUtc (already UTC) takes precedence and needs no localization.
    data = {
        "-2147483365": {
            "displayOnline": True,
            "reservableDates": [
                {
                    "reservableDates": {
                        "start": "2023-05-19T07:00:00Z", "end": "2023-09-03T07:00:00Z",
                    },
                    "goLiveDate": "2022-06-28T07:00:00",
                    "goLiveDateUtc": "2022-06-28T14:00:00Z",
                    "goLiveTimeZone": "Pacific Standard Time",
                },
            ],
        },
    }
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2023, 1, 15), None)
    assert window.is_open is False
    assert window.opens_at_precise is True
    assert window.opens_at == datetime(2022, 6, 28, 14, 0, tzinfo=timezone.utc)


def test_parse_booking_window_picks_earliest_candidate_across_entries():
    data = [
        {"startDate": "2026-09-01", "endDate": "2026-09-30", "goLiveDate": "2026-05-01"},
        {"startDate": "2026-07-01", "endDate": "2026-07-31", "goLiveDate": "2026-03-01"},
    ]
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 6, 1), None)
    assert window.is_open is False
    assert window.opens_at == datetime(2026, 3, 1, tzinfo=timezone.utc)


@pytest.mark.parametrize("data", [
    None, {}, [], {"schedules": []}, {"somethingElse": "abc"}, "unexpected string",
])
def test_parse_booking_window_fails_open_on_unrecognized_shape(data):
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 7, 15), None)
    assert window.is_open is True


def test_parse_booking_window_fails_open_when_no_dates_parseable():
    # Entries present, but no field this parser recognizes at all.
    data = [{"somethingElse": "abc"}]
    window = BaseCamisAdapter._parse_booking_window(data, date_cls(2026, 7, 15), None)
    assert window.is_open is True


async def test_check_booking_window_missing_params_fails_open(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    window = await adapter.check_booking_window({})
    assert window.is_open is True
    assert "missing" in window.evidence


async def test_check_booking_window_queries_dateschedule_and_parses(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    seen_calls = []

    async def fake_fetch_json(path, params=None, **kwargs):
        seen_calls.append((path, params))
        return {
            "schedules": [{
                "startDate": "2026-08-01", "endDate": "2026-08-31",
                "goLiveDateUtc": "2026-06-01T14:00:00Z",
            }],
        }

    adapter.fetch_json = fake_fetch_json  # type: ignore[method-assign]

    window = await adapter.check_booking_window(
        {"resource_location_id": -100, "date": "01/07/2026"}
    )
    assert window.is_open is False
    assert seen_calls[0][0] == BaseCamisAdapter.API_DATE_SCHEDULE
    assert seen_calls[0][1]["resourceLocationId"] == -100
    # Category resolved from the catalog's first booking category when not
    # given explicitly (mirrors _build_availability_query's fallback).
    assert seen_calls[0][1]["bookingCategoryId"] == 0


async def test_check_booking_window_network_error_fails_open(tmp_path):
    adapter = _catalog_adapter(tmp_path)

    async def fake_fetch_json(path, params=None, **kwargs):
        raise RuntimeError("connection reset")

    adapter.fetch_json = fake_fetch_json  # type: ignore[method-assign]

    window = await adapter.check_booking_window(
        {"resource_location_id": -100, "date": "01/07/2026"}
    )
    assert window.is_open is True
    assert "dateschedule lookup failed" in window.evidence


async def test_check_booking_window_unparseable_date_fails_open(tmp_path):
    adapter = _catalog_adapter(tmp_path)
    window = await adapter.check_booking_window(
        {"resource_location_id": -100, "date": "not-a-date"}
    )
    assert window.is_open is True


# ---------------------------------------------------------------------------
# THR-126 — rolling advance-booking window (fixes THR-124's "no go-live
# published yet" gap: BC/Ontario's PRIMARY release mechanic is a rolling
# per-arrival-date window that dateschedule go-live dates don't encode).
# ---------------------------------------------------------------------------

def test_subtract_months_handles_year_rollover_and_day_clamping():
    # Ordinary case, crossing a year boundary.
    assert BaseCamisAdapter._subtract_months(date_cls(2027, 1, 15), 3) == date_cls(2026, 10, 15)
    # Day clamped to the shorter target month (no Feb 31).
    assert BaseCamisAdapter._subtract_months(date_cls(2026, 5, 31), 3) == date_cls(2026, 2, 28)
    # Zero months is a no-op.
    assert BaseCamisAdapter._subtract_months(date_cls(2026, 7, 7), 0) == date_cls(2026, 7, 7)


def test_parse_booking_window_uses_rolling_window_when_no_go_live_published():
    # The exact production repro: a next-summer BC hunt with no goLiveDate
    # published for a season that far out — only last year's (closed) season
    # is on file. Before THR-126 this failed open (is_open=True) — the
    # feature could never engage for the common case. advance_booking_months
    # now computes an arm time directly instead.
    data = {"seasons": [{"reservableStartDate": "2026-05-01", "reservableEndDate": "2026-09-30",
                          "goLiveDate": None, "goLiveDateUtc": None}]}
    tz = ZoneInfo("America/Vancouver")
    window = BaseCamisAdapter._parse_booking_window(
        data, date_cls(2027, 7, 20), tz, advance_booking_months=3,
    )
    assert window.is_open is False
    # 3 months before 2027-07-20 is 2027-04-20, 7am Pacific (PDT, UTC-7) ->
    # 14:00 UTC.
    assert window.opens_at == datetime(2027, 4, 20, 14, 0, tzinfo=timezone.utc)
    assert window.opens_at_precise is True


def test_parse_booking_window_rolling_and_confirmed_go_live_take_the_earlier():
    # A confirmed go-live for the relevant season that's EARLIER than the
    # computed rolling date wins (an early/fixed-date release overriding the
    # usual cadence) — earliest-wins is the safe default (arming early costs
    # nothing; arming late risks missing the window). Only last year's season
    # is on file, so the range itself doesn't cover the target date.
    data = [{
        "startDate": "2026-05-01", "endDate": "2026-09-30",
        "goLiveDateUtc": "2027-03-01T14:00:00Z",
    }]
    window = BaseCamisAdapter._parse_booking_window(
        data, date_cls(2027, 7, 20), None, advance_booking_months=3,
    )
    assert window.is_open is False
    assert window.opens_at == datetime(2027, 3, 1, 14, 0, tzinfo=timezone.utc)


def test_entry_for_target_date_picks_nearest_range_not_global_min_go_live():
    # THR-126 regression: the OLD code took min() of every entry's go-live
    # regardless of season — an unrelated, long-past season with an early
    # go-live could win even though its range has nothing to do with the
    # requested date. Two entries: one whose range is right next to the
    # target date (later go-live), one whose range is far away (earlier
    # go-live, but irrelevant to this booking).
    near_entry = {"startDate": "2026-09-01", "endDate": "2026-09-30", "goLiveDate": "2026-06-01"}
    far_entry = {"startDate": "2023-01-01", "endDate": "2023-01-31", "goLiveDate": "2022-10-01"}
    entries = [far_entry, near_entry]
    picked = BaseCamisAdapter._entry_for_target_date(entries, date_cls(2026, 8, 15))
    assert picked is near_entry

    window = BaseCamisAdapter._parse_booking_window(
        [near_entry, far_entry], date_cls(2026, 8, 15), None,
    )
    assert window.is_open is False
    # Must be the NEAR entry's go-live, not the far one's earlier date.
    assert window.opens_at == datetime(2026, 6, 1, tzinfo=timezone.utc)


async def test_check_booking_window_falls_back_to_rolling_window(tmp_path):
    # An adapter with advance_booking_months configured still computes a real
    # arm time even when dateschedule returns nothing usable at all (an empty
    # response) — the rolling window doesn't depend on dateschedule at all,
    # so a broken/empty lookup must not force a fail-open here.
    adapter = _catalog_adapter(tmp_path)
    adapter.advance_booking_months = 3
    adapter.booking_timezone = "America/Vancouver"

    async def fake_fetch_json(path, params=None, **kwargs):
        return {}

    adapter.fetch_json = fake_fetch_json  # type: ignore[method-assign]

    window = await adapter.check_booking_window(
        {"resource_location_id": -100, "date": "20/07/2027"}
    )
    assert window.is_open is False
    assert window.opens_at == datetime(2027, 4, 20, 14, 0, tzinfo=timezone.utc)


def test_bc_and_ontario_advance_booking_months_configured():
    from app.adapters.camis_bc_parks import CamisBcParksAdapter
    from app.adapters.camis_ontario_parks import CamisOntarioParksAdapter

    assert CamisBcParksAdapter.advance_booking_months == 3
    assert CamisOntarioParksAdapter.advance_booking_months == 5
    # Parks Canada's cadence isn't confirmed — must NOT silently invent one.
    from app.adapters.camis_parks_canada import CamisParksCanadaAdapter
    assert CamisParksCanadaAdapter.advance_booking_months is None


async def test_detect_availability_short_circuits_outside_booking_window(tmp_path):
    """THR-126 (fixes THR-124 §4b): a beyond-window date must never read as
    AVAILABLE even if the raw availability/map codes say so (recon confirmed
    unreleased dates can return site-level code 0)."""
    adapter = _catalog_adapter(tmp_path)

    from app.adapters.base import BookingWindowInfo

    async def fake_check_window(params):
        return BookingWindowInfo(is_open=False, opens_at=None, evidence="not yet released")

    adapter.check_booking_window = fake_check_window  # type: ignore[method-assign]

    async def fake_get(page, query):
        # Even though the API says "available", the window gate must win.
        return {"resourceAvailabilities": {"-50": [{"availability": 0}]}}

    adapter._get_map_availability = fake_get  # type: ignore[method-assign]

    results = await adapter.detect_availability(
        None, {"resource_location_id": -100, "date": "01/08/2027", "nights": 1}
    )
    assert len(results) == 1
    assert results[0].status == AvailabilityStatus.UNAVAILABLE
    assert "outside the booking window" in results[0].evidence


async def test_detect_availability_proceeds_when_window_open(tmp_path):
    # A window check that fails/errors must never block an otherwise-normal
    # detect — check_booking_window's own fail-open contract still applies.
    adapter = _catalog_adapter(tmp_path)

    async def fake_check_window(params):
        raise RuntimeError("boom")

    adapter.check_booking_window = fake_check_window  # type: ignore[method-assign]

    async def fake_get(page, query):
        return {"resourceAvailabilities": {"-50": [{"availability": 0}]}}

    adapter._get_map_availability = fake_get  # type: ignore[method-assign]

    results = await adapter.detect_availability(
        None, {"resource_location_id": -100, "date": "01/08/2026", "nights": 1}
    )
    assert results[0].status == AvailabilityStatus.AVAILABLE
