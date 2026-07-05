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
``cart_hold_minutes``   **OPEN** — measured with a live hold in HH-100
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
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

import httpx
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from app.adapters.base import (
    AvailabilityResult,
    AvailabilityStatus,
    BaseAdapter,
    BookingResult,
    OccupantField,
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

    # Booking window. Subclasses set the province timezone; the cutoff default
    # is intentionally the base 23:59 until a real booking cutoff is confirmed.
    booking_timezone: str | None = None
    booking_cutoff_time: time = time(23, 59)

    # Cart hold / expiry timing. Still OPEN after HH-100: no countdown timer was
    # observable before the payment step, so the real window must be measured
    # during a live E2E hold (HH-103). Deliberately NOT defaulted to DOC's 25
    # min (recon §5); left ``None`` so nothing downstream assumes a wrong window
    # (``_persist_cart_session`` warns and falls back to 25 until it's set).
    cart_hold_minutes: int | None = None
    cart_inactive_after_minutes: int | None = None
    cart_keepalive_interval_minutes: int | None = None

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
    # Live availability (HH-99). Verified against BC + Ontario: a GET returning
    # per-day status arrays keyed by resourceLocationId under
    # ``mapLinkAvailabilities``. Query params:
    #   resourceLocationId, mapId, bookingCategoryId, startDate, endDate,
    #   getDailyAvailability=true  (plus optional equipmentCategoryId etc.)
    API_AVAILABILITY_MAP = "/api/availability/map"
    # ``/api/dateschedule`` is the operating-SEASON calendar (reservable date
    # ranges, go-live dates, min/max stay), not live availability — useful for
    # gating polling to the open booking window, not for detection.
    API_DATE_SCHEDULE = "/api/dateschedule/resourcelocationid"
    API_REACHABLE_RESOURCES = "/api/reachableresources/resourcelocationid"

    # ``mapLinkAvailabilities`` per-day status codes, decoded empirically against
    # the live API across future/past/winter/beyond-window dates (the Angular
    # enum is inlined in the bundle and not statically recoverable):
    #   1 = available   2 = unavailable (booked / closed / past)
    #   6 = not yet released (booking window not open)
    # Anything else is treated as UNKNOWN so a new code can't be misread as free.
    AVAILABILITY_AVAILABLE_CODE = 1

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
    # Search + availability detection (HH-99)
    #
    # Camis availability is JSON, not DOM — ``GET /api/availability/map``
    # returns per-day status arrays keyed by resourceLocationId. So
    # ``detect_availability`` reads the API directly rather than scraping the
    # page; ``fill_form`` just warms the browser context (Queue-it / WAF pass)
    # and takes a search snapshot for debugging like the DOC adapters do.
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
        # /api/availability/map returns one status per day in [start, end]
        # inclusive, so N nights → end = start + (N-1).
        end_iso = self._generate_night_dates(date_str, nights)[-1]

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

    def _classify_daily_statuses(self, statuses: list[int], site: str) -> AvailabilityResult:
        """Map a per-day ``mapLinkAvailabilities`` array to an ``AvailabilityResult``.

        - all days available → AVAILABLE
        - some days available → PARTIALLY_AVAILABLE (e.g. a 3-night stay with one
          night booked)
        - no days available → UNAVAILABLE
        - empty/malformed → UNKNOWN
        """
        if not statuses:
            return AvailabilityResult(
                site=site,
                status=AvailabilityStatus.UNKNOWN,
                evidence="no per-day availability returned for this resource location",
            )
        available_days = [s == self.AVAILABILITY_AVAILABLE_CODE for s in statuses]
        n_avail = sum(available_days)
        if all(available_days):
            status = AvailabilityStatus.AVAILABLE
        elif n_avail > 0:
            status = AvailabilityStatus.PARTIALLY_AVAILABLE
        else:
            status = AvailabilityStatus.UNAVAILABLE
        return AvailabilityResult(
            site=site,
            status=status,
            evidence=f"daily status codes={statuses} (1=available)",
            total_available=n_avail,
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
        """Read park-level availability for the requested dates from the JSON API.

        One watch job → one park (resource location). Returns a single-element
        list to match ``BaseAdapter``'s contract; callers already handle the
        all/any/partial cases generically.
        """
        park = self._park_by_resource_location_id(int(params["resource_location_id"])) \
            if params.get("resource_location_id") is not None else None
        site_name = (park or {}).get("full_name") or str(params.get("resource_location_id", "(unknown park)"))

        try:
            query = self._build_availability_query(params)
        except (ValueError, KeyError) as e:
            return [AvailabilityResult(
                site=site_name, status=AvailabilityStatus.UNKNOWN, evidence=str(e),
            )]

        data = await self._get_map_availability(page, query)
        link_avail = (data or {}).get("mapLinkAvailabilities") or {}
        statuses = link_avail.get(str(query["resourceLocationId"])) or []
        return [self._classify_daily_statuses(statuses, site_name)]

    # ------------------------------------------------------------------
    # Cart / hold flow (HH-100)
    #
    # Verified funnel (live BC Parks): login → /create-booking/results for the
    # park → drill into a map loop (Leaflet, needs force-click) → the site grid
    # renders each site/date cell as a <button> whose aria-label states its
    # availability → click an "Available for all selected dates" cell → the
    # Shopping Cart → "Proceed to checkout" → occupant/party → payment (the
    # noVNC hand-off). ``_persist_cart_session`` parks the cart for the user.
    #
    # The interactive tail (site-config dialog → checkout → occupant form →
    # payment page) still needs live hardening under E2E (HH-103); no cart hold
    # timer was observable before the payment step, so ``cart_hold_minutes``
    # stays ``None`` (measure it during HH-103, do not guess).
    # ------------------------------------------------------------------

    # Site-grid cell aria-labels (observed live). Only the first is bookable.
    _CELL_AVAILABLE = "Available for all selected dates"
    _CELL_UNAVAILABLE_LABELS = (
        "Not available for selected dates",
        "Closed during selected dates",
        "Does not match all search filters",
    )

    @classmethod
    def occupant_fields(cls) -> list[OccupantField]:
        """Occupant fields collected during the Camis booking.

        Unlike the DOC flow (per-person name/age/category), Camis takes party
        size and equipment during search and a single **permit holder** name at
        checkout. Exposed minimally here; the full checkout occupant form is
        finalized under E2E (HH-103).
        """
        return [
            OccupantField(
                key="permit_holder",
                label="Permit Holder Name",
                type="text",
                required=True,
            ),
        ]

    async def attempt_hold(self, page: Page, params: dict) -> BookingResult:
        """Drive the Camis funnel to place a cart hold and park it for payment.

        Implements the verified steps (login → results → loop drill → select an
        available site cell → proceed to checkout) and, on reaching a checkout /
        payment URL, persists the cart session so the noVNC hand-off works like
        the DOC adapters. Conservative by design: it returns ``held=False`` with
        a snapshot whenever it cannot confirm it reached checkout, so the hold
        worker never reports a hold that didn't happen.

        The site-config/occupant/payment tail needs live hardening (HH-103).
        """
        job_id = params.get("_job_id", "unknown")
        try:
            query = self._build_availability_query(params)
        except (ValueError, KeyError) as e:
            return BookingResult(success=False, held=False, message=str(e))

        park = self._park_by_resource_location_id(query["resourceLocationId"])
        site_name = (park or {}).get("full_name") or str(query["resourceLocationId"])

        # 1. Authenticate (cart is account-scoped).
        try:
            await self._login(page)
        except RuntimeError as e:
            return BookingResult(success=False, held=False, message=str(e))

        # 2. Open the booking results for the park + dates.
        results_url = (
            f"{self.base_url}/create-booking/results"
            f"?resourceLocationId={query['resourceLocationId']}&mapId={query['mapId']}"
            f"&bookingCategoryId={query['bookingCategoryId']}"
            f"&startDate={query['startDate']}&endDate={query['endDate']}"
        )
        await page.goto(results_url, wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        await page.wait_for_timeout(5_000)
        await self.snapshot(page, "camis_results")

        # 3. Find and click an available site cell. On the park root map the
        #    grid may be one loop-drill deep; click a loop area first if no
        #    available cell is visible yet.
        cell = page.get_by_role("button", name=re.compile(re.escape(self._CELL_AVAILABLE), re.I))
        if await cell.count() == 0:
            loop = page.locator("path[class*='mapLinkArea']").first
            if await loop.count() > 0:
                await loop.click(force=True)
                await page.wait_for_timeout(5_000)
                cell = page.get_by_role("button", name=re.compile(re.escape(self._CELL_AVAILABLE), re.I))

        if await cell.count() == 0:
            await self.snapshot(page, "camis_no_available_cell")
            return BookingResult(
                success=False, held=False,
                message=f"No bookable site cell found for {site_name} on {params.get('date')}",
            )
        await cell.first.click(force=True)
        await page.wait_for_timeout(3_000)

        # 4. Proceed to checkout (this is where Camis creates the reservation
        #    transaction + hold timer — see class note).
        proceed = page.locator("#proceedToCheckout")
        if await proceed.count() == 0:
            proceed = page.get_by_role("button", name=re.compile(r"proceed to checkout", re.I))
        if await proceed.count() == 0:
            await self.snapshot(page, "camis_no_checkout_button")
            return BookingResult(
                success=False, held=False,
                message="Selected a site but could not find the Proceed to Checkout control",
            )
        await proceed.first.click()
        await page.wait_for_timeout(6_000)
        await self.snapshot(page, "camis_checkout")

        # 5. Confirm we reached a checkout/payment step before claiming a hold.
        if not re.search(r"create-booking|checkout|payment|cart", page.url, re.I):
            await self.snapshot(page, "camis_checkout_not_reached")
            return BookingResult(
                success=False, held=False,
                message="Did not reach the Camis checkout after selecting a site",
            )

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
    _CONSENT_SELECTORS = ("#login-cookie-consent", "#consentButton")
    _EMAIL_SELECTOR = "#email"
    _PASSWORD_SELECTOR = "#password"

    async def _accept_cookie_consent(self, page: Page) -> None:
        """Dismiss the cookie-consent gate that otherwise hides the login form."""
        for sel in self._CONSENT_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    await page.wait_for_timeout(800)
                    return
            except PlaywrightTimeoutError:
                continue

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

        Raises ``RuntimeError`` if credentials are missing or login doesn't land.
        """
        credentials = self._login_credentials
        if credentials is None:
            raise RuntimeError("Camis login required but no stored credentials are configured")

        await page.goto(f"{self.base_url}/login", wait_until="domcontentloaded", timeout=60_000)
        await self._pass_queue_it(page)
        await page.wait_for_timeout(1_500)
        await self._accept_cookie_consent(page)

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

    async def _login_if_prompted(self, page: Page, timeout_ms: int = 6_000) -> bool:
        """Log in only if the current page is showing the login form.

        Returns ``True`` if a login was performed, ``False`` if no form was
        present (already authenticated, or on a non-login page).
        """
        email = page.locator(self._EMAIL_SELECTOR)
        try:
            await email.wait_for(state="visible", timeout=timeout_ms)
        except PlaywrightTimeoutError:
            return False
        await self._login(page)
        return True

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

        The hold duration falls back to 25 minutes only if a subclass hasn't
        set ``cart_hold_minutes`` yet — HH-100 must replace this with the real
        Camis window once measured (recon §5).
        """
        from app.core.crypto import encrypt
        from app.models.session import CartSession
        from sqlalchemy import delete

        if self.cart_hold_minutes is None:
            logger.warning(
                "cart_hold_minutes is unset for %s — defaulting to 25 min. "
                "HH-100 must set the measured Camis hold window.",
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
