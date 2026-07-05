"""Unit tests for the Camis catalog scraper transforms (HH-101).

Network-free: they exercise the pure normalization/assembly functions against
fixtures shaped like real ``/api/resourcelocation`` and ``/api/bookingcategories``
responses. The HTTP fetch is not tested here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.scrape_camis_catalog import (
    _pick_localized,
    build_catalog,
    normalize_booking_categories,
    normalize_parks,
)


RESOURCE_LOCATIONS = [
    {
        "resourceLocationId": -100,
        "ianaTimeZone": "America/Vancouver",
        "region": None,
        "transactionLocationId": 5,
        "resourceCategoryIds": [-2147483648],
        "localizedValues": [
            {"cultureName": "en-CA", "shortName": "Bamberton", "fullName": "Bamberton Provincial Park"},
        ],
    },
    {
        # Bilingual (Ontario-style) — en-CA name should win for culture en-CA.
        "resourceLocationId": -200,
        "ianaTimeZone": "America/Toronto",
        "region": "Ontario",
        "transactionLocationId": 6,
        "resourceCategoryIds": [],
        "localizedValues": [
            {"cultureName": "en-CA", "shortName": "Aaron", "fullName": "Aaron Provincial Park"},
            {"cultureName": "fr-CA", "shortName": "Aaron", "fullName": "Parc Provincial Aaron"},
        ],
    },
    {
        # Nameless system row — must be dropped.
        "resourceLocationId": -300,
        "ianaTimeZone": "America/Los_Angeles",
        "localizedValues": [{"cultureName": "en-CA", "shortName": None, "fullName": None}],
    },
    {
        # Duplicate id of the first — de-duped, last wins.
        "resourceLocationId": -100,
        "ianaTimeZone": "America/Vancouver",
        "localizedValues": [
            {"cultureName": "en-CA", "shortName": "Bamberton", "fullName": "Bamberton Provincial Park"},
        ],
    },
]

BOOKING_CATEGORIES = [
    {"bookingCategoryId": 2, "bookingModel": 0, "localizedValues": [{"cultureName": "en-CA", "name": "Cabin"}]},
    {"bookingCategoryId": 0, "bookingModel": 0, "localizedValues": [{"cultureName": "en-CA", "name": "Campsite"}]},
    {"bookingCategoryId": None},  # malformed — skipped
]


def test_pick_localized_prefers_exact_culture():
    values = [
        {"cultureName": "fr-CA", "fullName": "Parc Provincial Aaron"},
        {"cultureName": "en-CA", "fullName": "Aaron Provincial Park"},
    ]
    assert _pick_localized(values, "en-CA", "fullName") == "Aaron Provincial Park"
    assert _pick_localized(values, "fr-CA", "fullName") == "Parc Provincial Aaron"


def test_pick_localized_falls_back_to_language_then_first():
    values = [{"cultureName": "en-US", "fullName": "Only English"}]
    # No en-CA, but en-* matches the language prefix.
    assert _pick_localized(values, "en-CA", "fullName") == "Only English"
    # Unknown language → first entry.
    assert _pick_localized(values, "de-DE", "fullName") == "Only English"
    assert _pick_localized([], "en-CA", "fullName") is None


def test_normalize_parks_filters_dedups_and_sorts():
    parks = normalize_parks(RESOURCE_LOCATIONS, "en-CA")
    # Nameless row dropped; duplicate id collapsed → 2 parks.
    assert [p["full_name"] for p in parks] == [
        "Aaron Provincial Park",
        "Bamberton Provincial Park",
    ]
    aaron = parks[0]
    assert aaron["resource_location_id"] == -200
    assert aaron["short_name"] == "Aaron"
    assert aaron["region"] == "Ontario"
    assert aaron["timezone"] == "America/Toronto"
    assert aaron["transaction_location_id"] == 6
    assert aaron["resource_category_ids"] == []


def test_normalize_parks_bilingual_culture_selection():
    parks_fr = normalize_parks(RESOURCE_LOCATIONS, "fr-CA")
    aaron = next(p for p in parks_fr if p["resource_location_id"] == -200)
    assert aaron["full_name"] == "Parc Provincial Aaron"


def test_normalize_booking_categories():
    cats = normalize_booking_categories(BOOKING_CATEGORIES, "en-CA")
    assert cats == [
        {"booking_category_id": 0, "booking_model": 0, "name": "Campsite"},
        {"booking_category_id": 2, "booking_model": 0, "name": "Cabin"},
    ]


def test_build_catalog_shape():
    now = datetime(2026, 7, 5, 19, 30, 0, tzinfo=timezone.utc)
    catalog = build_catalog(
        "https://camping.bcparks.ca/",
        RESOURCE_LOCATIONS,
        BOOKING_CATEGORIES,
        "en-CA",
        now=now,
    )
    assert catalog["scraped_at"] == "2026-07-05T19:30:00Z"
    assert catalog["source"] == "camping.bcparks.ca"
    assert catalog["base_url"] == "https://camping.bcparks.ca"  # trailing slash stripped
    assert catalog["culture"] == "en-CA"
    assert len(catalog["parks"]) == 2
    assert len(catalog["booking_categories"]) == 2


_ADAPTERS_DIR = Path(__file__).resolve().parents[1] / "app" / "adapters"


@pytest.mark.parametrize("filename", ["bc_parks.json", "ontario_parks.json"])
def test_committed_catalog_is_wellformed(filename):
    """The catalogs the scraper produced and we committed must stay consumable."""
    catalog = json.loads((_ADAPTERS_DIR / filename).read_text())
    assert catalog["parks"], "catalog has no parks"
    assert catalog["booking_categories"], "catalog has no booking categories"
    for park in catalog["parks"]:
        assert isinstance(park["resource_location_id"], int)
        assert park["full_name"]
    # Sorted by full name (case-insensitive), as normalize_parks guarantees.
    names = [p["full_name"].lower() for p in catalog["parks"]]
    assert names == sorted(names)
