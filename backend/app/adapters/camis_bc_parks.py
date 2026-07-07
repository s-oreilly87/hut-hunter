"""Adapter for BC Parks camping reservations (camping.bcparks.ca).

First concrete Camis adapter (HH-102). Pure configuration since HH-104: all
mechanics — the catalog-driven params schema, option-string → ID resolution,
JSON availability reads, Queue-it handling, login, and the cart/hold funnel —
live in ``BaseCamisAdapter``. A new Camis province is this file with different
values (the HH-104 Ontario adapter is the proof).
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.base_camis import BaseCamisAdapter


class CamisBcParksAdapter(BaseCamisAdapter):
    """Availability + hold adapter for BC Parks (Camis)."""

    adapter_id = "camis_bc_parks"
    name = "BC Parks Camping"
    base_url = "https://camping.bcparks.ca"
    culture = "en-CA"
    catalog_path = Path(__file__).with_name("bc_parks.json")

    # BC Parks is Pacific time. (The Camis API reports parks as
    # "America/Los_Angeles" — same zone rules; use the Canadian IANA name.)
    booking_timezone = "America/Vancouver"

    # THR-126: BC frontcountry sites open on a rolling window exactly 3
    # months before arrival (confirmed against the live "Golden Ears" hunt
    # failure — dateschedule had no go-live published for a season that far
    # out, so gating on go-live alone never engaged). window_open_local_time
    # keeps the base class's 7am default (ticket text: "7am PT").
    advance_booking_months = 3
