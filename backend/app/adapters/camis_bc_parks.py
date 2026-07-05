"""Adapter for BC Parks camping reservations (camping.bcparks.ca).

First concrete Camis adapter (HH-102). All of the platform mechanics — JSON
availability reads, Queue-it handling, login, the cart/hold funnel — live in
``BaseCamisAdapter``; this class is the BC-specific configuration:

* ``base_url`` / ``culture`` / booking timezone
* the ``bc_parks.json`` catalog (produced by
  ``backend/scripts/scrape_camis_catalog.py``)
* the params schema (``param_fields``) built from that catalog, and the
  translation from the frontend's option strings back to the Camis IDs the
  base class queries with (``_resolve_params``)

Park selection follows the DOC-standard-hut convention: the select option
string embeds the ID so it stays self-describing at submit time, e.g.::

    "Bamberton Provincial Park (-2147483646)"

The map/booking-category IDs are resolved from the catalog by the base class
(``root_map_id`` per park, category name → id here).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.adapters.base import ParamField
from app.adapters.base_camis import BaseCamisAdapter, PEOPLE_OPTIONS


logger = logging.getLogger(__name__)


# Option strings embed the resource_location_id in a trailing "(id)" — parks
# are matched greedily so names containing parentheses still parse.
_PARK_OPTION_RE = re.compile(r"^(?P<name>.+)\s\((?P<rl_id>-?\d+)\)$")


def _format_park_option(park: dict) -> str:
    return f"{park['full_name']} ({park['resource_location_id']})"


def _parse_park_option(value: str) -> int | None:
    """Return the embedded resource_location_id, or None if unparseable."""
    m = _PARK_OPTION_RE.match(value.strip())
    return int(m.group("rl_id")) if m else None


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

    # ------------------------------------------------------------------
    # Param schema
    # ------------------------------------------------------------------

    @classmethod
    def param_fields(cls) -> list[ParamField]:
        catalog = cls._catalog()
        parks = sorted(
            catalog.get("parks") or [],
            key=lambda p: (p.get("full_name") or "").lower(),
        )
        park_options = [_format_park_option(p) for p in parks if p.get("full_name")]
        categories = catalog.get("booking_categories") or []
        category_options = [c["name"] for c in categories if c.get("name")]
        default_category = (
            "Campsite" if "Campsite" in category_options
            else (category_options[0] if category_options else "")
        )

        return [
            ParamField(
                key="park",
                label="Park",
                type="select",
                options=park_options,
                default=park_options[0] if park_options else "",
                required=True,
            ),
            ParamField(
                key="booking_category",
                label="Booking Type",
                type="select",
                options=category_options,
                default=default_category,
                required=True,
            ),
            ParamField(
                key="date",
                label="Start Date",
                type="date",
                required=True,
            ),
            ParamField(
                key="nights",
                label="Nights",
                type="number",
                default=1,
                min=1,
            ),
            ParamField(
                key="people",
                label="People",
                type="number",
                default=2,
                min=1,
                max=len(PEOPLE_OPTIONS),
            ),
        ]

    @classmethod
    def _catalog(cls) -> dict:
        """Class-level catalog read for ``param_fields`` (no instance needed)."""
        # _load_catalog is an instance method on the base for subclass
        # override symmetry; instantiate cheaply here.
        return cls()._load_catalog()

    # ------------------------------------------------------------------
    # Param resolution — frontend option strings → Camis IDs
    # ------------------------------------------------------------------

    def _resolve_params(self, params: dict) -> dict:
        """Return a copy of ``params`` with the Camis IDs filled in.

        The base class queries by ``resource_location_id`` /
        ``booking_category_id``; the frontend submits the human-readable
        ``park`` / ``booking_category`` option strings. Explicit IDs in the
        params always win (that's what tests and power users pass).
        """
        resolved = dict(params)

        if resolved.get("resource_location_id") is None and resolved.get("park"):
            rl_id = _parse_park_option(str(resolved["park"]))
            if rl_id is not None:
                resolved["resource_location_id"] = rl_id
            else:
                logger.warning(
                    "could not parse park option %r — expected 'Name (id)'",
                    resolved["park"],
                )

        if resolved.get("booking_category_id") is None and resolved.get("booking_category"):
            wanted = str(resolved["booking_category"]).strip().lower()
            for cat in self._load_catalog().get("booking_categories") or []:
                if (cat.get("name") or "").strip().lower() == wanted:
                    resolved["booking_category_id"] = cat.get("booking_category_id")
                    break

        return resolved

    # ------------------------------------------------------------------
    # BaseAdapter API — delegate to the shared Camis flows with resolved IDs
    # ------------------------------------------------------------------

    async def detect_availability(self, page, params):
        return await super().detect_availability(page, self._resolve_params(params))

    async def attempt_hold(self, page, params):
        return await super().attempt_hold(page, self._resolve_params(params))
