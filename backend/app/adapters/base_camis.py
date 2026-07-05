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

from app.adapters.base import BaseAdapter
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

    # Cart hold / expiry timing. OPEN until measured with a live hold in HH-100
    # — deliberately NOT defaulted to DOC's 25 min (recon §5). Left as ``None``
    # so nothing downstream assumes a wrong window; HH-100 sets these.
    cart_hold_minutes: int | None = None
    cart_inactive_after_minutes: int | None = None
    cart_keepalive_interval_minutes: int | None = None

    # ------------------------------------------------------------------
    # Known Camis JSON API endpoints (verified unauthenticated — recon §2)
    # ------------------------------------------------------------------

    API_MAPS_ROOT = "/api/maps/root"                # top-level region tree
    API_MAPS = "/api/maps"                          # ?resourceLocationId=<id>
    API_BOOKING_CATEGORIES = "/api/bookingcategories"
    API_SEARCH_CRITERIA_TABS = "/api/searchcriteriatabs"
    API_CAPACITY_CATEGORIES = "/api/capacitycategory/capacitycategories"
    API_EQUIPMENT = "/api/equipment"
    # Availability-adjacent — the prime candidates for detect_availability
    # (HH-99). Exact query params are OPEN (recon §7).
    API_DATE_SCHEDULE = "/api/dateschedule/resourcelocationid"
    API_REACHABLE_RESOURCES = "/api/reachableresources/resourcelocationid"

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

    async def _login_if_prompted(self, page: Page, timeout_ms: int = 8_000) -> bool:
        """If the Camis account login appears, sign in with bound credentials.

        Returns ``True`` if a login was performed, ``False`` if no login prompt
        was visible. Raises ``RuntimeError`` if a prompt appears but credentials
        are missing.

        NOTE: the concrete field selectors for the Angular ``/login`` route are
        TENTATIVE — they anchor on generic email/password inputs and a submit
        button by role, and must be confirmed against a live account in HH-100.
        Availability polling (HH-99) does not require login; only the cart/hold
        flow does, so this is scaffolding for HH-100 to finish.
        """
        email = page.locator(
            'input[type="email"], input[name="email" i], input[autocomplete="username"]'
        ).first
        try:
            await email.wait_for(state="visible", timeout=timeout_ms)
        except PlaywrightTimeoutError:
            return False

        credentials = self._login_credentials
        if credentials is None:
            raise RuntimeError(
                "Camis login prompt appeared but no stored credentials are configured"
            )

        logger.info("Camis login prompt detected — filling stored credentials")
        await email.fill(credentials.username)
        await page.locator(
            'input[type="password"], input[autocomplete="current-password"]'
        ).first.fill(credentials.password)
        await page.get_by_role(
            "button", name=re.compile(r"sign in|log ?in", re.I)
        ).first.click()

        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            pass
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
