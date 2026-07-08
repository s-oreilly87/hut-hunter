"""Shared Camis booking logic for the Canadian provincial-park adapters.

``BaseCamisAdapter`` sits between ``BaseAdapter`` and the concrete per-province
adapters (``camis_bc_parks.CamisBcParksAdapter``,
``camis_ontario_parks.CamisOntarioParksAdapter``), exactly as
``BaseDOCAdapter`` sits under the two DOC adapters.

Unlike the DOC sites — server-rendered ASP.NET pages that are scraped straight
from the DOM — the Camis sites (BC Parks, Ontario Parks) are a single Angular
app talking to a JSON ``/api/*`` backend. Recon (docs/adapters/camis-recon.md)
confirmed that BC and Ontario ship the **same app and the same API contract**;
they differ only in base URL, catalog data, and localization. So the split is:

- **this base class** owns the API endpoint set, the JSON fetch path, catalog
  loading, Queue-it / login plumbing, date helpers, and cart-session
  persistence — everything platform-wide.
- **each subclass** sets ``base_url``, ``catalog_path``, ``culture``, and the
  booking timezone/cutoff, and implements the ``BaseAdapter`` abstract methods
  by calling the shared helpers here.

This file is the HH-98 scaffold. It provides the config hooks and the plumbing
helpers that are verifiable today (the ``/api/*`` catalog endpoints answer
unauthenticated — see recon §2). The browser-driven search, availability, and
cart/hold flows are deferred to their own milestones and are marked below:

- ``fill_form`` / ``detect_availability`` search + availability → **HH-99**
- ``attempt_hold`` cart/hold + occupant capture → **HH-100**
- catalog scraping into ``*.json`` → **HH-101**

Contract mapping (how each ``BaseAdapter`` member is satisfied for Camis):

======================  ====================================================
``BaseAdapter`` member  Camis plan
======================  ====================================================
``base_url``            per-subclass host, e.g. ``https://camping.bcparks.ca``
``requires_credentials````True`` — Camis is account-based
``booking_timezone``    per-subclass (``America/Vancouver`` / ``America/Toronto``)
``cart_hold_minutes``   15 — measured on a live BC hold in HH-103 (~15.9 min)
``param_fields()``      subclass builds from the catalog JSON + ``/api``
                        taxonomy (``_load_catalog`` / ``fetch_json`` here)
``occupant_fields()``   **OPEN** — captured from ``/create-booking/partyinfo``
                        in HH-100; defaults to ``[]``
``fill_form()``         subclass drives search (HH-99); ``detect_availability``
                        should prefer the JSON date-schedule endpoint
``detect_availability()``read ``/api/dateschedule/...`` JSON (HH-99)
``attempt_hold()``      add-to-cart → ``/create-booking/*`` → park on payment
                        for noVNC, then ``_persist_cart_session`` (HH-100)
``is_expired()``        inherited default, with per-subclass timezone/cutoff
======================  ====================================================
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date as date_cls, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from app.adapters.base import (
    AvailabilityResult,
    AvailabilityStatus,
    BaseAdapter,
    BookingResult,
    BookingWindowClosedDuringHold,
    BookingWindowInfo,
    CredentialsRejectedError,
    CredentialVerificationResult,
    OccupantField,
    ParamField,
    StayPatternInfo,
    UnexpectedHoldFailure,
    VerificationStatus,
)
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.job import utcnow


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module-level constants shared by every Camis site
# ---------------------------------------------------------------------------

# A realistic desktop browser User-Agent. The Camis edge (Azure Front Door +
# WAF, see recon §5) challenges obvious non-browser clients unevenly — Ontario
# served scripted asset fetches a WAF page during recon. Sending browser-like
# headers on the JSON calls keeps the open catalog endpoints answering.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# People/party options offered by default; a subclass can narrow this from the
# capacity-category taxonomy once HH-99 wires the search form.
PEOPLE_OPTIONS = [str(i) for i in range(1, 26)]  # "1" … "25"

# Park option strings embed the resource_location_id in a trailing "(id)" —
# DOC-standard-hut convention: self-describing at submit time, e.g.
# "Bamberton Provincial Park (-2147483646)". The name group is greedy so park
# names containing parentheses still parse.
_PARK_OPTION_RE = re.compile(r"^(?P<name>.+)\s\((?P<rl_id>-?\d+)\)$")


def _format_park_option(park: dict) -> str:
    return f"{park['full_name']} ({park['resource_location_id']})"


def _parse_park_option(value: str) -> int | None:
    """Return the embedded resource_location_id, or None if unparseable."""
    m = _PARK_OPTION_RE.match(value.strip())
    return int(m.group("rl_id")) if m else None


# Equipment option strings embed BOTH ids — category and sub-category — in a
# trailing "(cat/sub)", e.g. "1 Tent (-32768/-32768)". The availability read
# filters on both (equipmentCategoryId + subEquipmentCategoryId), so a single
# self-describing option carries the whole selection, same convention as the
# park option above. The name group is greedy so an equipment label containing
# parentheses still parses (THR-132).
_EQUIPMENT_OPTION_RE = re.compile(r"^(?P<name>.+)\s\((?P<cat>-?\d+)/(?P<sub>-?\d+)\)$")


def _format_equipment_option(cat_id: int, sub_id: int, sub_name: str) -> str:
    return f"{sub_name} ({cat_id}/{sub_id})"


def _parse_equipment_option(value: str) -> tuple[int, int] | None:
    """Return the embedded (equipment_category_id, sub_equipment_category_id),
    or None if unparseable."""
    m = _EQUIPMENT_OPTION_RE.match(value.strip())
    return (int(m.group("cat")), int(m.group("sub"))) if m else None


class BaseCamisAdapter(BaseAdapter):
    """Intermediate base for all Camis booking-site adapters.

    Concrete subclasses must set the class-level config hooks and implement the
    ``BaseAdapter`` abstract methods (``param_fields``, ``fill_form``,
    ``detect_availability``); ``attempt_hold`` is optional per the base
    contract. They do so by calling the shared helpers defined here.
    """

    # ------------------------------------------------------------------
    # Class-level config hooks — overridden per province
    # ------------------------------------------------------------------

    # Origin (scheme + host), no trailing slash — e.g. "https://camping.bcparks.ca".
    base_url: str = ""
    # Localization culture used for API responses / display names. BC is en-CA
    # only; Ontario is bilingual (en-CA / fr-CA) — recon §4.
    culture: str = "en-CA"
    # Path to the site catalog JSON produced by the HH-101 scraper (analogous
    # to great_walks.json / doc_standard_huts.json). Subclasses point this at
    # their own file; ``None`` means "no catalog yet" and yields an empty list.
    catalog_path: Path | None = None

    # Camis is account-based across all provinces.
    requires_credentials: bool = True

    # THR-129 item 3: a Camis booking is made under one named permit holder
    # (the signed-in account holder), not each occupant individually — see
    # resolve_permit_holder_name below.
    uses_single_permit_holder: bool = True

    # THR-124: Camis dates release on a rolling per-park/per-province
    # schedule (unlike the DOC adapters, which are always bookable). See
    # check_booking_window below.
    has_booking_windows: bool = True

    # THR-126: BC/Ontario's PRIMARY release mechanic is a rolling
    # per-arrival-date window (BC opens 3 months before arrival, Ontario 5) —
    # the dateschedule season go-live date only covers fixed-date season
    # launches, which turned out to be the minority case, so gating on it
    # alone (the THR-124 shape) meant the feature could never engage for the
    # common case (confirmed live: a next-summer BC hunt was created active,
    # not AWAITING_WINDOW, because no goLiveDate was published for a season
    # that far out). None (the default) means "no confirmed rolling cadence
    # for this adapter" — falls back to go-live-only gating, i.e. exactly the
    # pre-THR-126 behavior; set per-province below.
    advance_booking_months: int | None = None
    # Local time of day the rolling window opens, in booking_timezone. Ticket
    # text: "7am PT / 7am ET" — not independently re-confirmed live in this
    # change; if a province's actual cutover time turns out to differ this is
    # the one place to correct it.
    window_open_local_time: time = time(7, 0)

    # Booking window. Subclasses set the province timezone; the cutoff default
    # is intentionally the base 23:59 until a real booking cutoff is confirmed.
    booking_timezone: str | None = None
    booking_cutoff_time: time = time(23, 59)

    # Cart hold / expiry timing. MEASURED on live BC Parks in HH-103: a real
    # committed hold auto-released at ~15.9 min of (poll-only) inactivity — so
    # the window is ~15 min, NOT DOC's 25 (recon §5). No countdown timer surfaces
    # before the payment step, so this had to be measured, not read. Rounded down
    # to 15 so the /pay page never tells the user they have more time than they
    # do. Camis is one platform, so Ontario inherits this pending its own
    # confirmation in HH-105. A keepalive touch every 10 min keeps the parked
    # noVNC session warm within the window.
    cart_hold_minutes: int | None = 15
    cart_inactive_after_minutes: int | None = 15
    cart_keepalive_interval_minutes: int | None = 10

    # ------------------------------------------------------------------
    # Known Camis JSON API endpoints (verified unauthenticated — recon §2)
    # ------------------------------------------------------------------

    API_AUTH_LOGIN = "/api/auth/login"              # POST — account sign-in
    API_CART = "/api/cart"                          # GET — current shopper cart
    API_MAPS_ROOT = "/api/maps/root"                # top-level region tree
    API_MAPS = "/api/maps"                          # ?resourceLocationId=<id>
    API_BOOKING_CATEGORIES = "/api/bookingcategories"
    API_SEARCH_CRITERIA_TABS = "/api/searchcriteriatabs"
    API_CAPACITY_CATEGORIES = "/api/capacitycategory/capacitycategories"
    API_EQUIPMENT = "/api/equipment"
    # Live availability (HH-99, decoding corrected in HH-102). A GET returning,
    # for the queried map: per-day aggregates for each child map under
    # ``mapLinkAvailabilities`` (keyed by child MAP id) and, on leaf maps,
    # per-site day codes under ``resourceAvailabilities``. Query params:
    #   resourceLocationId, mapId, bookingCategoryId, startDate, endDate,
    #   getDailyAvailability=true  (plus optional equipmentCategoryId etc.)
    API_AVAILABILITY_MAP = "/api/availability/map"
    # ``/api/dateschedule`` is the operating-SEASON calendar (reservable date
    # ranges, go-live dates, min/max stay), not live availability — useful for
    # gating polling to the open booking window, not for detection.
    API_DATE_SCHEDULE = "/api/dateschedule/resourcelocationid"
    API_REACHABLE_RESOURCES = "/api/reachableresources/resourcelocationid"

    # Availability status codes, decoded empirically against the live BC Parks
    # API (HH-102) by cross-checking a fully-booked long weekend (BC Day),
    # a quiet mid-September weekday, next-day dates, and beyond-window dates
    # (the Angular enum is inlined in the bundle and not statically
    # recoverable):
    #
    #   site level  (``resourceAvailabilities[<resourceId>][].availability``):
    #     0 = available   1 = booked/unavailable
    #     3 = non-reservable / does not match search filters
    #   link level  (``mapLinkAvailabilities`` / ``mapAvailabilities`` — a
    #   per-day aggregate over the child map's sites):
    #     0 = some site available that day   1 = none
    #     2 = closed                         6 = not yet released
    #
    # NOTE: this corrects HH-99, which shipped ``1 = available`` (inverted —
    # it would report a fully-booked park as AVAILABLE) and read
    # ``mapLinkAvailabilities`` keyed by ``resourceLocationId``: when querying
    # a park's map the keys are its child MAP ids (campground loops), not the
    # park's resource-location id. Any unrecognised code is treated as "not
    # available" so a new code can't be misread as free.
    AVAILABILITY_AVAILABLE_CODE = 0

    # Cap on drill-down requests per availability check. THR-129 Finding A:
    # live recon proved a loop's own aggregate can be non-zero while still
    # hiding a code-0 descendant several levels down (Parks Canada nests
    # loops 3 deep, e.g. park -> campground loop -> sub-loop), so every
    # discovered link is now drilled rather than only ones whose own code
    # looks open (see ``_collect_site_days``) — raised from 12 so a 3-level
    # park doesn't get truncated before reaching real per-site data.
    _MAX_DRILL_REQUESTS = 40

    # THR-132: equipment (a tent/RV size) is a real availability filter on
    # EVERY Camis site, and it's now driven by a Form field (see the
    # ``equipment`` ParamField and ``_resolve_params``) rather than an
    # invisible constant. It rides the /api/availability/map query as
    # equipmentCategoryId/subEquipmentCategoryId (+ the accompanying
    # isReserving/filterData/numEquipment the UI sends alongside).
    #
    # This CORRECTS the THR-129 assumption that the equipment enum was
    # "Parks-Canada-specific" and that sending it to BC 400'd: verified live
    # 2026-07-08, all three sites (BC Parks, Ontario Parks, Parks Canada)
    # expose the SAME id enum — category -32768 "Equipment", sub -32768 the
    # smallest/first tent ("1 Tent"/"Single Tent"/"Small Tent"), ascending
    # through tents → vans → trailers/RVs by size — and each accepts the
    # equipment params with HTTP 200 (with or without them). The real THR-129
    # BC regression was the malformed ``peopleCapacityCategoryCounts`` param
    # (a Python list httpx serialized as a repr → 400), which THR-131 already
    # fixed; the equipment ids were never the culprit. So the old
    # ``_INCLUDE_UI_QUERY_EXTRAS`` PC-only gate is gone — equipment is sent by
    # every adapter, sourced from the form with these class defaults as the
    # fallback for jobs saved before the field existed.
    #
    # The default is the frontcountry small/single tent (least-constrained,
    # fits every site — a safe default that never hides availability). The
    # sub-category genuinely changes results (live: PC Banff-Castle, an RV
    # over 35ft reports 0 available where a small tent reports 14), which is
    # exactly why it must be user-selectable. Same shared enum on all three,
    # so this default lives on the base class.
    DEFAULT_EQUIPMENT_CATEGORY_ID: int | None = -32768
    DEFAULT_SUB_EQUIPMENT_CATEGORY_ID: int | None = -32768

    # capacityCategoryId used by the Angular app's own party-size query
    # (peopleCapacityCategoryCounts) — confirmed live 2026-07-07, Parks
    # Canada only. Confirmed live to apply to the Accommodation category too
    # (same capacityCategoryId -32767 as Campsite). Unlike equipment (above),
    # this stays opt-in per adapter — only Parks Canada was confirmed to
    # accept it — so it defaults to None and gates the capacity block in
    # ``_build_availability_query`` (BC/Ontario send no party-size filter).
    DEFAULT_CAPACITY_CATEGORY_ID: int | None = None

    # THR-131: booking-category ids that take NO equipment filter (no
    # equipmentCategoryId/subEquipmentCategoryId/isReserving/numEquipment/
    # filterData). Parks Canada's Accommodation category (oTENTiks/cabins/
    # yurts — the huts) has no equipment step, and its availability reads
    # correctly with no equipment params at all (confirmed live against
    # reservation.pc.gc.ca: the frontcountry "Small Tent" ids are a semantic
    # no-op there). The party-size capacity filter is still sent for these
    # categories. Default empty (every category gets equipment); set
    # per-adapter.
    _NON_EQUIPMENT_BOOKING_CATEGORY_IDS: frozenset[int] = frozenset()

    # ------------------------------------------------------------------
    # JSON API access (the catalog + availability read path)
    # ------------------------------------------------------------------

    def api_url(self, path: str) -> str:
        """Join ``base_url`` with an API ``path``.

        Raises ``ValueError`` if the subclass didn't set ``base_url`` — that's a
        configuration bug, not a runtime condition to swallow.
        """
        if not self.base_url:
            raise ValueError(
                f"{type(self).__name__}.base_url is not set — cannot build API URLs"
            )
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"

    async def fetch_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float = 30.0,
    ) -> Any:
        """GET a Camis ``/api/*`` endpoint and return parsed JSON.

        Sends browser-like headers so the Azure edge/WAF serves the JSON rather
        than a challenge page (recon §5). Used for catalog scraping (HH-101) and
        JSON availability reads (HH-99); these endpoints answer unauthenticated.
        """
        headers = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": self.culture,
        }
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            response = await client.get(self.api_url(path), params=params)
            response.raise_for_status()
            return response.json()

    # Thin convenience wrappers around the catalog taxonomy endpoints. These
    # are usable today and give HH-99/HH-101 a typed entry point.
    async def fetch_maps_root(self) -> Any:
        return await self.fetch_json(self.API_MAPS_ROOT)

    async def fetch_booking_categories(self) -> Any:
        return await self.fetch_json(self.API_BOOKING_CATEGORIES)

    async def fetch_search_criteria_tabs(self) -> Any:
        return await self.fetch_json(self.API_SEARCH_CRITERIA_TABS)

    # ------------------------------------------------------------------
    # Site catalog (produced by the HH-101 scraper)
    # ------------------------------------------------------------------

    def _load_catalog(self) -> dict:
        """Return the parsed catalog JSON for this site.

        Returns an empty dict (rather than raising) when ``catalog_path`` is
        unset or the file is missing/malformed, so a not-yet-scraped catalog
        doesn't break ``param_fields`` or adapter registration — matching how
        ``doc_standard_hut._load_hut_catalog`` degrades.
        """
        path = self.catalog_path
        if path is None:
            return {}
        try:
            return json.loads(Path(path).read_text())
        except FileNotFoundError:
            logger.warning(
                "%s catalog not found at %s — catalog empty",
                type(self).__name__, path,
            )
            return {}
        except Exception as exc:
            logger.error("failed to load Camis catalog %s: %s", path, exc)
            return {}

    def _park_by_resource_location_id(self, resource_location_id: int) -> dict | None:
        """Look up a catalog park entry by its ``resource_location_id``."""
        for park in self._load_catalog().get("parks") or []:
            if park.get("resource_location_id") == resource_location_id:
                return park
        return None

    def _default_booking_category_id(self) -> int | None:
        """First booking-category id from the catalog, or ``None`` if unknown."""
        cats = self._load_catalog().get("booking_categories") or []
        return cats[0].get("booking_category_id") if cats else None

    # ------------------------------------------------------------------
    # Params schema + resolution (hoisted from the BC adapter in HH-104 —
    # entirely catalog-driven, so every Camis subclass shares it and a new
    # province is pure configuration)
    # ------------------------------------------------------------------

    @classmethod
    def _catalog(cls) -> dict:
        """Class-level catalog read for ``param_fields`` (no instance needed)."""
        # _load_catalog is an instance method for subclass override symmetry;
        # instantiate cheaply here.
        return cls()._load_catalog()

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

        equipment_tree, equipment_flat, default_equipment = cls._equipment_options(catalog)

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
            # THR-132: equipment (tent/RV size) is a real availability filter
            # on every Camis site — it changes which sites report available
            # (a large RV won't fit a tent-only site) — so it's a visible,
            # configurable field, grouped by equipment category (frontcountry
            # "Equipment" vs Parks Canada's "Backcountry"). The option string
            # embeds both ids (see ``_format_equipment_option``);
            # ``_resolve_params`` decodes them into equipmentCategoryId/
            # subEquipmentCategoryId for the availability read and the reserve
            # funnel. Optional with a small-tent default so existing jobs (and
            # availability-only hunts) keep working — an absent value falls
            # back to ``DEFAULT_EQUIPMENT_CATEGORY_ID``/sub in the query.
            ParamField(
                key="equipment",
                label="Equipment",
                type="select",
                options=equipment_flat,
                options_tree=equipment_tree or None,
                default=default_equipment,
                required=False,
            ),
            # Renders the camper picker in the job wizard (the frontend
            # special-cases key == "occupants") and gates auto-book: the poll
            # worker only enqueues a hold when params.occupants is non-empty.
            # Camis books under one named permit holder — THR-129 item 3
            # derives that name from whichever occupant is selected (see
            # resolve_permit_holder_name), so a single camper is enough with
            # no adapter-specific field required. Optional for
            # availability-only hunts. (Found in HH-103: without this field
            # the wizard could never enable auto-book for Camis jobs.)
            ParamField(
                key="occupants",
                label="Campers",
                type="text",
                default="[]",
                required=False,
            ),
        ]

    @staticmethod
    def _equipment_options(catalog: dict) -> tuple[list[dict], list[str], str]:
        """Build the equipment select's ``(options_tree, options, default)``.

        Sourced from the catalog's ``equipment`` tree (scraped from
        ``/api/equipment`` — THR-132). Returns a grouped tree (one group per
        equipment category, e.g. "Equipment" / "Backcountry"), the flattened
        option list (for API clients that don't understand ``options_tree``),
        and the default option string — the first sub-category of the first
        category, i.e. the frontcountry small/single tent (least-constrained,
        fits every site). Empty/absent equipment yields empty lists and no
        default, so a not-yet-rescraped catalog degrades gracefully.
        """
        tree: list[dict] = []
        flat: list[str] = []
        for cat in sorted(
            catalog.get("equipment") or [], key=lambda c: c.get("order") or 0
        ):
            cat_id = cat.get("equipment_category_id")
            if cat_id is None:
                continue
            items: list[str] = []
            for sub in sorted(
                cat.get("sub_categories") or [], key=lambda s: s.get("order") or 0
            ):
                sub_id = sub.get("sub_equipment_category_id")
                sub_name = sub.get("name")
                if sub_id is None or not sub_name:
                    continue
                opt = _format_equipment_option(int(cat_id), int(sub_id), sub_name)
                items.append(opt)
                flat.append(opt)
            if items:
                tree.append({"group": cat.get("name") or "Equipment", "items": items})
        return tree, flat, (flat[0] if flat else "")

    def _resolve_params(self, params: dict) -> dict:
        """Return a copy of ``params`` with the Camis IDs filled in.

        The query builder wants ``resource_location_id`` /
        ``booking_category_id``; the frontend submits the human-readable
        ``park`` / ``booking_category`` option strings. Explicit IDs in the
        params always win (that's what tests and power users pass).
        Idempotent, so wrappers can call it defensively.
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

        # THR-132: decode the equipment option string ("Name (cat/sub)") into
        # the two ids the availability read filters on. Explicit ids win, so a
        # power user or test can pass equipment_category_id/
        # sub_equipment_category_id directly.
        if resolved.get("equipment_category_id") is None and resolved.get("equipment"):
            ids = _parse_equipment_option(str(resolved["equipment"]))
            if ids is not None:
                resolved["equipment_category_id"], resolved["sub_equipment_category_id"] = ids
            else:
                logger.warning(
                    "could not parse equipment option %r — expected 'Name (cat/sub)'",
                    resolved["equipment"],
                )

        return resolved

    # ------------------------------------------------------------------
    # Booking-window gating (THR-124)
    #
    # `/api/dateschedule/resourcelocationid` field shape CONFIRMED LIVE
    # against both camping.bcparks.ca and reservations.ontarioparks.ca on
    # 2026-07-07 (unauthenticated GET, identical shape on both sites):
    #
    #   {"<scheduleId>": {"displayOnline": bool, ..., "reservableDates": [
    #       {"reservableDates": {"start": <ISO>, "end": <ISO>},
    #        "goLiveDate": <naive local ISO or null>,
    #        "goLiveDateUtc": <UTC ISO ("...Z") or null>,
    #        "goLiveTimeZone": "Pacific Standard Time"}, ...
    #   ], "operatingDates": [...], ...}, "<scheduleId2>": {...}}
    #
    # i.e. a dict keyed by scheduleId, each holding a *list* of per-season
    # dicts nested one level under a same-named `reservableDates` key.
    # `operatingDates` is a separate, much broader facility-operating range
    # and is NOT the reservable window — never read it for gating.
    #
    # IMPORTANT: a future season's row commonly exists with `goLiveDate(Utc)`
    # still null (the site hasn't published its release date yet) — e.g.
    # every BC 2027 season sampled during recon. There is NO reliable
    # relationship between a season's start date and its actual go-live time
    # to fall back on: BC go-live dates ranged from ~11 months before to
    # several months after the corresponding season start, while Ontario's
    # go-live is typically the same instant as the season start — two
    # different rolling-release models on the same API shape. So a range
    # with no go-live date must NOT be treated as "opens on its start date";
    # doing so could park a job (with polling fully OFF — see
    # WatchJob.window_opens_at) until a wildly wrong date, silently missing
    # the real release. Only a genuinely present `goLiveDate`/`goLiveDateUtc`
    # produces an arm time; everything else fails OPEN (``is_open=True``,
    # i.e. "poll normally, exactly like before THR-124").
    #
    # THR-127: the rolling advance-booking window (``advance_booking_months``,
    # this platform's PRIMARY release mechanic per THR-126) is an INDEPENDENT
    # constraint from the reservable-range check above — a season's range
    # describes the operating SEASON, not the released subset of it. The
    # original THR-126 implementation only ever consulted
    # ``advance_booking_months`` in the "target date isn't covered by any
    # range" branch, so any in-season date (the common case once a season's
    # range is published, which happens well before the rolling window
    # itself opens) short-circuited straight to ``is_open=True`` at the
    # in-range check and never asked the rolling-window question at all —
    # confirmed live: a BC Golden Ears hunt (arrival Oct 8, ~3 months out)
    # was reported AVAILABLE and its hold died on a "Cannot Reserve ... not
    # yet allowed" modal at exactly the rolling-window instant this code
    # would have computed had it run. The fix: check the rolling window
    # FIRST, unconditionally — it can close a date that's otherwise "in
    # range" — and only fall through to the range/go-live checks once it's
    # satisfied (or not configured at all).
    # ------------------------------------------------------------------

    _SCHEDULE_LIST_KEYS = ("dateSchedules", "schedules", "seasons", "items", "results")
    _NESTED_RANGE_KEY = "reservableDates"  # confirmed: {"start": ..., "end": ...}
    _RANGE_START_KEYS = (
        "reservationStartDate", "reservableStartDate", "startDate", "seasonStartDate",
    )
    _RANGE_END_KEYS = (
        "reservationEndDate", "reservableEndDate", "endDate", "seasonEndDate",
    )
    # goLiveDateUtc is confirmed always UTC already ("...Z") — tried first so
    # no timezone guessing is needed for the common case.
    _GO_LIVE_KEYS = (
        "goLiveDateUtc", "goLiveDate", "goLiveDateTime", "onSaleDate",
        "bookingWindowOpenDate", "releaseDate",
    )

    @staticmethod
    def _parse_iso_datetime(value: Any) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    @classmethod
    def _first_datetime(cls, entry: dict, keys: tuple[str, ...]) -> datetime | None:
        for key in keys:
            parsed = cls._parse_iso_datetime(entry.get(key))
            if parsed is not None:
                return parsed
        return None

    @classmethod
    def _schedule_entries(cls, data: Any) -> list[dict]:
        """Flatten a dateschedule response into a list of per-season dicts.

        Confirmed live shape (see module comment above): a dict keyed by
        scheduleId, each value holding its seasons under a `reservableDates`
        list. Also tolerates a bare list of season dicts, a dict wrapping the
        list under one of ``_SCHEDULE_LIST_KEYS``, or a single season/schedule
        object with no wrapper at all, for forward-compatibility with a Camis
        site we haven't recon'd.
        """
        def _seasons_of(schedule: Any) -> list[dict]:
            if not isinstance(schedule, dict):
                return []
            seasons = schedule.get(cls._NESTED_RANGE_KEY)
            if isinstance(seasons, list):
                return [s for s in seasons if isinstance(s, dict)]
            return []

        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
        if isinstance(data, dict):
            flattened = [s for schedule in data.values() for s in _seasons_of(schedule)]
            if flattened:
                return flattened
            for key in cls._SCHEDULE_LIST_KEYS:
                value = data.get(key)
                if isinstance(value, list):
                    return [e for e in value if isinstance(e, dict)]
            seasons = _seasons_of(data)
            if seasons:
                return seasons
            return [data]
        return []

    @classmethod
    def _entry_range(cls, entry: dict) -> tuple[datetime | None, datetime | None]:
        """Extract (start, end) for one season entry.

        Prefers the confirmed nested shape (``entry["reservableDates"] ==
        {"start": ..., "end": ...}``); falls back to flat candidate keys for
        an unrecon'd site.
        """
        nested = entry.get(cls._NESTED_RANGE_KEY)
        if isinstance(nested, dict):
            start = cls._parse_iso_datetime(nested.get("start"))
            end = cls._parse_iso_datetime(nested.get("end"))
            if start is not None or end is not None:
                return start, end
        return (
            cls._first_datetime(entry, cls._RANGE_START_KEYS),
            cls._first_datetime(entry, cls._RANGE_END_KEYS),
        )

    @classmethod
    def _entry_go_live(cls, entry: dict, tz: Any) -> datetime | None:
        """Return this season's confirmed go-live time (UTC), if published.

        ``goLiveDateUtc`` is already UTC when present; ``_localize`` is a
        no-op in that case and only does real work for the naive fallback
        keys.
        """
        parsed = cls._first_datetime(entry, cls._GO_LIVE_KEYS)
        if parsed is None:
            return None
        return cls._localize(parsed, tz)

    @staticmethod
    def _localize(dt: datetime, tz: Any) -> datetime:
        """Return ``dt`` as an aware UTC datetime, treating a naive ``dt`` as
        local to ``tz`` (or already-UTC if ``tz`` is None)."""
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc)
        if tz is not None:
            return dt.replace(tzinfo=tz).astimezone(timezone.utc)
        return dt.replace(tzinfo=timezone.utc)

    @staticmethod
    def _subtract_months(d: date_cls, months: int) -> date_cls:
        """Subtract ``months`` calendar months from ``d``.

        Clamps the day to the last valid day of the resulting month (e.g.
        Mar 31 minus 1 month -> Feb 28/29) rather than raising or rolling
        over into the following month.
        """
        total_months = d.year * 12 + (d.month - 1) - months
        year, month0 = divmod(total_months, 12)
        month = month0 + 1
        next_month_first = (
            date_cls(year + 1, 1, 1) if month == 12 else date_cls(year, month + 1, 1)
        )
        last_day_of_month = (next_month_first - timedelta(days=1)).day
        return date_cls(year, month, min(d.day, last_day_of_month))

    @classmethod
    def _entry_for_target_date(cls, entries: list[dict], target_date: date_cls) -> dict | None:
        """Pick the single season entry most relevant to ``target_date``.

        THR-126: fixes the previous behavior of taking ``min()`` of every
        entry's go-live date regardless of which season it belongs to, which
        could surface a past or otherwise unrelated season's go-live. Entries
        with no parseable range at all can't be scored and are ignored;
        among the rest this picks whichever range's start date is CLOSEST to
        ``target_date`` (in either direction) — the season actually adjacent
        to the requested date, rather than whichever happens to sort first.
        """
        scored = [
            (entry, start)
            for entry in entries
            if (start := cls._entry_range(entry)[0]) is not None
        ]
        if not scored:
            return None
        return min(scored, key=lambda pair: abs((pair[1].date() - target_date).days))[0]

    @classmethod
    def _parse_booking_window(
        cls,
        data: Any,
        target_date: date_cls,
        tz: Any,
        *,
        advance_booking_months: int | None = None,
        window_open_local_time: time = time(7, 0),
        now: datetime | None = None,
    ) -> BookingWindowInfo:
        # THR-127: threaded through (rather than reading the wall clock
        # directly) so tests can pin "now" without monkeypatching datetime —
        # this method was a pure classmethod with no prior notion of "now"
        # at all, since the THR-126 rolling-gate candidate only ever fed a
        # min()-across-candidates comparison, never a direct now-vs-open_dt
        # check.
        now = now if now is not None else datetime.now(timezone.utc)

        rolling_open_dt: datetime | None = None
        if advance_booking_months is not None:
            rolling_open_date = cls._subtract_months(target_date, advance_booking_months)
            rolling_open_dt = cls._localize(
                datetime.combine(rolling_open_date, window_open_local_time), tz
            )

        def _rolling_gate_still_closed() -> BookingWindowInfo | None:
            """THR-127 (the actual fix): the rolling window is an
            independent constraint from the dateschedule season ranges —
            those describe the operating SEASON, not the released subset of
            it — so it must be checked wherever this module would otherwise
            report ``is_open=True`` (an in-range date, or a dateschedule
            response with nothing usable at all), NOT only in the
            already-out-of-range fallback below. Returns the closed
            ``BookingWindowInfo`` if the rolling window hasn't opened yet,
            or ``None`` if it's not configured or has already opened (in
            which case the caller proceeds to its own logic unchanged).
            """
            if rolling_open_dt is not None and now < rolling_open_dt:
                return BookingWindowInfo(
                    is_open=False,
                    opens_at=rolling_open_dt,
                    opens_at_precise=True,
                    evidence=(
                        "rolling advance-booking window has not opened yet "
                        f"(opens {rolling_open_dt.isoformat()}) — this applies "
                        "even though the date may already be inside a "
                        "published reservable range, since that range "
                        "describes the operating season, not the released "
                        "subset of it"
                    ),
                )
            return None

        entries = cls._schedule_entries(data)
        if not entries:
            # THR-127: a dateschedule response with nothing parseable at all
            # doesn't mean the rolling constraint no longer applies — check
            # it before failing open.
            blocked = _rolling_gate_still_closed()
            if blocked is not None:
                return blocked
            return BookingWindowInfo(
                is_open=True, evidence="dateschedule returned no parseable entries",
            )

        for entry in entries:
            start, end = cls._entry_range(entry)
            if start is None and end is None:
                continue
            if (start is None or target_date >= start.date()) and (
                end is None or target_date <= end.date()
            ):
                # THR-127 (the actual fix): a season range being published
                # does NOT mean the rolling window has opened — this is the
                # exact short-circuit that made advance_booking_months dead
                # code for the common case (see the module comment above).
                blocked = _rolling_gate_still_closed()
                if blocked is not None:
                    return blocked
                return BookingWindowInfo(
                    is_open=True, evidence="target date is within a reservable range",
                )

        # No entry's reservable range covers target_date — the rolling gate
        # (if configured) either isn't blocking or has already opened, so it
        # can't cover this case unconditionally the way it does above; fold
        # it back in as a candidate instead. THR-126: combine the remaining
        # independent signal(s) and arm on the EARLIEST one available —
        # arming early just means the poll worker sees "not released yet" a
        # bit longer, arming late risks missing the window outright. This
        # branch is UNCHANGED by THR-127 — out-of-range dates already
        # combined these signals correctly; only the in-range short-circuit
        # above was the bug:
        #  - the rolling-release window computed above, if configured
        #    (may be in the past OR future here — a still-in-the-future
        #    rolling date can legitimately be the earliest candidate for an
        #    out-of-range date too, e.g. next season hasn't been published
        #    at all yet);
        #  - a genuinely published go-live date for the season relevant to
        #    target_date (a fixed-date season launch, or this season
        #    releasing off-cadence) — scoped to the one relevant entry via
        #    _entry_for_target_date, not every season on file (see its
        #    docstring for the bug that fixes).
        candidates: list[datetime] = []

        if rolling_open_dt is not None:
            candidates.append(rolling_open_dt)

        relevant_entry = cls._entry_for_target_date(entries, target_date)
        if relevant_entry is not None:
            confirmed_go_live = cls._entry_go_live(relevant_entry, tz)
            if confirmed_go_live is not None:
                candidates.append(confirmed_go_live)

        if not candidates:
            return BookingWindowInfo(
                is_open=True,
                evidence=(
                    "target date not covered by any reservable range, no rolling "
                    "advance-booking window is configured for this adapter, and "
                    "no confirmed go-live date is published yet — failing open"
                ),
            )

        open_dt = min(candidates)
        return BookingWindowInfo(
            is_open=False,
            opens_at=open_dt,
            opens_at_precise=True,
            evidence=(
                "target date not covered by any reservable range; earliest "
                f"computed open time is {open_dt.isoformat()}"
            ),
        )

    # ------------------------------------------------------------------
    # THR-133 — stay-pattern rules (arrival/departure changeover,
    # min/max-stay) from the same /api/dateschedule response.
    #
    # Confirmed live 2026-07-08 (Golden Ears Provincial Park,
    # resource_location_id -2147483606): the response is a dict keyed by
    # scheduleId, and each schedule value carries these THREE arrays
    # directly (siblings of the ``reservableDates`` season list
    # ``_schedule_entries``/``_entry_range`` already parse above):
    #   - ``allowedArrivalDepartureDays``: [{"range": {"start","end"},
    #     "daysOfWeek": [int, ...]}] — daysOfWeek uses .NET's
    #     ``System.DayOfWeek`` (Sunday=0 .. Saturday=6). Confirmed: for
    #     2026-10-09..2026-10-12, daysOfWeek=[1, 5] (Mon/Fri) — querying
    #     availability/map for a Thu Oct 8 -> Sat Oct 10 stay against this
    #     exact resource returned 54 sites at site-day code 3
    #     ("Restrictions"), and the site's own banner for that stay reads
    #     "must depart on any of the following days: Monday, Friday" — an
    #     exact match.
    #   - ``minStayOverrides`` / ``maxStayOverrides``: [{"range": {...},
    #     "stayDurationLimitDays": int, "stayDurationLimitTime": null}].
    #     ``minStayOverrides`` shape confirmed live (16-17 holiday-weekend
    #     entries requiring 3-night minimums); no non-empty
    #     ``maxStayOverrides`` example was found on any park probed, so its
    #     shape is inferred by symmetry with ``minStayOverrides`` rather
    #     than independently confirmed.
    #
    # Mirrors ``_parse_booking_window``'s existing choice to check every
    # schedule the response returns rather than discriminating by booking
    # category — the dateschedule endpoint doesn't appear to filter by
    # ``bookingCategoryId`` server-side either (a probed resource returned
    # every schedule regardless of the query's category).
    # ------------------------------------------------------------------

    # .NET System.DayOfWeek: Sunday=0 .. Saturday=6 (confirmed live — see
    # comment above).
    _STAY_PATTERN_DAY_NAMES = (
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    )

    @staticmethod
    def _dotnet_day_of_week(d: date_cls) -> int:
        """Python's ``date.weekday()`` is Monday=0..Sunday=6; the Camis API's
        ``daysOfWeek`` uses .NET's Sunday=0..Saturday=6."""
        return (d.weekday() + 1) % 7

    @classmethod
    def _schedules(cls, data: Any) -> list[dict]:
        """Per-schedule dicts from a dateschedule response — the level at
        which ``minStayOverrides``/``maxStayOverrides``/
        ``allowedArrivalDepartureDays`` live. Tolerates a bare list of
        schedule dicts too, for forward-compat with an unrecon'd site."""
        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
        if isinstance(data, dict):
            return [v for v in data.values() if isinstance(v, dict)]
        return []

    @classmethod
    def _range_covers(cls, rng: Any, d: date_cls) -> bool:
        """True if calendar date ``d`` falls within ``rng`` (inclusive),
        comparing via ``.date()`` exactly like ``_parse_booking_window``
        does for season ranges — no timezone re-localization, since these
        overrides are day-granularity bands, not instant-in-time ones."""
        if not isinstance(rng, dict):
            return False
        start = cls._parse_iso_datetime(rng.get("start"))
        end = cls._parse_iso_datetime(rng.get("end"))
        if start is None and end is None:
            return False
        return (start is None or d >= start.date()) and (end is None or d <= end.date())

    @classmethod
    def _range_overlaps_stay(
        cls, rng: Any, arrival: date_cls, departure: date_cls
    ) -> bool:
        """True if the requested stay ``[arrival, departure]`` (inclusive)
        overlaps ``rng`` at all — used for min/max-stay bands, which apply
        to the whole requested stay rather than a single endpoint."""
        if not isinstance(rng, dict):
            return False
        start = cls._parse_iso_datetime(rng.get("start"))
        end = cls._parse_iso_datetime(rng.get("end"))
        if start is None and end is None:
            return False
        return (start is None or departure >= start.date()) and (end is None or arrival <= end.date())

    @classmethod
    def _check_stay_pattern_from_schedules(
        cls, data: Any, arrival: date_cls, departure: date_cls, nights: int,
    ) -> str | None:
        """Validate a requested arrival/nights combo against every
        schedule's stay-pattern override arrays. Returns the first
        violation's human-readable reason, or ``None`` if compliant."""
        for schedule in cls._schedules(data):
            for override in schedule.get("allowedArrivalDepartureDays") or []:
                days = override.get("daysOfWeek")
                if not days:
                    continue
                rng = override.get("range")
                allowed_names = ", ".join(
                    cls._STAY_PATTERN_DAY_NAMES[day]
                    for day in sorted(days) if 0 <= day <= 6
                )
                if cls._range_covers(rng, arrival) and cls._dotnet_day_of_week(arrival) not in days:
                    return (
                        f"arrival {arrival.isoformat()} isn't an allowed arrival/departure "
                        f"day for this period — allowed days: {allowed_names}"
                    )
                if cls._range_covers(rng, departure) and cls._dotnet_day_of_week(departure) not in days:
                    return (
                        f"departure {departure.isoformat()} isn't an allowed arrival/departure "
                        f"day for this period — allowed days: {allowed_names}"
                    )
            for override in schedule.get("minStayOverrides") or []:
                limit = override.get("stayDurationLimitDays")
                if limit and cls._range_overlaps_stay(override.get("range"), arrival, departure) and nights < limit:
                    return f"minimum stay of {limit} night{'s' if limit != 1 else ''} required for this period"
            for override in schedule.get("maxStayOverrides") or []:
                limit = override.get("stayDurationLimitDays")
                if limit and cls._range_overlaps_stay(override.get("range"), arrival, departure) and nights > limit:
                    return f"maximum stay of {limit} night{'s' if limit != 1 else ''} allowed for this period"
        return None

    async def _check_dateschedule(
        self, params: dict
    ) -> tuple[BookingWindowInfo, StayPatternInfo]:
        """Shared ``/api/dateschedule`` fetch + parse for BOTH
        ``check_booking_window`` (WHEN a date becomes reservable) and
        ``check_stay_pattern`` (THR-133 — whether the requested arrival/
        nights combo is bookable AT ALL) — they're conceptually independent
        gates over the same response, so this keeps the fetch/error-handling
        code in one place. Each half fails open independently on its own
        parse error so one broken parser can't take out the other. Each
        public method calls this itself (i.e. calling both means two
        network fetches) rather than sharing one call, so that
        monkeypatching either public method independently — as existing
        tests and any future adapter override do — keeps working.
        """
        resolved = self._resolve_params(params)
        rl_id = resolved.get("resource_location_id")
        date_str = resolved.get("date")
        if rl_id is None or not date_str:
            reason = "missing resource_location_id/date"
            return (
                BookingWindowInfo(is_open=True, evidence=reason),
                StayPatternInfo(is_compliant=True, evidence=reason),
            )

        try:
            target_date = datetime.strptime(str(date_str), "%d/%m/%Y").date()
        except ValueError:
            reason = f"unparseable date {date_str!r}"
            return (
                BookingWindowInfo(is_open=True, evidence=reason),
                StayPatternInfo(is_compliant=True, evidence=reason),
            )

        nights = int(resolved.get("nights", 1) or 1)
        departure_date = target_date + timedelta(days=nights)

        category_id = resolved.get("booking_category_id")
        if category_id is None:
            category_id = self._default_booking_category_id()

        query: dict[str, Any] = {"resourceLocationId": int(rl_id)}
        if category_id is not None:
            query["bookingCategoryId"] = int(category_id)

        try:
            data = await self.fetch_json(self.API_DATE_SCHEDULE, params=query)
        except Exception as exc:
            logger.warning(
                "dateschedule lookup failed for resourceLocationId=%s: %s — "
                "treating booking window as open and stay pattern as compliant", rl_id, exc,
            )
            reason = f"dateschedule lookup failed: {exc}"
            return (
                BookingWindowInfo(is_open=True, evidence=reason),
                StayPatternInfo(is_compliant=True, evidence=reason),
            )

        tz = ZoneInfo(self.booking_timezone) if self.booking_timezone else None
        try:
            window = self._parse_booking_window(
                data,
                target_date,
                tz,
                advance_booking_months=self.advance_booking_months,
                window_open_local_time=self.window_open_local_time,
            )
        except Exception as exc:
            logger.warning("failed to parse dateschedule response: %s — treating window as open", exc)
            window = BookingWindowInfo(is_open=True, evidence=f"dateschedule parse error: {exc}")

        try:
            violation = self._check_stay_pattern_from_schedules(
                data, target_date, departure_date, nights
            )
            stay = StayPatternInfo(is_compliant=not violation, evidence=violation or "")
        except Exception as exc:
            logger.warning(
                "failed to parse stay-pattern rules from dateschedule response: %s — "
                "treating stay pattern as compliant", exc,
            )
            stay = StayPatternInfo(is_compliant=True, evidence=f"stay-pattern parse error: {exc}")

        return window, stay

    async def check_booking_window(self, params: dict) -> BookingWindowInfo:
        """Query the season calendar to see if ``params['date']`` is already
        reservable (THR-124). See the module comment above for caveats.

        Fails open (``is_open=True``) on any missing param, network error, or
        unparseable response — a broken lookup must never park a job that
        would otherwise have worked exactly as it did before this feature.
        """
        window, _ = await self._check_dateschedule(params)
        return window

    async def check_stay_pattern(self, params: dict) -> StayPatternInfo:
        """THR-133: validate the requested arrival/nights combo against
        ``/api/dateschedule``'s ``minStayOverrides``/``maxStayOverrides``/
        ``allowedArrivalDepartureDays`` (confirmed live 2026-07-08 against
        Golden Ears Provincial Park, resource_location_id -2147483606 — a
        Thu-arrival/Sat-departure 2-night stay for Oct 8-10 2026 returned 54
        sites at site-day code 3 ["Restrictions"], and the dateschedule
        response's ``allowedArrivalDepartureDays`` for that exact window
        (2026-10-09 to 2026-10-12) is ``daysOfWeek: [1, 5]`` — .NET
        ``DayOfWeek`` Monday/Friday — matching the site's own banner text
        verbatim: "must depart on any of the following days: Monday,
        Friday"). See ``_check_stay_pattern_from_schedules``.

        Fails open (``is_compliant=True``) on any missing param, network
        error, or unparseable response — same contract as
        ``check_booking_window``.
        """
        _, stay = await self._check_dateschedule(params)
        return stay

    # ------------------------------------------------------------------
    # Search + availability detection (HH-99, corrected in HH-102)
    #
    # Camis availability is JSON, not DOM — ``GET /api/availability/map``
    # returns per-loop day aggregates for the queried map and per-site day
    # codes on leaf (loop) maps. ``detect_availability`` reads the API
    # directly rather than scraping the page, drilling into open loops for
    # per-site data; ``fill_form`` just warms the browser context (Queue-it /
    # WAF pass) and takes a search snapshot for debugging like the DOC
    # adapters do.
    # ------------------------------------------------------------------

    def _build_availability_query(self, params: dict) -> dict:
        """Build the ``/api/availability/map`` query dict from job params.

        Reads these params (a subclass may override to remap its own keys):
          - ``resource_location_id`` (int, required)
          - ``map_id`` (int; falls back to the park's ``rootMapId`` in the catalog)
          - ``booking_category_id`` (int; falls back to the catalog's first)
          - ``date`` ("DD/MM/YYYY", required) and ``nights`` (int, default 1)

        Raises ``ValueError`` when a required field is missing/unresolvable.
        """
        rl_id = params.get("resource_location_id")
        if rl_id is None:
            raise ValueError("availability query requires `resource_location_id`")
        rl_id = int(rl_id)

        map_id = params.get("map_id")
        if map_id is None:
            park = self._park_by_resource_location_id(rl_id)
            map_id = (park or {}).get("root_map_id") or (park or {}).get("map_id")
        if map_id is None:
            raise ValueError(
                f"could not resolve map_id for resource_location_id={rl_id} "
                "(pass `map_id` or ensure the catalog has root_map_id)"
            )

        category_id = params.get("booking_category_id")
        if category_id is None:
            category_id = self._default_booking_category_id()
        if category_id is None:
            raise ValueError("availability query requires `booking_category_id`")

        date_str = params.get("date")
        if not date_str:
            raise ValueError("availability query requires `date` (DD/MM/YYYY)")
        nights = int(params.get("nights", 1) or 1)
        start_iso = self._to_iso_date(date_str)
        # Camis uses check-in/check-out semantics: endDate is the CHECKOUT day
        # (start + nights), matching the Angular funnel's own
        # /create-booking/results URLs. startDate == endDate is rejected with
        # HTTP 400 — hit live by the first 1-night watch job in HH-103 (the
        # HH-99/102 probes all used ≥2 nights, which masked it). The response
        # arrays span [start, end] inclusive, so only the first ``nights``
        # entries describe the stay — ``_open_link_ids`` /
        # ``_classify_site_days`` slice accordingly.
        end_iso = (
            datetime.strptime(date_str, "%d/%m/%Y") + timedelta(days=nights)
        ).strftime("%Y-%m-%d")

        query: dict[str, Any] = {
            "resourceLocationId": int(rl_id),
            "mapId": int(map_id),
            "bookingCategoryId": int(category_id),
            "startDate": start_iso,
            "endDate": end_iso,
            "getDailyAvailability": "true",
        }

        # THR-132: equipment filter — sent by EVERY Camis adapter now (all
        # three sites share the enum and accept the params; verified live
        # 2026-07-08), driven by the ``equipment`` Form field via
        # ``_resolve_params`` with the class default as the fallback for jobs
        # saved before the field existed. Skipped for the categories in
        # ``_NON_EQUIPMENT_BOOKING_CATEGORY_IDS`` (THR-131: Parks Canada's
        # Accommodation — the huts — take no equipment; a tent size is a
        # semantic no-op there). ``numEquipment`` stays 0: the fit-filter
        # engages via ``subEquipmentCategoryId`` alone (live: an RV-over-35ft
        # sub still zeroes out tent-only sites with numEquipment=0), so the
        # count doesn't change results and 0 preserves the exact shape Parks
        # Canada was already confirmed on.
        if int(category_id) not in self._NON_EQUIPMENT_BOOKING_CATEGORY_IDS:
            equipment_category_id = params.get(
                "equipment_category_id", self.DEFAULT_EQUIPMENT_CATEGORY_ID
            )
            sub_equipment_category_id = params.get(
                "sub_equipment_category_id", self.DEFAULT_SUB_EQUIPMENT_CATEGORY_ID
            )
            if equipment_category_id is not None:
                query["isReserving"] = "true"
                query["filterData"] = "[]"
                query["numEquipment"] = 0
                query["equipmentCategoryId"] = int(equipment_category_id)
                if sub_equipment_category_id is not None:
                    query["subEquipmentCategoryId"] = int(sub_equipment_category_id)

        # THR-131: party-size capacity applies to BOTH campsites and
        # accommodations (both use capacityCategoryId -32767, honored live for
        # each). Unlike equipment, it stays PC-only — gated on
        # ``DEFAULT_CAPACITY_CATEGORY_ID`` (None on BC/Ontario, which were
        # never confirmed to accept it). It MUST be a JSON *string*, not a
        # Python list-of-dict: the live API accepts
        # ``peopleCapacityCategoryCounts=[{...}]`` (URL-encoded JSON array) and
        # 400s on a bare object, and neither httpx nor Playwright can encode a
        # nested list/dict query value — the previous ``= [{...}]`` serialized
        # to a Python repr and 400'd the availability read (masked on the
        # campsite path only because production drove it through a browser
        # context that dropped the malformed param). ``json.dumps`` makes it a
        # scalar string both transports encode identically and correctly.
        if self.DEFAULT_CAPACITY_CATEGORY_ID is not None:
            people = params.get("people")
            try:
                party_size = int(people) if people not in (None, "") else None
            except (TypeError, ValueError):
                party_size = None
            if party_size:
                query["peopleCapacityCategoryCounts"] = json.dumps([{
                    "capacityCategoryId": self.DEFAULT_CAPACITY_CATEGORY_ID,
                    "subCapacityCategoryId": None,
                    "count": party_size,
                }])

        return query

    async def _get_map_availability(self, page: Page | None, query: dict) -> dict:
        """GET ``/api/availability/map``.

        Prefers the Playwright browser context (``page.context.request``) so the
        call carries the same cookies / Queue-it pass and TLS fingerprint as the
        warmed page — the most WAF-resilient path. Falls back to ``fetch_json``
        (httpx) when no page is supplied, e.g. in unit tests.
        """
        if page is not None:
            response = await page.context.request.get(
                self.api_url(self.API_AVAILABILITY_MAP), params=query
            )
            if not response.ok:
                raise RuntimeError(
                    f"availability/map returned HTTP {response.status} for {query}"
                )
            return await response.json()
        return await self.fetch_json(self.API_AVAILABILITY_MAP, params=query)

    @staticmethod
    def _extract_site_days(data: Any) -> dict[str, list[int]]:
        """``resourceAvailabilities`` → ``{resource_id: [per-day codes]}``.

        Day entries arrive as ``{"availability": <code>, "remainingQuota": …}``
        objects; tolerate bare ints in case another Camis build flattens them.
        """
        out: dict[str, list[int]] = {}
        for rid, days in ((data or {}).get("resourceAvailabilities") or {}).items():
            codes: list[int] = []
            for day in days or []:
                raw = day.get("availability") if isinstance(day, dict) else day
                try:
                    codes.append(int(raw))
                except (TypeError, ValueError):
                    codes.append(-1)  # unreadable → never counts as available
            out[str(rid)] = codes
        return out

    def _open_link_ids(self, data: Any, nights: int) -> list[str]:
        """Child map ids from ``mapLinkAvailabilities`` with ≥1 available night.

        Day arrays span check-in through checkout inclusive; only the first
        ``nights`` entries are stay nights, so the trailing checkout-day code
        is ignored (a loop free only on the checkout day is not bookable).

        THR-129 Finding A: this is no longer used to decide what to SKIP
        drilling — live recon proved a link's own aggregate can be non-zero
        while still hiding a code-0 descendant several levels down, so a
        "closed" aggregate can't be trusted. It's used only to PRIORITISE
        which links ``_collect_site_days`` visits first (so a request-cap
        cutoff still finds real availability before it finds confirmation of
        unavailability), and by the hold funnel's best-effort loop pick
        (``_open_loop_map_id``), where a wrong guess just costs a worse
        landing page, not a data-integrity bug.
        """
        links = (data or {}).get("mapLinkAvailabilities") or {}
        return [
            link_id
            for link_id, days in links.items()
            if any(c == self.AVAILABILITY_AVAILABLE_CODE for c in (days or [])[:nights])
        ]

    def _drill_children(self, node: Any, nights: int) -> list[str]:
        """All child link ids under ``node``, open-looking ones first.

        Helper for ``_collect_site_days``'s breadth-first drill (Finding A).
        """
        all_ids = list(((node or {}).get("mapLinkAvailabilities") or {}).keys())
        open_ids = self._open_link_ids(node, nights)
        open_set = set(open_ids)
        return open_ids + [link_id for link_id in all_ids if link_id not in open_set]

    async def _collect_site_days(
        self, page: Page | None, query: dict, data: Any, nights: int
    ) -> dict[str, list[int]]:
        """Gather per-site day codes for a park, drilling into loop maps.

        A query at the park's root map usually returns only per-loop
        aggregates (``mapLinkAvailabilities``); per-site codes
        (``resourceAvailabilities``) appear when querying a leaf (loop) map.

        THR-129 Finding A: live recon against Pukaskwa (root map
        -2147483279, 2026-07-23) proved a loop's own aggregate can't be
        trusted to decide whether it's worth drilling — the root reported
        code 1 ("unavailable-ish") for the Hattie Cove loop, but that loop's
        OWN ``mapLinkAvailabilities`` contained a grandchild loop
        (Hattie Cove Campground) reporting code 0. The previous drill only
        followed links whose own code equalled ``AVAILABILITY_AVAILABLE_CODE``
        and would have stopped at the root without ever seeing it. Every
        discovered link is now drilled — breadth-first, open-looking links
        first so a request-cap cutoff still finds real availability first —
        bounded by ``_MAX_DRILL_REQUESTS`` (raised to 40 to cover Parks
        Canada's 3-level nesting).
        """
        sites = self._extract_site_days(data)
        queue = self._drill_children(data, nights)
        seen = set(queue)
        requests = 0
        while queue and requests < self._MAX_DRILL_REQUESTS:
            link_id = queue.pop(0)
            sub = await self._get_map_availability(
                page, {**query, "mapId": int(link_id)}
            )
            requests += 1
            sites.update(self._extract_site_days(sub))
            for child_id in self._drill_children(sub, nights):
                if child_id not in seen:
                    seen.add(child_id)
                    queue.append(child_id)
        return sites

    # THR-129 Finding B: Camis's site-level availability code is a 6-state
    # enum per the UI legend (Available/green, Partial Availability/purple,
    # Restrictions/orange, Unavailable/red, Not Operating/black, Held in
    # Cart/blue), but only a subset was confirmed against a live response
    # (Pukaskwa, 2026-07-07): 0=Available, 1=Unavailable, 3=Restrictions
    # (verified live: clicking one of these sites yields "is not reservable
    # ... Select a reservable location to continue"), 5=booked-out (observed
    # on already-reserved oTENTiks), 6=Not Operating. Codes 2/4 (Partial
    # Availability / Held in Cart per the legend) were never observed live
    # and are labelled generically below. This mapping is for READABLE
    # evidence text only — ``AVAILABILITY_AVAILABLE_CODE`` still treats
    # everything but 0 as "not bookable" (the correct conservative default).
    _SITE_STATE_LABELS = {
        0: "available",
        1: "unavailable",
        2: "partially available",
        3: "restricted",
        4: "held in cart",
        5: "booked out",
        6: "not operating",
    }

    # THR-133: the live-confirmed "Restrictions" code (THR-129 Finding B
    # above) — a site in this state has capacity but the requested stay
    # pattern (arrival/departure changeover, min/max-stay) isn't bookable,
    # unlike a genuinely sold-out (1/5) or closed (6) site.
    AVAILABILITY_RESTRICTED_CODE = 3

    @classmethod
    def _site_state_label(cls, code: int) -> str:
        return cls._SITE_STATE_LABELS.get(code, f"code {code}")

    @classmethod
    def _summarize_site_states(cls, stay: dict[str, list[int]]) -> str:
        """Human-readable breakdown of site states, e.g. "67 sites
        restricted, 5 booked out" — instead of dumping a raw aggregate dict
        (THR-129 Finding B). Sites whose stay-night codes aren't uniform are
        grouped as "mixed across the stay" rather than picking one code
        arbitrarily.
        """
        counts: dict[str, int] = {}
        order: list[str] = []
        for codes in stay.values():
            if not codes:
                continue
            label = (
                cls._site_state_label(codes[0])
                if len(set(codes)) == 1
                else "mixed across the stay"
            )
            if label not in counts:
                order.append(label)
            counts[label] = counts.get(label, 0) + 1
        return ", ".join(
            f"{counts[label]} site{'s' if counts[label] != 1 else ''} {label}"
            for label in order
        )

    def _classify_site_days(
        self, site_days: dict[str, list[int]], site: str, nights: int
    ) -> AvailabilityResult:
        """Map per-site day codes to an ``AvailabilityResult``.

        Only the first ``nights`` codes of each array are stay nights (the
        response includes the checkout day). A stay is only bookable on a
        single site, so:
        - ≥1 site available (code 0) every night → AVAILABLE (count = such sites)
        - no full-stay site but some site/night available → PARTIALLY_AVAILABLE
          (e.g. different sites free on different nights, or part of the stay)
        - nothing available, and every code present is the restricted code
          (THR-133: arrival/departure changeover or min/max-stay, not sold
          out) → RESTRICTED
        - nothing available otherwise (sold out/closed, or restricted mixed
          with a genuinely sold-out/closed site) → UNAVAILABLE
        - no per-site data → UNKNOWN
        """
        if not site_days:
            return AvailabilityResult(
                site=site,
                status=AvailabilityStatus.UNKNOWN,
                evidence="no per-site availability returned for this resource location",
            )
        ok = self.AVAILABILITY_AVAILABLE_CODE
        stay = {rid: codes[:nights] for rid, codes in site_days.items()}
        full_stay = [
            rid for rid, codes in stay.items()
            if codes and all(c == ok for c in codes)
        ]
        any_night = sum(
            1 for codes in stay.values() if any(c == ok for c in codes)
        )
        if full_stay:
            status = AvailabilityStatus.AVAILABLE
        elif any_night:
            status = AvailabilityStatus.PARTIALLY_AVAILABLE
        else:
            all_codes = {c for codes in stay.values() for c in codes}
            if all_codes == {self.AVAILABILITY_RESTRICTED_CODE}:
                status = AvailabilityStatus.RESTRICTED
            else:
                status = AvailabilityStatus.UNAVAILABLE
        return AvailabilityResult(
            site=site,
            status=status,
            evidence=(
                f"{self._summarize_site_states(stay)} "
                f"({len(full_stay)}/{len(site_days)} sites free for the full "
                f"{nights}-night stay, {any_night} with ≥1 free night)"
            ),
            total_available=len(full_stay),
        )

    def _results_deep_link(self, params: dict) -> str | None:
        """Build the ``/create-booking/results`` deep-link for the requested
        park/dates (THR-129 Finding E) — confirmed live and fully
        URL-driven, no form interaction required:
        ``{base_url}/create-booking/results?resourceLocationId={rl}&mapId={
        root_map_id}&searchTabGroupId=0&bookingCategoryId={cat}&startDate=
        YYYY-MM-DD&endDate=YYYY-MM-DD&nights={n}&partySize={p}``. Returns
        ``None`` when the params can't be resolved yet (e.g. no park
        selected), in which case the bare homepage snapshot is all we can
        show.
        """
        resolved = self._resolve_params(params)
        try:
            query = self._build_availability_query(resolved)
        except (ValueError, KeyError):
            return None
        nights = int(resolved.get("nights", 1) or 1)
        people = resolved.get("people")
        try:
            party_size = int(people) if people not in (None, "") else 1
        except (TypeError, ValueError):
            party_size = 1
        return (
            f"{self.base_url}/create-booking/results"
            f"?resourceLocationId={query['resourceLocationId']}"
            f"&mapId={query['mapId']}"
            f"&searchTabGroupId=0"
            f"&bookingCategoryId={query['bookingCategoryId']}"
            f"&startDate={query['startDate']}"
            f"&endDate={query['endDate']}"
            f"&nights={nights}"
            f"&partySize={party_size}"
        )

    def results_url(self, params: dict) -> str | None:
        """THR-129 item 2: public wrapper around ``_results_deep_link`` so
        job serialization can surface a park link in the ShowJob info bar
        without reaching into the adapter's private helper. Same
        fails-soft-to-None contract as the private method (unresolvable
        params, e.g. no park selected yet)."""
        return self._results_deep_link(params)

    async def fill_form(self, page: Page, params: dict) -> None:
        """Warm the browser context and snapshot the search results.

        Availability itself comes from the JSON API in ``detect_availability``;
        this navigates to the site (clearing Queue-it if present) so the
        context carries valid cookies for the subsequent API call. THR-129
        Finding E: previously this snapshotted the bare homepage — for an
        UNAVAILABLE result the artifact showed today's date and "All
        Locations", which reads as "the worker never searched" even though
        the JSON query itself was correct. Navigate on to the real,
        fully URL-driven results deep-link when the params resolve, so the
        snapshot shows the park/dates actually queried; fails soft to the
        homepage snapshot otherwise.
        """
        await page.goto(self.base_url, wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        await self._dismiss_site_cookie_banner(page)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            pass

        # The banner can render after networkidle on a slow connection —
        # check once more now that the page has settled, before the JSON
        # availability calls that reuse this context.
        await self._dismiss_site_cookie_banner(page)

        results_url = self._results_deep_link(params)
        if results_url is not None:
            try:
                await page.goto(results_url, wait_until="domcontentloaded", timeout=60_000)
                await page.wait_for_load_state("networkidle", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            except Exception as exc:
                logger.warning(
                    "could not navigate to Camis results deep-link %s: %s",
                    results_url, exc,
                )

        await self.snapshot(page, "camis_search")

    async def detect_availability(
        self, page: Page | None, params: dict
    ) -> list[AvailabilityResult]:
        """Read park availability for the requested dates from the JSON API.

        One watch job → one park (resource location). Queries the park's map
        and drills into every discovered loop (bounded by
        ``_MAX_DRILL_REQUESTS``, open-looking loops first) for per-site
        codes — a stay is only real if a single site is free every night
        (day-wise aggregates can show "available" when no site covers the
        whole stay). THR-129 Finding A: this used to short-circuit straight
        to UNAVAILABLE whenever no loop's own aggregate looked open, without
        drilling at all — live recon proved that aggregate can't be trusted
        (a non-zero parent can still hide a code-0 descendant), so that
        short-circuit is gone; ``_collect_site_days`` always drills, bounded
        by the request cap. Returns a single-element list to match
        ``BaseAdapter``'s contract; callers already handle the
        all/any/partial cases generically.
        """
        params = self._resolve_params(params)
        park = self._park_by_resource_location_id(int(params["resource_location_id"])) \
            if params.get("resource_location_id") is not None else None
        site_name = (park or {}).get("full_name") or str(params.get("resource_location_id", "(unknown park)"))

        # THR-126 (fixes THR-124 §4b): a date outside the computed booking
        # window can never be AVAILABLE, no matter what the availability/map
        # codes say. Recon confirmed beyond-window dates can still return
        # site-level code 0 ("available") even though the UI shows every
        # site Closed — that's exactly how the poll worker false-positived
        # into a hold attempt on a not-yet-released Golden Ears date.
        # check_booking_window fails open on any lookup hiccup (missing
        # params, network error, unparseable response), so this can only
        # ever make an otherwise-AVAILABLE result MORE conservative, never
        # less — it never invents unavailability the site itself wouldn't.
        #
        # Calls the PUBLIC check_booking_window/check_stay_pattern (each a
        # thin wrapper over the shared _check_dateschedule fetch+parse)
        # rather than _check_dateschedule directly — subclasses/tests that
        # monkeypatch either public method must still take effect here.
        # This does mean two /api/dateschedule fetches per poll when a stay
        # pattern needs checking; acceptable next to correctness/testability.
        try:
            window = await self.check_booking_window(params)
        except Exception as exc:
            logger.warning(
                "booking-window check failed during detect_availability for "
                "resource_location_id=%s: %s — proceeding without the window gate",
                params.get("resource_location_id"), exc,
            )
            window = BookingWindowInfo(is_open=True)
        if not window.is_open:
            opens_at_text = window.opens_at.isoformat() if window.opens_at else "an unconfirmed date"
            return [AvailabilityResult(
                site=site_name,
                status=AvailabilityStatus.UNAVAILABLE,
                evidence=f"outside the booking window (opens {opens_at_text}): {window.evidence}",
                total_available=0,
            )]

        # THR-133: a stay pattern the site's own rules reject (arrival/
        # departure changeover, min/max-stay) can never be AVAILABLE either,
        # regardless of capacity — and unlike UNAVAILABLE, this is
        # RESTRICTED (adjusting dates/nights could still work), with a
        # reason that names the actual constraint instead of a generic
        # "no bookable site found." Fails open the same way the window
        # check above does — a broken lookup must never invent a
        # restriction the site itself wouldn't report.
        try:
            stay_pattern = await self.check_stay_pattern(params)
        except Exception as exc:
            logger.warning(
                "stay-pattern check failed during detect_availability for "
                "resource_location_id=%s: %s — proceeding without the stay-pattern gate",
                params.get("resource_location_id"), exc,
            )
            stay_pattern = StayPatternInfo(is_compliant=True)
        if not stay_pattern.is_compliant:
            return [AvailabilityResult(
                site=site_name,
                status=AvailabilityStatus.RESTRICTED,
                evidence=f"stay pattern not bookable: {stay_pattern.evidence}",
                total_available=0,
            )]

        try:
            query = self._build_availability_query(params)
        except (ValueError, KeyError) as e:
            return [AvailabilityResult(
                site=site_name, status=AvailabilityStatus.UNKNOWN, evidence=str(e),
            )]

        nights = int(params.get("nights", 1) or 1)
        data = await self._get_map_availability(page, query)
        links = (data or {}).get("mapLinkAvailabilities") or {}
        has_sites = bool((data or {}).get("resourceAvailabilities"))
        if not links and not has_sites:
            return [AvailabilityResult(
                site=site_name,
                status=AvailabilityStatus.UNKNOWN,
                evidence="availability/map returned no links or site data for this park",
            )]

        # THR-129 Finding A: no fast-path short-circuit here anymore — a
        # loop's own aggregate can't be trusted to mean "nothing available"
        # (live Pukaskwa recon: a code-1 parent hid a code-0 grandchild two
        # levels down), so every loop is always drilled, bounded by
        # _MAX_DRILL_REQUESTS, rather than skipped the moment none look open
        # at the top.
        site_days = await self._collect_site_days(page, query, data, nights)
        return [self._classify_site_days(site_days, site_name, nights)]

    # ------------------------------------------------------------------
    # Cart / hold flow — funnel confirmed end-to-end on live BC Parks (HH-103)
    #
    #   login → /create-booking/results for the park at an OPEN LOOP's mapId
    #   (JSON-first: pick a loop that detect_availability found available, so we
    #   land on the per-site list, not the park's loop overview) → set the
    #   search-form Equipment dropdown (a site refuses to reserve until an
    #   equipment type is chosen) → switch to LIST view (a Material expansion
    #   panel per site — far more automatable than the Leaflet map, which has no
    #   semantic per-site markers) → expand the first available site → Reserve
    #   (``POST /api/cart/commit``) → the "Review Reservation Details" page
    #   (/create-booking/reservationmessages): tick the acknowledgement
    #   checkboxes → "Confirm reservation details" (#confirmReservationDetails)
    #   → /cart with the item held → "Proceed to checkout" (#proceedToCheckout)
    #   → payment (the noVNC hand-off). ``_persist_cart_session`` parks it.
    #
    # HH-100's implementation was a false positive: its "available cell" selector
    # ("Available for all selected dates") actually matched the availability
    # LEGEND's tooltip trigger, so it clicked nothing, and its success check was
    # a URL substring (``create-booking``) that the results URL satisfies
    # trivially — so it reported held=True with an empty cart. HH-103 replaces
    # both: real site selection via the list panel, and hold verification via
    # the DOM cart badge (``/api/cart`` reads empty from a fresh request context
    # because the cart lives in the Angular app's session store).
    # ------------------------------------------------------------------

    # First allowed-equipment option to auto-select when the job doesn't specify
    # one. Camis blocks Reserve until equipment is chosen; a single tent is the
    # least-constrained frontcountry option and valid for every campsite. The
    # wording is per-site — BC says "1 Tent", Ontario "Single Tent" (HH-105) —
    # so match both; ``_select_equipment`` falls back to the first option.
    _DEFAULT_EQUIPMENT_RE = re.compile(r"(?:1|single)\s+tent", re.I)

    # THR-127: the "Cannot Reserve" modal's wording confirmed live (BC Parks,
    # Golden Ears repro): "Reserving these dates is not yet allowed. These
    # dates cannot be reserved until {date} at {time} UTC." Matched loosely
    # (either phrase alone is enough) so a minor copy tweak on either site
    # doesn't silently stop being recognized.
    _CANNOT_RESERVE_RE = re.compile(r"not yet allowed|cannot be reserved until", re.I)

    async def _detect_window_closed_modal(self, page: Page) -> bool:
        """Best-effort check for the booking-window "Cannot Reserve" modal
        that can block the funnel right after clicking Reserve on an
        in-season-but-unreleased date (see ``_CANNOT_RESERVE_RE``).

        Fails closed on any read error (returns ``False``) so a page-read
        hiccup falls through to the existing generic "could not confirm"
        Hold Failed message rather than silently mis-reporting a real,
        different failure as a window-closed one.
        """
        try:
            text = await page.locator("body").inner_text()
        except Exception:
            return False
        return bool(self._CANNOT_RESERVE_RE.search(text or ""))

    @classmethod
    def occupant_fields(cls) -> list[OccupantField]:
        """Occupant fields collected during the Camis booking.

        Unlike the DOC flow (per-person name/age/category), Camis takes party
        size and equipment during search; there is no adapter-specific field
        left to collect per camper.

        THR-129 item 3: this used to also declare a ``permit_holder`` text
        field, but the Review Reservation Details page shows the signed-in
        account's OWN occupant as the named permit holder — the site never
        reads back whatever the user typed here, so it was purely redundant
        re-entry of a camper's own name, validated (``_validate_adapter_values_
        payload`` / ``_validate_job_occupants_for_adapter`` in
        ``app.api._route_deps``) but never consumed by ``attempt_hold``. The
        name is now derived from the occupant snapshot instead — see
        ``resolve_permit_holder_name``. Existing occupant snapshots/adapter-
        value rows with a leftover ``permit_holder`` key keep loading fine;
        the key is just ignored (nothing here reads it anymore).
        """
        return []

    # THR-129 item 3: job param key holding the id of the occupant (from the
    # job's `occupants` snapshot list) designated as the Camis permit holder
    # when the job has more than one camper. Set by the job wizard's holder
    # picker; absent/stale/single-occupant jobs fall back to the first
    # occupant (see resolve_permit_holder_name) — this must never raise on a
    # missing or unrecognised id, only degrade to that default.
    PERMIT_HOLDER_OCCUPANT_ID_PARAM = "permit_holder_occupant_id"

    @classmethod
    def resolve_permit_holder_name(cls, params: dict) -> str | None:
        """Derive the permit-holder display name from the job's occupant
        snapshot (THR-129 item 3).

        ``params["occupants"]`` holds the snapshot dicts built by
        ``buildCurrentOccupantSnapshot`` (frontend) / validated by
        ``_validate_job_occupants_for_adapter`` (backend) — each has at
        least ``id``, ``first_name``, ``last_name``. Selection:
          - no occupants → ``None`` (nothing to derive).
          - exactly one occupant → that occupant, unambiguously.
          - more than one → the occupant whose ``id`` matches
            ``params[PERMIT_HOLDER_OCCUPANT_ID_PARAM]``; falls back to the
            FIRST occupant in the list when that key is absent or doesn't
            match anyone currently selected (covers jobs saved before this
            field existed, and a picked holder who's since been deselected)
            — this mirrors the job wizard's own default.

        Consumed wherever a permit-holder name is needed, including the
        future session-linked checkout flow (not yet implemented — see the
        module docstring's HH-100 note); not currently read by
        ``attempt_hold`` since the funnel doesn't type a name anywhere today.
        """
        occupants = params.get("occupants")
        if not isinstance(occupants, list) or not occupants:
            return None
        valid = [o for o in occupants if isinstance(o, dict)]
        if not valid:
            return None
        if len(valid) == 1:
            chosen = valid[0]
        else:
            wanted_id = params.get(cls.PERMIT_HOLDER_OCCUPANT_ID_PARAM)
            chosen = next(
                (o for o in valid if wanted_id is not None and o.get("id") == wanted_id),
                valid[0],
            )
        first = str(chosen.get("first_name", "")).strip()
        last = str(chosen.get("last_name", "")).strip()
        name = f"{first} {last}".strip()
        return name or None

    async def _cart_item_count(self, page: Page) -> int:
        """Read the header cart badge ("N Item(s)") — the source of truth for a
        held cart. ``/api/cart`` can't be used: fetched from a fresh request
        context it returns an empty cart because the committed booking lives in
        the Angular app's in-memory session, not the REST cart snapshot."""
        txt = await page.evaluate(
            "() => (document.querySelector('#viewShoppingCartButton, #viewShoppingCart')"
            " || {}).innerText || ''"
        )
        m = re.search(r"(\d+)\s*Item", txt or "")
        return int(m.group(1)) if m else 0

    async def _open_loop_map_id(self, page: Page | None, query: dict, nights: int) -> int:
        """Return a loop (child map) id under the park that has an available
        night, or the park map id if none can be resolved. Reuses the same
        availability read as detect_availability so the hold lands directly on
        a site list instead of the park's loop overview."""
        try:
            data = await self._get_map_availability(page, query)
        except Exception:
            return query["mapId"]
        open_loops = self._open_link_ids(data, nights)
        return int(open_loops[0]) if open_loops else query["mapId"]

    async def _dismiss_park_alerts(self, page: Page) -> bool:
        """Dismiss the "Park Alerts" interstitial modal some parks gate the
        results page behind (e.g. Algonquin's invasive-species notice — HH-105).
        It overlays the map and intercepts pointer events, so the whole funnel
        stalls until it's acknowledged. Best-effort; returns whether one was
        dismissed. Safe to call repeatedly — no-op when absent."""
        for name in (r"^\s*Acknowledge\s*$", r"^\s*(OK|I understand|Continue)\s*$"):
            btn = page.get_by_role("button", name=re.compile(name, re.I))
            try:
                if await btn.count() and await btn.first.is_visible():
                    await btn.first.click()
                    await page.wait_for_timeout(1_000)
                    return True
            except PlaywrightTimeoutError:
                continue
        return False

    # MISC: BC Parks added a second, site-wide cookie-consent banner ("This
    # website uses cookies to keep your information secure...I Consent") that
    # is distinct from the Camis-app login gate this class already handles
    # (``#consentButton`` / ``#login-cookie-consent``, see
    # ``_accept_cookie_consent`` above). This one is a BC.gov-wide notice that
    # can render on any page — home, search results, login — and per its own
    # copy the site withholds functionality (including "make a reservation")
    # until it's dismissed, which is exactly why it was seen blocking
    # availability checks: ``fill_form`` never accepted it, so the JSON
    # availability calls that reuse the same browser context ran without the
    # consent cookie the site expects. Dismissed as early as possible on
    # every page load rather than once at login.
    _SITE_COOKIE_CONSENT_RE = re.compile(r"^\s*I\s*Consent\s*$", re.I)

    async def _dismiss_site_cookie_banner(self, page: Page) -> bool:
        """Dismiss the site-wide BC.gov cookie-consent banner if present.

        Best-effort and safe to call repeatedly — a no-op once the banner has
        already been dismissed (it sets a persistent cookie so it won't
        re-render for the rest of the browser context)."""
        btn = page.get_by_role("button", name=self._SITE_COOKIE_CONSENT_RE)
        try:
            if await btn.count() and await btn.first.is_visible():
                await btn.first.click()
                await page.wait_for_timeout(500)
                return True
        except PlaywrightTimeoutError:
            pass
        return False

    async def _select_equipment(self, page: Page) -> None:
        """Choose an allowed-equipment type in the search form (required before a
        site can be reserved). Prefers a single tent; falls back to the first
        option."""
        field = page.locator("#equipment-field")
        if await field.count() == 0:
            return
        await field.first.click()
        await page.wait_for_timeout(1_200)
        opt = page.get_by_role("option", name=self._DEFAULT_EQUIPMENT_RE)
        if await opt.count() == 0:
            opt = page.get_by_role("option")
        await opt.first.click()
        await page.wait_for_timeout(800)
        search = page.locator("#actionSearch")
        if await search.count():
            await search.first.click(force=True)
            await page.wait_for_timeout(5_000)

    async def attempt_hold(self, page: Page, params: dict) -> BookingResult:
        """Drive the confirmed Camis funnel to place a real cart hold, verify it
        via the cart badge, and park the session for the noVNC payment hand-off.

        Fails closed: returns ``held=False`` with a snapshot at every step it
        can't confirm, and only reports ``held=True`` once the header cart badge
        shows a held item on the /cart page — so the hold worker never reports a
        hold that didn't happen.
        """
        params = self._resolve_params(params)
        job_id = params.get("_job_id", "unknown")
        try:
            query = self._build_availability_query(params)
        except (ValueError, KeyError) as e:
            return BookingResult(success=False, held=False, message=str(e))
        nights = int(params.get("nights", 1) or 1)

        park = self._park_by_resource_location_id(query["resourceLocationId"])
        site_name = (park or {}).get("full_name") or str(query["resourceLocationId"])

        # 1. Authenticate (the cart is account-scoped).
        #
        # THR-126 (fixes THR-122 §2): this used to catch RuntimeError here and
        # report it as a clean BookingResult(held=False) "Hold Failed" — which
        # is exactly why the noVNC takeover never fired for a stuck consent
        # banner: attempt_hold() swallowed the failure before hold_worker's
        # takeover except-block ever saw it. Login is no longer attempted here
        # unless the credential already PASSED verify_credentials_task (the
        # hold worker skips straight to a clean BookingResult before ever
        # opening a browser when the stored credential is missing or FAILED —
        # see attempt_hold_task). So a rejection THIS deep in the funnel means
        # something changed since it verified, or the site hit an unexpected
        # state (stuck consent gate, a redesigned login form) — either way a
        # human should look at it via takeover, not have the hold silently
        # reported as failed. Any exception from _login (RuntimeError,
        # UnexpectedHoldFailure, a bare Playwright timeout) is now left to
        # propagate to the hold worker's takeover handler.
        #
        # THR-127: the one exception this deliberately does NOT catch here
        # either, but which the hold worker treats differently on the way
        # out, is CredentialsRejectedError — a CONFIRMED rejection (not an
        # unknown state) that should demote the credential and report a
        # clean Hold Failed instead of parking for takeover. See
        # attempt_hold_task's except-clause ordering.
        await self._login(page)

        # 2. Open the results page at an available loop map so the per-site list
        #    renders directly (JSON-first — skips the flaky Leaflet loop drill).
        loop_map_id = await self._open_loop_map_id(page, query, nights)
        results_url = (
            f"{self.base_url}/create-booking/results"
            f"?resourceLocationId={query['resourceLocationId']}&mapId={loop_map_id}"
            f"&bookingCategoryId={query['bookingCategoryId']}"
            f"&startDate={query['startDate']}&endDate={query['endDate']}"
        )
        await page.goto(results_url, wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        await self._dismiss_site_cookie_banner(page)
        await page.wait_for_timeout(6_000)
        # Some parks gate the results page behind a "Park Alerts" modal that
        # intercepts every click until acknowledged (Algonquin — HH-105).
        await self._dismiss_park_alerts(page)
        await self.snapshot(page, "camis_results")

        # 3. Pick equipment (required) and switch to the list view.
        await self._select_equipment(page)
        list_toggle = page.locator("[aria-label='List view of results']")
        if await list_toggle.count():
            await list_toggle.first.click(force=True)
            await page.wait_for_timeout(4_000)

        # 4. Expand the first available site and Reserve it. Available rows carry
        #    a `.resource-availability .icon-available` marker; each has a
        #    `#details-N` expander and, once open, a `[id^=reserveButton]`.
        if await page.locator(".resource-availability .icon-available").count() == 0:
            await self.snapshot(page, "camis_no_available_site")
            return BookingResult(
                success=False, held=False,
                message=f"No bookable site found for {site_name} on {params.get('date')}",
            )
        await page.locator("#details-0").first.click(force=True)
        await page.wait_for_timeout(3_000)
        reserve = page.locator("mat-expansion-panel.mat-expanded [id^=reserveButton]")
        if await reserve.count() == 0:
            # THR-126: an "available" site with no Reserve control is an
            # unexpected page state this deep in the funnel (equipment not
            # set, a layout change) rather than a known clean negative — park
            # for takeover instead of a silent Hold Failed (ticket §2 audit).
            await self.snapshot(page, "camis_no_reserve_button")
            raise UnexpectedHoldFailure(
                "Expanded a site but found no Reserve control (equipment not set?)"
            )
        await reserve.first.click(force=True)
        await page.wait_for_timeout(6_000)
        # A Park Alerts modal can re-appear on the way to the review page.
        await self._dismiss_park_alerts(page)
        await self.snapshot(page, "camis_reservation_messages")

        # 5. Review Reservation Details: accept acknowledgements, confirm.
        for checkbox in await page.locator("input[type=checkbox]").all():
            try:
                if await checkbox.is_visible():
                    await checkbox.click(force=True)
            except PlaywrightTimeoutError:
                continue
        confirm = page.locator("#confirmReservationDetails")
        if await confirm.count() == 0:
            confirm = page.get_by_role("button", name=re.compile(r"confirm reservation", re.I))
        if await confirm.count() == 0:
            # THR-127: the "Cannot Reserve ... not yet allowed" modal blocks
            # the funnel right here on an in-season-but-unreleased date —
            # this used to fall straight through to the generic "could not
            # confirm" message below, which is exactly how the live Golden
            # Ears hold died silently as a plain Hold Failed instead of
            # self-healing back to AWAITING_WINDOW. Recompute the window
            # (rather than parsing the modal's own locale-formatted date
            # text) and let the hold worker map it accordingly.
            if await self._detect_window_closed_modal(page):
                await self.snapshot(page, "camis_cannot_reserve_window_closed")
                window = await self.check_booking_window(params)
                raise BookingWindowClosedDuringHold(window)
            await self.snapshot(page, "camis_no_confirm_button")
            return BookingResult(
                success=False, held=False,
                message="Reserved a site but could not confirm the reservation details",
            )
        await confirm.first.click(force=True)
        await page.wait_for_timeout(6_000)
        await self.snapshot(page, "camis_cart")

        # 6. Verify a real hold before proceeding: the cart badge must show an
        #    item and the /cart page must expose Proceed to Checkout.
        proceed = page.locator("#proceedToCheckout")
        if await self._cart_item_count(page) < 1 or await proceed.count() == 0:
            # THR-126: the browser is already deep in the funnel (past
            # Reserve + Confirm) — a missing cart item here is more likely an
            # unexpected mid-funnel hiccup than "availability dropped" in the
            # ordinary sense already handled earlier, so park for takeover
            # rather than reporting a plain Hold Failed (ticket §2 audit).
            await self.snapshot(page, "camis_hold_not_confirmed")
            raise UnexpectedHoldFailure(
                "Reservation did not land in the cart — availability may have "
                "dropped, or the confirm step silently failed"
            )

        # 7. Proceed to the payment page (the noVNC hand-off point) and park it.
        await proceed.first.click()
        await page.wait_for_timeout(6_000)
        await self.snapshot(page, "camis_checkout")

        resume_url = await self._persist_cart_session(page, job_id, page.url)
        return BookingResult(
            success=True,
            held=True,
            reservation_url=resume_url,
            message=(
                f"Cart secured for {site_name} on {params.get('date')}. "
                "Complete payment before the Camis cart expires."
            ),
        )

    # ------------------------------------------------------------------
    # Queue-it waiting room
    # ------------------------------------------------------------------

    async def _pass_queue_it(self, page: Page, settle_ms: int = 2_000) -> bool:
        """Best-effort wait for the Queue-it waiting room to release the page.

        Camis fronts high-demand traffic with Queue-it (``customerId: camis`` —
        recon §5). When queued, the browser is redirected to a
        ``*.queue-it.net`` URL and returned to the target site once through.
        Playwright carries the pass cookie automatically; this helper just
        parks until the URL is no longer on the queue host.

        Returns ``True`` if a queue was observed and cleared, ``False`` if no
        queue was present. Polling cadence for the workers is deliberately
        conservative to avoid being queued in the first place.
        """
        if "queue-it.net" not in (page.url or ""):
            return False
        logger.info("Queue-it waiting room detected — waiting to be released")
        try:
            await page.wait_for_url(
                lambda url: "queue-it.net" not in url, timeout=15 * 60_000
            )
        except PlaywrightTimeoutError:
            await self.snapshot(page, "queue_it_timeout")
            raise RuntimeError("Queue-it waiting room did not release within 15 minutes")
        await page.wait_for_timeout(settle_ms)
        return True

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    # Selectors confirmed by driving the live BC Parks login (HH-100):
    #   /login route → cookie-consent gate → #email / #password → submit.
    # The submit BUTTON click alone does not post the form on the Angular page;
    # pressing Enter in the password field does (fires POST /api/auth/login).
    #
    # THR-122: the consent banner's own render timing is unpredictable — on a
    # slow load it can appear well after a fixed post-goto delay, and while
    # visible it covers #email so Locator.fill() times out waiting for it to
    # be actionable. There's no button-text match here (Ontario serves both
    # en-CA and fr-CA), so this stays ID-based; new consent IDs (a future
    # province, an A/B variant) just get appended to the tuple.
    #
    # THR-126 (fixes THR-122 §1, confirmed against a live hold failure):
    # ``#login-cookie-consent`` is almost certainly the banner's CONTAINER —
    # recon (HH-100, camis-recon.md:78) describes it as "the cookie-consent
    # gate" — not the "I consent" button itself. Clicking it lands on the
    # container (its paragraph text, typically), which does nothing: the
    # click "succeeds" (no exception) while the banner stays up and the
    # subsequent #email wait times out. ``#consentButton`` reads as the real
    # control, so it's tried FIRST; the container is kept as a fallback for a
    # build where it really is the clickable element (or delegates the click
    # to its child). ``_resolve_consent_click_target`` below is what actually
    # decides which one to click — ``_CONSENT_SELECTORS`` / ``_consent_locator``
    # stay as the combined "is *a* consent element present" check used by the
    # login race.
    _CONSENT_SELECTORS = ("#consentButton", "#login-cookie-consent")
    _EMAIL_SELECTOR = "#email"
    _PASSWORD_SELECTOR = "#password"

    def _consent_locator(self, page: Page):
        """A single locator matching any known consent-button selector."""
        selector = ", ".join(self._CONSENT_SELECTORS)
        return page.locator(selector).first

    async def _resolve_consent_click_target(self, page: Page):
        """Return the locator to actually click to dismiss the consent gate.

        THR-126: tries each known selector in preference order (real button
        first, container fallback last) and clicks whichever one is actually
        present/visible, instead of always clicking the combined locator's
        first DOM match (which could resolve to the container even when the
        real button selector is also present elsewhere on the page).
        """
        for selector in self._CONSENT_SELECTORS:
            candidate = page.locator(selector).first
            try:
                if await candidate.count() > 0 and await candidate.is_visible():
                    return candidate
            except PlaywrightTimeoutError:
                continue
        return self._consent_locator(page)

    async def _snapshot_consent_blocked(self, page: Page, label: str) -> None:
        """Snapshot the stuck consent banner for diagnosis (THR-126).

        In addition to the usual screenshot, this captures the banner
        container's ``outerHTML`` directly into the log so a future selector
        drift (a changed id, a re-templated banner) is diagnosable from the
        artifacts alone rather than requiring someone to reproduce it live.
        Best-effort — a failure here must never mask the real error.
        """
        await self.snapshot(page, label)
        try:
            html = await page.evaluate(
                "(sel) => { const el = document.querySelector(sel); "
                "return el ? el.outerHTML : null; }",
                self._CONSENT_SELECTORS[-1],
            )
            if html:
                logger.warning("Camis consent banner outerHTML at failure: %s", html[:4000])
        except Exception:
            pass

    async def _dismiss_consent_banner(self, page: Page, *, attempts: int = 3) -> bool:
        """Click the actual consent control and VERIFY the banner is gone.

        THR-126 (fixes THR-122 §1): the old code treated ``consent.click()``
        not raising as proof of dismissal. That's exactly how this bug
        shipped — clicking the container "succeeds" while the banner stays
        on screen. This re-checks the banner's own visibility after every
        click and retries up to ``attempts`` times (a mis-timed click can
        also just get swallowed) before giving up.

        Returns True once the banner is confirmed gone (hidden or no longer
        matching any known selector), False if it's still visible after
        every attempt.
        """
        for attempt in range(1, attempts + 1):
            target = await self._resolve_consent_click_target(page)
            try:
                await target.click()
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(600)
            still_visible = False
            try:
                combined = self._consent_locator(page)
                still_visible = await combined.count() > 0 and await combined.is_visible()
            except PlaywrightTimeoutError:
                still_visible = False
            if not still_visible:
                return True
            logger.warning(
                "Camis consent banner still visible after click attempt %d/%d",
                attempt, attempts,
            )
        return False

    async def _accept_cookie_consent(
        self, page: Page, *, timeout_ms: int = 15_000
    ) -> None:
        """Dismiss the cookie-consent gate that otherwise hides the login form.

        THR-122: replaces the old fixed 1.5s delay + single count()/is_visible()
        check, which missed banners that render later than 1.5s. Instead this
        polls (bounded to ``timeout_ms``, ~15s) for EITHER the consent button
        or ``#email`` to become visible — whichever shows up first.

        THR-126: if consent wins the race, dismissal is now VERIFIED
        (``_dismiss_consent_banner`` re-checks the banner's own visibility
        and retries) rather than assumed from the click not raising — see the
        module note above on why that assumption was wrong. Only once
        dismissal is confirmed does this wait for ``#email`` to become
        visible. Any unresolved case (banner won't dismiss, or dismisses but
        #email never shows, or neither ever appears at all) raises
        ``UnexpectedHoldFailure`` instead of ``RuntimeError`` — THR-122 fixed
        the race but a stuck banner here was still being swallowed by
        ``attempt_hold``'s login handler as a clean "login rejected" negative,
        so no takeover ever fired for it (THR-122 §2 in the THR-126 writeup).
        A snapshot (screenshot + banner outerHTML) is always taken first so
        the failure is diagnosable from artifacts alone.
        """
        consent = self._consent_locator(page)
        email = page.locator(self._EMAIL_SELECTOR)
        poll_ms = 250
        elapsed_ms = 0
        while elapsed_ms < timeout_ms:
            try:
                if await email.is_visible():
                    return
                if await consent.count() > 0 and await consent.is_visible():
                    dismissed = await self._dismiss_consent_banner(page)
                    if not dismissed:
                        await self._snapshot_consent_blocked(page, "camis_consent_blocked")
                        raise UnexpectedHoldFailure(
                            "Camis cookie-consent banner would not dismiss after "
                            "repeated clicks — the click target may have drifted "
                            "from the real 'I consent' control"
                        )
                    try:
                        await email.wait_for(state="visible", timeout=timeout_ms - elapsed_ms)
                    except PlaywrightTimeoutError:
                        await self._snapshot_consent_blocked(page, "camis_consent_blocked")
                        raise UnexpectedHoldFailure(
                            "Camis cookie-consent banner was dismissed but #email "
                            "never became visible"
                        )
                    return
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(poll_ms)
            elapsed_ms += poll_ms

        await self._snapshot_consent_blocked(page, "camis_consent_blocked")
        raise UnexpectedHoldFailure(
            "Camis login form did not become visible — cookie-consent banner "
            "may be blocking #email"
        )

    async def _is_logged_in(self, page: Page) -> bool:
        """True if the page shows a signed-in account affordance."""
        return await page.evaluate(
            """() => Array.from(document.querySelectorAll('button,a')).some(
                el => /sign ?out|log ?out|my purchases|welcome,/i.test(el.innerText || '')
            )"""
        )

    async def _login(self, page: Page) -> None:
        """Sign in to the Camis account with the bound credentials.

        Verified flow (HH-100, live BC Parks): navigate ``/login`` → accept the
        cookie-consent gate → fill ``#email`` / ``#password`` → press Enter (the
        Angular form does not submit on the button click alone) → the site posts
        ``/api/auth/login`` and redirects to ``/account``.

        THR-122: the consent gate can render later than a fixed delay allowed
        for, so ``_accept_cookie_consent`` now races consent-vs-``#email``
        instead of guessing a delay. It's checked once more immediately before
        the fill in case the banner re-renders (observed on a re-navigated
        ``/login``) between the earlier check and now.

        Raises ``RuntimeError`` if credentials are missing or login doesn't land.
        """
        credentials = self._login_credentials
        if credentials is None:
            raise RuntimeError("Camis login required but no stored credentials are configured")

        await page.goto(f"{self.base_url}/login", wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        await self._dismiss_site_cookie_banner(page)
        await self._accept_cookie_consent(page)

        # Re-check immediately before filling: a banner that re-renders after
        # the first check (e.g. a second consent prompt) would otherwise still
        # cover #email and time out the fill. THR-126: uses the same
        # verified-dismissal helper as the initial check rather than a bare
        # click, for the same reason (see _accept_cookie_consent).
        consent = self._consent_locator(page)
        if await consent.count() > 0 and await consent.is_visible():
            if not await self._dismiss_consent_banner(page):
                await self._snapshot_consent_blocked(page, "camis_consent_blocked")
                raise UnexpectedHoldFailure(
                    "Camis cookie-consent banner re-appeared before login and "
                    "would not dismiss"
                )
            await page.locator(self._EMAIL_SELECTOR).wait_for(state="visible", timeout=15_000)

        await page.locator(self._EMAIL_SELECTOR).fill(credentials.username)
        await page.locator(self._PASSWORD_SELECTOR).fill(credentials.password)
        await page.focus(self._PASSWORD_SELECTOR)
        await page.keyboard.press("Enter")

        try:
            await page.wait_for_url("**/account", timeout=20_000)
        except PlaywrightTimeoutError:
            if not await self._is_logged_in(page):
                await self.snapshot(page, "camis_login_failed")
                # THR-127: the form has been filled AND submitted, and there's
                # no redirect and no signed-in affordance — the same
                # FAILED-vs-INCONCLUSIVE signal verify_credentials trusts as a
                # confirmed rejection (see its docstring). A distinct
                # exception type (rather than string-matching RuntimeError)
                # lets the hold worker demote the stored credential and report
                # a clean Hold Failed instead of parking for takeover.
                raise CredentialsRejectedError(
                    "Camis login did not complete — check the stored credentials"
                )
        logger.info("Camis login successful")

    async def verify_credentials(self, page: Page) -> CredentialVerificationResult:
        """Drive just the sign-in steps (no booking funnel) to check the bound
        credentials, without the rest of ``_login``'s funnel-oriented framing.

        THR-123: distinguishes "login was rejected" (FAILED) from "the check
        itself couldn't complete" (INCONCLUSIVE) — queue-it, the consent gate,
        or navigation are all infra, not a verdict on the credential. Once the
        form has been filled and submitted, a non-redirect is the one signal
        we can trust as an actual rejection.
        """
        credentials = self._login_credentials
        if credentials is None:
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, "No stored credentials to verify"
            )

        try:
            await page.goto(f"{self.base_url}/login", wait_until="domcontentloaded", timeout=60_000)
            await self._pass_queue_it(page)
            await self._dismiss_site_cookie_banner(page)
            await self._accept_cookie_consent(page)

            # THR-126: same verified-dismissal helper as _login — this is the
            # root cause of THR-123's false INCONCLUSIVEs on valid credentials
            # (§3a): a bare consent.click() here could "succeed" while the
            # banner stayed up, so the fill below never found #email.
            consent = self._consent_locator(page)
            if await consent.count() > 0 and await consent.is_visible():
                if not await self._dismiss_consent_banner(page):
                    raise UnexpectedHoldFailure("Camis consent banner would not dismiss")
                await page.locator(self._EMAIL_SELECTOR).wait_for(state="visible", timeout=15_000)
        except Exception as e:
            await self.snapshot(page, "camis_verify_inconclusive")
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, f"Could not reach the login form: {e}"
            )

        try:
            await page.locator(self._EMAIL_SELECTOR).fill(credentials.username)
            await page.locator(self._PASSWORD_SELECTOR).fill(credentials.password)
            await page.focus(self._PASSWORD_SELECTOR)
            await page.keyboard.press("Enter")
        except Exception as e:
            await self.snapshot(page, "camis_verify_inconclusive")
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, f"Could not submit the login form: {e}"
            )

        try:
            await page.wait_for_url("**/account", timeout=20_000)
            return CredentialVerificationResult(VerificationStatus.VERIFIED, "Signed in successfully")
        except PlaywrightTimeoutError:
            if await self._is_logged_in(page):
                return CredentialVerificationResult(VerificationStatus.VERIFIED, "Signed in successfully")
            await self.snapshot(page, "camis_verify_failed")
            return CredentialVerificationResult(
                VerificationStatus.FAILED, "Login was rejected — check the stored username/password"
            )

    async def _login_if_prompted(self, page: Page, timeout_ms: int = 6_000) -> bool:
        """Log in only if the current page is showing the login form.

        THR-122: waiting on ``#email`` directly missed the case where a
        cookie-consent banner is covering the login form — the banner also
        counts as "the login form is present", so this races consent-vs-
        ``#email`` the same way ``_accept_cookie_consent`` does, instead of a
        bare ``wait_for`` on ``#email`` alone. A timeout here is the expected,
        silent "not on a login page" case (not an error), so it does not
        snapshot or raise — only ``_accept_cookie_consent``'s own bounded
        wait (invoked via ``_login`` below) does that once we've committed to
        logging in.

        Returns ``True`` if a login was performed, ``False`` if no form (nor
        a consent gate hiding one) was present within ``timeout_ms``.
        """
        consent = self._consent_locator(page)
        email = page.locator(self._EMAIL_SELECTOR)
        poll_ms = 250
        elapsed_ms = 0
        while elapsed_ms < timeout_ms:
            try:
                if await email.is_visible() or (
                    await consent.count() > 0 and await consent.is_visible()
                ):
                    await self._login(page)
                    return True
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(poll_ms)
            elapsed_ms += poll_ms
        return False

    # ------------------------------------------------------------------
    # Date helpers
    #
    # Job params carry the start date as "DD/MM/YYYY" (the convention the DOC
    # adapters and the frontend already use). Camis' JSON API wants ISO
    # "YYYY-MM-DD", so provide both a splitter and an ISO converter.
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_date_string(date_str: str) -> tuple[int, int, int]:
        """Parse ``"DD/MM/YYYY"`` → ``(day, month, year)`` as integers."""
        dd, mm, yyyy = date_str.split("/")
        return int(dd), int(mm), int(yyyy)

    @classmethod
    def _to_iso_date(cls, date_str: str) -> str:
        """Convert ``"DD/MM/YYYY"`` → ISO ``"YYYY-MM-DD"`` for API params."""
        dd, mm, yyyy = cls._parse_date_string(date_str)
        return f"{yyyy:04d}-{mm:02d}-{dd:02d}"

    @staticmethod
    def _generate_night_dates(date_str: str, nights: int) -> list[str]:
        """Return ISO ``"YYYY-MM-DD"`` strings for each night of a stay."""
        start = datetime.strptime(date_str, "%d/%m/%Y")
        return [
            (start + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(max(nights, 1))
        ]

    # ------------------------------------------------------------------
    # Cart-session persistence (shared with the DOC flow's shape)
    # ------------------------------------------------------------------

    async def _persist_cart_session(
        self, page: Page, job_id: str, cart_url: str
    ) -> str:
        """Encrypt the current browser cookies and store a ``CartSession`` row.

        Mirrors ``BaseDOCAdapter._persist_cart_session`` so the hold worker +
        noVNC payment flow work unchanged. Deletes any prior cart for
        ``job_id`` first. Returns the ``/pay/{job_id}`` URL to surface to the
        user.

        Uses the measured Camis hold window (``cart_hold_minutes`` = 15,
        HH-103). The 25-minute fallback only fires if a subclass explicitly
        clears it back to ``None``.
        """
        from app.core.crypto import encrypt
        from app.models.session import CartSession
        from sqlalchemy import delete

        if self.cart_hold_minutes is None:
            logger.warning(
                "cart_hold_minutes is unset for %s — defaulting to 25 min.",
                type(self).__name__,
            )
        hold_duration_minutes = self.cart_hold_minutes or 25
        hold_expires_at = utcnow() + timedelta(minutes=hold_duration_minutes)
        cookies = await page.context.cookies()
        cart_session = CartSession(
            job_id=job_id,
            encrypted_cookies=encrypt(json.dumps(cookies)),
            cart_url=cart_url,
            expires_at=hold_expires_at,
        )
        async with AsyncSessionLocal() as db_session:
            await db_session.execute(
                delete(CartSession).where(CartSession.job_id == job_id)
            )
            db_session.add(cart_session)
            await db_session.commit()

        return f"{settings.app_url}/pay/{job_id}"
