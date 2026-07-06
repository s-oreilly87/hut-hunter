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
- Availability decode / drilling verified live (Banff). The interactive hold
  funnel has NOT been driven here (needs a Parks Canada account) — watch +
  notify are fully supported; treat auto-book as unproven on this site.
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.base_camis import BaseCamisAdapter


class CamisParksCanadaAdapter(BaseCamisAdapter):
    """Availability (+ unproven hold) adapter for Parks Canada (Camis)."""

    adapter_id = "camis_parks_canada"
    name = "Parks Canada Camping"
    base_url = "https://reservation.pc.gc.ca"
    culture = "en-CA"
    catalog_path = Path(__file__).with_name("parks_canada.json")

    # Westernmost of the 7 zones Parks Canada spans — see module docstring.
    booking_timezone = "America/Vancouver"
