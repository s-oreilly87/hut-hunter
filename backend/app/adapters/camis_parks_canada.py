"""Adapter for Parks Canada reservations (reservation.pc.gc.ca).

Third Camis instance, built as the HH-108 config-only reuse spike — the first
validation target for the Agentic Adapter Builder pipeline. Like BC/Ontario,
this is pure configuration over ``BaseCamisAdapter``; the catalog
(``parks_canada.json``, 114 locations) comes from the shared HH-101 scraper.

Spike notes (full detail in the Adapter Build Log):
- ``/api/resourcelocation`` + ``/api/bookingcategories`` answered
  unauthenticated, same shapes as BC/Ontario; "Campsite" is category 0 here
  too, so the shared default holds.
- **Timezones:** Parks Canada spans 7 zones (St. John's → Vancouver). The
  catalog records each park's own ``timezone``; ``booking_timezone`` below is
  the westernmost so ``is_expired`` never retires a job before its park-local
  cutoff anywhere in the country. Per-park expiry resolution from the catalog
  is the proper future refinement.
- **No automated booking (HH-118):** reservation.pc.gc.ca has no native
  credentials — sign-in is Google / Facebook / GCKey-Interac SSO only, which
  Playwright cannot drive (and IdP passwords are never stored). So
  ``supports_automated_booking = False`` (watch/notify only; the availability
  API is unauthenticated) and ``requires_credentials = False`` (no usable
  credential to save). Session-linking via noVNC SSO capture is the planned
  path to enabling booking here (THR-119 — Camis sessions verified to survive
  transfer into a fresh browser, unlike DOC's).
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.base_camis import BaseCamisAdapter


class CamisParksCanadaAdapter(BaseCamisAdapter):
    """Watch/notify-only adapter for Parks Canada (Camis) — see module note."""

    adapter_id = "camis_parks_canada"
    name = "Parks Canada Camping"
    base_url = "https://reservation.pc.gc.ca"
    culture = "en-CA"
    catalog_path = Path(__file__).with_name("parks_canada.json")

    # IdP-only sign-in (Google/Facebook/GCKey) — no automated booking and no
    # storable credentials until session-linking ships (THR-118/119).
    supports_automated_booking = False
    requires_credentials = False

    # Westernmost of the 7 zones Parks Canada spans — see module docstring.
    booking_timezone = "America/Vancouver"

    # THR-132: the equipment filter (equipmentCategoryId/subEquipmentCategoryId
    # + isReserving/filterData/numEquipment) is now sent by every Camis adapter
    # from the shared base defaults (all three sites share the enum — see
    # base_camis.py), so the Parks-Canada-specific equipment overrides that
    # THR-129 added here are gone. The party-size capacity filter
    # (peopleCapacityCategoryCounts), by contrast, was only ever confirmed live
    # against reservation.pc.gc.ca (2026-07-07), so it stays opt-in here via
    # DEFAULT_CAPACITY_CATEGORY_ID (base default None → BC/Ontario send none).
    DEFAULT_CAPACITY_CATEGORY_ID = -32767

    # THR-131: the "Parks Canada Accommodation" booking category (id 1 — the
    # huts: oTENTiks, cabins, yurts) rides the same /api/availability/map
    # endpoint, map tree, and per-site code shape as Campsite (bookingModel 0,
    # capacityCategoryId -32767, both confirmed live), so detection is pure
    # config over the shared BaseCamisAdapter path. The one required
    # difference: it takes no equipment (tent) filter — sending the
    # frontcountry equipment ids is meaningless for a unit-type booking — so
    # category 1 is exempted from the equipment extras while still receiving
    # the party-size capacity filter. See docs/adapters/camis-recon.md §8.
    _NON_EQUIPMENT_BOOKING_CATEGORY_IDS = frozenset({1})
