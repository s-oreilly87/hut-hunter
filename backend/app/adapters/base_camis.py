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
    BookingWindowInfo,
    CredentialVerificationResult,
    OccupantField,
    ParamField,
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

    # Cap on drill-down requests per availability check: a park query only
    # returns per-day aggregates per campground loop, so loops showing an
    # available day are queried individually for per-site data. Parks have a
    # handful of loops; the cap just bounds the worst case.
    _MAX_DRILL_REQUESTS = 12

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
            # Renders the camper picker in the job wizard (the frontend
            # special-cases key == "occupants") and gates auto-book: the poll
            # worker only enqueues a hold when params.occupants is non-empty.
            # Camis needs just a permit holder at checkout, so one camper with
            # the permit_holder occupant field filled is enough. Optional for
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
    ) -> BookingWindowInfo:
        entries = cls._schedule_entries(data)
        if not entries:
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
                return BookingWindowInfo(
                    is_open=True, evidence="target date is within a reservable range",
                )

        # No entry's reservable range covers target_date. THR-126: combine
        # two independent signals and arm on the EARLIEST one available —
        # arming early just means the poll worker sees "not released yet" a
        # bit longer, arming late risks missing the window outright:
        #  - the hardcoded rolling-release window (advance_booking_months),
        #    this platform's PRIMARY release mechanic and the one the
        #    dateschedule payload never encodes at all;
        #  - a genuinely published go-live date for the season relevant to
        #    target_date (a fixed-date season launch, or this season
        #    releasing off-cadence) — scoped to the one relevant entry via
        #    _entry_for_target_date, not every season on file (see its
        #    docstring for the bug that fixes).
        candidates: list[datetime] = []

        if advance_booking_months is not None:
            rolling_open_date = cls._subtract_months(target_date, advance_booking_months)
            candidates.append(
                cls._localize(datetime.combine(rolling_open_date, window_open_local_time), tz)
            )

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

    async def check_booking_window(self, params: dict) -> BookingWindowInfo:
        """Query the season calendar to see if ``params['date']`` is already
        reservable (THR-124). See the module comment above for caveats.

        Fails open (``is_open=True``) on any missing param, network error, or
        unparseable response — a broken lookup must never park a job that
        would otherwise have worked exactly as it did before this feature.
        """
        resolved = self._resolve_params(params)
        rl_id = resolved.get("resource_location_id")
        date_str = resolved.get("date")
        if rl_id is None or not date_str:
            return BookingWindowInfo(is_open=True, evidence="missing resource_location_id/date")

        try:
            target_date = datetime.strptime(str(date_str), "%d/%m/%Y").date()
        except ValueError:
            return BookingWindowInfo(is_open=True, evidence=f"unparseable date {date_str!r}")

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
                "treating booking window as open", rl_id, exc,
            )
            return BookingWindowInfo(is_open=True, evidence=f"dateschedule lookup failed: {exc}")

        tz = ZoneInfo(self.booking_timezone) if self.booking_timezone else None
        try:
            return self._parse_booking_window(
                data,
                target_date,
                tz,
                advance_booking_months=self.advance_booking_months,
                window_open_local_time=self.window_open_local_time,
            )
        except Exception as exc:
            logger.warning("failed to parse dateschedule response: %s — treating window as open", exc)
            return BookingWindowInfo(is_open=True, evidence=f"dateschedule parse error: {exc}")

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

        return {
            "resourceLocationId": int(rl_id),
            "mapId": int(map_id),
            "bookingCategoryId": int(category_id),
            "startDate": start_iso,
            "endDate": end_iso,
            "getDailyAvailability": "true",
        }

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
        """
        links = (data or {}).get("mapLinkAvailabilities") or {}
        return [
            link_id
            for link_id, days in links.items()
            if any(c == self.AVAILABILITY_AVAILABLE_CODE for c in (days or [])[:nights])
        ]

    async def _collect_site_days(
        self, page: Page | None, query: dict, data: Any, nights: int
    ) -> dict[str, list[int]]:
        """Gather per-site day codes for a park, drilling into loop maps.

        A query at the park's root map usually returns only per-loop
        aggregates (``mapLinkAvailabilities``); per-site codes
        (``resourceAvailabilities``) appear when querying a leaf (loop) map.
        Breadth-first drill into every link that shows an available day,
        bounded by ``_MAX_DRILL_REQUESTS``. Links with no available day are
        skipped — their sites can't contribute a bookable stay.
        """
        sites = self._extract_site_days(data)
        queue = self._open_link_ids(data, nights)
        requests = 0
        while queue and requests < self._MAX_DRILL_REQUESTS:
            link_id = queue.pop(0)
            sub = await self._get_map_availability(
                page, {**query, "mapId": int(link_id)}
            )
            requests += 1
            sites.update(self._extract_site_days(sub))
            queue.extend(self._open_link_ids(sub, nights))
        return sites

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
        - nothing available → UNAVAILABLE
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
            status = AvailabilityStatus.UNAVAILABLE
        return AvailabilityResult(
            site=site,
            status=status,
            evidence=(
                f"sites free for the full stay: {len(full_stay)}/{len(site_days)}; "
                f"sites with ≥1 free night: {any_night} (0=available)"
            ),
            total_available=len(full_stay),
        )

    async def fill_form(self, page: Page, params: dict) -> None:
        """Warm the browser context and snapshot the search page.

        Availability itself comes from the JSON API in ``detect_availability``;
        this navigates to the site (clearing Queue-it if present) so the context
        carries valid cookies for the subsequent API call, and captures a
        snapshot for debugging.
        """
        await page.goto(self.base_url, wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            pass
        await self.snapshot(page, "camis_search")

    async def detect_availability(
        self, page: Page | None, params: dict
    ) -> list[AvailabilityResult]:
        """Read park availability for the requested dates from the JSON API.

        One watch job → one park (resource location). Queries the park's map,
        short-circuits to UNAVAILABLE when every campground loop reports no
        available day, and otherwise drills into the open loops for per-site
        codes — a stay is only real if a single site is free every night
        (day-wise aggregates can show "available" when no site covers the
        whole stay). Returns a single-element list to match ``BaseAdapter``'s
        contract; callers already handle the all/any/partial cases generically.
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
        # Fast path — every loop reports zero available nights, so there is
        # nothing to drill into (the common polling case).
        if not has_sites and not self._open_link_ids(data, nights):
            return [AvailabilityResult(
                site=site_name,
                status=AvailabilityStatus.UNAVAILABLE,
                evidence=f"all campground loops report no available nights: {links}",
                total_available=0,
            )]

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

    @classmethod
    def occupant_fields(cls) -> list[OccupantField]:
        """Occupant fields collected during the Camis booking.

        Unlike the DOC flow (per-person name/age/category), Camis takes party
        size and equipment during search and a single **permit holder** name at
        checkout (confirmed on the Review Reservation Details page, which shows
        the account's occupant as the named permit holder).
        """
        return [
            OccupantField(
                key="permit_holder",
                label="Permit Holder Name",
                type="text",
                required=True,
            ),
        ]

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
                raise RuntimeError("Camis login did not complete — check the stored credentials")
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
