"""Adapter for Ontario Parks reservations (reservations.ontarioparks.ca).

Second concrete Camis adapter (HH-104) — and the config-reuse benchmark: recon
(HH-96) found BC and Ontario ship the same Camis Angular app and API contract,
so after the HH-104 hoist this file is nothing but per-province values. The
catalog (``ontario_parks.json``, 129 parks) comes from the shared HH-101
scraper.

Ontario notes vs BC:
- Bilingual site (en-CA / fr-CA); we drive en-CA.
- Booking-category taxonomy differs (Roofed Accommodation, Quetico, Paddling,
  …) but "Campsite" is category 0 on both, so the shared default holds.
- ``cart_hold_minutes`` (15, measured live on BC in HH-103) is platform-level;
  re-confirm during the Ontario E2E (HH-105) along with the equipment option
  names the hold flow auto-selects ("1 Tent" on BC).
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.base_camis import BaseCamisAdapter


class CamisOntarioParksAdapter(BaseCamisAdapter):
    """Availability + hold adapter for Ontario Parks (Camis)."""

    adapter_id = "camis_ontario_parks"
    name = "Ontario Parks Camping"
    base_url = "https://reservations.ontarioparks.ca"
    culture = "en-CA"
    catalog_path = Path(__file__).with_name("ontario_parks.json")

    booking_timezone = "America/Toronto"
