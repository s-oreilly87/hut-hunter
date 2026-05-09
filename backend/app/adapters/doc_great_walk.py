import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from app.adapters.base import (
    AvailabilityResult,
    AvailabilityStatus,
    BookingResult,
    OccupantField,
    ParamField,
)
from app.adapters.base_doc import BaseDOCAdapter, MONTHS, PEOPLE_OPTIONS

logger = logging.getLogger(__name__)


@dataclass
class GreatWalkInfo:
    name: str
    directions: list[str] = field(default_factory=list)

    @property
    def has_direction(self) -> bool:
        return len(self.directions) > 0

    @property
    def single_direction(self) -> bool:
        return len(self.directions) == 1

# ---------------------------------------------------------------------------
# Load great_walks.json (written by scrape_great_walks.py) and build the
# registry + sites lookup from it.  Falls back to the hardcoded list when
# the JSON file is absent so the adapter still works before the scraper runs.
# ---------------------------------------------------------------------------

_GREAT_WALKS_JSON = Path(__file__).resolve().parent / "great_walks.json"

_HARDCODED_REGISTRY: list[GreatWalkInfo] = [
    GreatWalkInfo("Abel Tasman Coast Track", ["Marahau – Wainui Bay", "Wainui Bay - Marahau"]),
    GreatWalkInfo("Heaphy Track", ["Golden Bay – West Coast", "West Coast - Golden Bay"]),
    GreatWalkInfo("Kepler Track", ["Anti – clockwise (Brod Bay first)", "Clockwise (Moturau Hut first)"]),
    GreatWalkInfo("Lake Waikaremoana Track", ["Onepoto – Hopuruahine Landing", "Hopuruahine Landing - Onepoto"]),
    GreatWalkInfo("Milford Track"),  # no directions
    GreatWalkInfo("Paparoa Track", ["Blackball - Punakaiki", "Punakaiki - Blackball"]),
    GreatWalkInfo("Rakiura Track", ["Lee Bay – Main Road/Fern Gully car park", "Main Road/Fern Gully car park – Lee Bay"]),
    GreatWalkInfo("Routeburn Track", ["Routeburn Shelter – The Divide", "The Divide - Routeburn Shelter"]),
    GreatWalkInfo("Tongariro Northern Circuit", ["Clockwise (Mangatepopo first)", "Anti-Clockwise (Waihohonu first)"]),
    GreatWalkInfo("Whanganui Journey", ["Taumarunui-Pipiriki"]),  # single direction
]


def _load_registry_from_json() -> tuple[list[GreatWalkInfo], dict[str, list[str]]]:
    """Return (registry, sites_by_track) loaded from great_walks.json.

    Returns the hardcoded fallback (with empty sites) if the file is missing
    or malformed.
    """
    try:
        data = json.loads(_GREAT_WALKS_JSON.read_text())
        walks = data.get("great_walks", [])
        if not walks:
            raise ValueError("empty great_walks list")
        registry = [
            GreatWalkInfo(w["name"], w.get("directions", []))
            for w in walks
        ]
        sites_by_track: dict[str, list[str]] = {
            w["name"]: [s["siteName"] for s in w.get("sites", [])]
            for w in walks
        }
        logger.debug("Loaded %d great walks from %s", len(registry), _GREAT_WALKS_JSON)
        return registry, sites_by_track
    except (FileNotFoundError, json.JSONDecodeError, ValueError, KeyError) as exc:
        logger.debug(
            "great_walks.json not found or invalid (%s) — using hardcoded registry",
            exc,
        )
        return _HARDCODED_REGISTRY, {}


GREAT_WALK_REGISTRY, _SITES_BY_TRACK = _load_registry_from_json()

# Derived lookups — no duplication
GREAT_WALKS = [w.name for w in GREAT_WALK_REGISTRY]
GREAT_WALK_MAP = {w.name: w for w in GREAT_WALK_REGISTRY}



def _parse_sites(params: dict) -> list[str]:
    """Parse the ``sites`` param, supporting both the new list format and the
    legacy comma-separated string format for backward compatibility."""
    sites_param = params.get("sites", "")
    if isinstance(sites_param, list):
        return [s.strip() for s in sites_param if isinstance(s, str) and s.strip()]
    # Legacy: comma-separated string
    return [s.strip() for s in str(sites_param).split(",") if s.strip()]


def parse_month_header(text: str) -> dict:
    t = text.strip()
    parts = t.split(" ")
    if len(parts) != 2:
        raise ValueError(f"Unexpected month header: '{text}'")
    month, year_str = parts
    if month not in MONTHS:
        raise ValueError(f"Unknown month: '{month}'")
    year = int(year_str)
    idx = year * 12 + MONTHS.index(month)
    return {"month": month, "year": year, "idx": idx}


class DocGreatWalkAdapter(BaseDOCAdapter):
    adapter_id = "doc_great_walk"
    name = "DOC Great Walk"
    base_url = "https://bookings.doc.govt.nz/Web/Default.aspx#!greatwalk-result"

    @classmethod
    def param_fields(cls) -> list[ParamField]:
        return [
            ParamField(
                key="track",
                label="Track",
                type="select",
                options=GREAT_WALKS,
                default="",
            ),
            ParamField(
                key="direction",
                label="Direction",
                type="select",
                options=[d for w in GREAT_WALK_REGISTRY for d in w.directions],
                default="",
                required=False,
                filter_by="track",
                options_by={w.name: list(w.directions) for w in GREAT_WALK_REGISTRY},
            ),
            ParamField(
                key="sites",
                label="Sites",
                type="multiselect",
                options=[s for sites in _SITES_BY_TRACK.values() for s in sites],
                default=[],
                required=False,
                filter_by="track",
                options_by=_SITES_BY_TRACK,
            ),
            ParamField(
                key="nights",
                label="Nights",
                type="number",
                default=1,
            ),
            ParamField(
                key="date",
                label="Start Date",
                type="date",
            ),
            ParamField(
                key="occupants",
                label="Occupants",
                type="text",
                default='[{"first_name": "","last_name": "","category": "NZ Adult (18+)","country": "New Zealand","age": "","gender": "Male"}]',
                required=True,
            ),
            ParamField(
                key="people",
                label="People",
                type="select",
                options=PEOPLE_OPTIONS,
                default="2",
            ),
        ]

    @classmethod
    def occupant_fields(cls) -> list[OccupantField]:
        return [
            OccupantField(
                key="category",
                label="Category",
                type="select",
                options=[
                    "NZ Adult (18+)",
                    "NZ Child (5-17)",
                    "International Adult (18+)",
                    "International Child (5-17)",
                ],
                default="",
                required=True,
            )
        ]

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    async def _read_dropdown_options(self, page: Page, box_selector: str) -> list[str]:
        """Read currently available options from a dropdown box."""
        items = page.locator(f"{box_selector} li a span")
        count = await items.count()
        options = []
        for i in range(count):
            txt = (await items.nth(i).inner_text()).strip()
            if txt:
                options.append(txt)
        return options

    async def _select_dropdown_option_contains(self, page: Page, btn_selector: str, pattern: str) -> None:
        await page.locator(btn_selector).click()
        await page.get_by_role("option", name=re.compile(pattern, re.IGNORECASE)).click()

    async def _wait_for_header_change(self, header_locator, prev_text: str, timeout: int = 7000) -> str:
        prev = prev_text.strip()
        elapsed = 0
        while elapsed < timeout:
            cur = (await header_locator.inner_text()).strip()
            if cur != prev:
                return cur
            await asyncio.sleep(0.12)
            elapsed += 120
        raise TimeoutError(f"Month header did not change from '{prev}'")

    async def _open_datepicker(self, page: Page) -> tuple:
        btn = page.locator("#great-walk-start-date")
        await btn.scroll_into_view_if_needed()
        await btn.click(force=True)

        popper = page.locator(".react-datepicker-popper:visible")
        await popper.wait_for(state="visible", timeout=10_000)

        header = popper.locator(".react-datepicker__current-month").first
        if await header.count() > 0:
            await header.wait_for(state="visible", timeout=10_000)
            return popper, header

        month_pattern = re.compile(
            r"^(January|February|March|April|May|June|July|August"
            r"|September|October|November|December)\s+\d{4}$"
        )
        header = popper.get_by_text(month_pattern, exact=False).first
        await header.wait_for(state="visible", timeout=10_000)
        return popper, header

    async def _set_start_date(self, page: Page, target_month: str, target_year: int, day: int) -> None:
        popper, header = await self._open_datepicker(page)

        next_btn = popper.locator(
            'button[aria-label="Next Month"], button.react-datepicker__navigation--next'
        ).first
        prev_btn = popper.locator(
            'button[aria-label="Previous Month"], button.react-datepicker__navigation--previous'
        ).first

        target_idx = target_year * 12 + MONTHS.index(target_month)

        for _ in range(36):
            cur_text = (await header.inner_text()).strip()
            cur = parse_month_header(cur_text)
            if cur["idx"] == target_idx:
                break
            nav = next_btn if cur["idx"] < target_idx else prev_btn
            await self._click_with_fallback(nav)
            await self._wait_for_header_change(header, cur_text)

        # Click the target day
        day_regex = re.compile(
            rf"Choose .*?, {target_month} {day}(st|nd|rd|th)?, {target_year}", re.IGNORECASE
        )
        day_by_aria = popper.get_by_role("button", name=day_regex)
        if await day_by_aria.count() > 0:
            await self._click_with_fallback(day_by_aria.first)
        else:
            await self._click_with_fallback(
                popper.get_by_text(re.compile(rf"^{day}$")).first
            )

        # Verify the date control updated
        selected = page.locator("#great-walk-start-date .selectedDate span")
        await selected.wait_for(state="visible", timeout=10_000)

        month_num = str(MONTHS.index(target_month) + 1).zfill(2)
        want = f"{str(day).zfill(2)}/{month_num}/{target_year}"

        elapsed = 0
        while elapsed < 10_000:
            txt = (await selected.inner_text()).strip()
            if want in txt:
                return
            await asyncio.sleep(0.2)
            elapsed += 200

        raise TimeoutError(f"Start date did not update to {want}")

    # ------------------------------------------------------------------ #
    # BaseAdapter implementation
    # ------------------------------------------------------------------ #

    async def fill_form(self, page: Page, params: dict) -> None:
        track = params["track"]
        walk = GREAT_WALK_MAP[track]
        date_str = params["date"]
        nights = str(params.get("nights", 1))
        people = str(params.get("people", 2))
        direction = params.get("direction", "").strip()

        await page.goto(self.base_url, wait_until="domcontentloaded", timeout=60_000)
        await page.locator('div[role="search"]').wait_for(state="visible", timeout=45_000)

        # Select track first — this triggers the page to update nights/direction options
        await self._select_dropdown_option(page, "#great-walk-dropdown-button", track)

        # Wait for the nights dropdown to update after track selection
        await page.wait_for_timeout(800)

        # Set date
        dd, mm, yyyy = self._parse_date_string(date_str)
        await self._set_start_date(page, MONTHS[mm - 1], yyyy, dd)

        # Nights — read available options first, only select if dropdown is enabled
        nights_options = await self._read_dropdown_options(page, "#great-walk-night-dropdown-box")
        if len(nights_options) > 1:
            # Multiple options available — select the requested one
            if nights in nights_options:
                await self._select_dropdown_option_contains(
                    page, "#great-walk-night-dropdown-button", rf"^{nights}$"
                )
            else:
                logger.warning(
                    f"Requested {nights} nights not available for {track}. "
                    f"Available: {nights_options}. Using default."
                )
        else:
            logger.info(f"Nights dropdown is fixed at {nights_options} for {track}, skipping selection")

        # People
        await self._select_dropdown_option_contains(
            page, "#great-walk-people-dropdown-button", rf"^{people}$"
        )

        # Direction
        if not walk.has_direction:
            logger.info(f"No direction dropdown for {track}, skipping")
        elif walk.single_direction:
            logger.info(f"Single direction for {track}, skipping selection")
        elif direction:
            await self._select_dropdown_option(
                page, "#great-walk-direction-dropdown-button", direction
            )

    async def _click_search_and_wait(self, page: Page, params: dict) -> None:
        search_btn = page.get_by_role("button", name="Search")
        for attempt in range(1, 4):
            await search_btn.scroll_into_view_if_needed()
            await search_btn.click(timeout=10_000, force=True)
            await page.wait_for_load_state("networkidle", timeout=30_000)
            try:
                await page.locator("table.js-book-modal").wait_for(
                    state="visible", timeout=45_000
                )
                return
            except PlaywrightTimeoutError:
                logger.warning(f"Search attempt {attempt} timed out, retrying...")
                await page.reload(wait_until="domcontentloaded", timeout=60_000)
                await self.fill_form(page, params)  # refill after reload

        raise TimeoutError("Search results table never appeared after 3 attempts")

    async def detect_availability(self, page: Page, params: dict) -> list[AvailabilityResult]:
        date_str = params["date"]
        nights = int(params.get("nights", 1))
        people_wanted = int(params.get("people", 2))
        sites = _parse_sites(params)

        # Build per-night dates so each site is checked on the date it will
        # actually be booked. Checking every site against the start date gives
        # a false positive when a later-night hut has no availability on its
        # actual booking date (e.g. night-2 hut available on Apr 23 but not
        # Apr 24, which is the night that would be booked).
        night_dates = self._generate_night_dates(date_str, nights)

        await self._click_search_and_wait(page, params)

        results = []
        for i, site in enumerate(sites):
            night_date = night_dates[i] if i < len(night_dates) else date_str
            result = await self._detect_site(page, site, night_date, people_wanted)
            results.append(result)
        return results

    async def _detect_site(
        self, page: Page, site: str, date: str, people_wanted: int
    ) -> AvailabilityResult:
        table = page.locator("table.js-book-modal")
        site_link = table.locator("a.gridParkLink span", has_text=site).first

        if await site_link.count() == 0:
            return AvailabilityResult(
                site=site,
                status=AvailabilityStatus.UNKNOWN,
                evidence=f"Site '{site}' not found in results table",
            )

        row = site_link.locator("xpath=ancestor::tr[1]")
        btn = row.locator(f'button[aria-label*="on{date}"]').first

        if await btn.count() == 0:
            return AvailabilityResult(
                site=site,
                status=AvailabilityStatus.UNKNOWN,
                evidence=f"No cell found for {site} on {date}",
            )

        aria = await btn.get_attribute("aria-label") or ""
        inner_div = btn.locator("div").first
        style = await inner_div.get_attribute("style") or ""

        url_match = re.search(r"Keechma/icons/([^\"')]+)\.svg", style, re.IGNORECASE)
        icon = url_match.group(1) if url_match else None

        m = re.search(r"Total available is\s+(\d+)", aria, re.IGNORECASE)
        total = int(m.group(1)) if m else None

        bookable_icons = {"GWAvailable", "GWFewerSpaceAvailable", "GWBookingSelected"}
        not_bookable_icons = {"GWNotAvailable", "GWFacilityClosed"}
        # Icon hint that means "some spots, but not enough for your party size".
        # This is a hint only — if we have a real count, `total` wins.
        partial_icons = {"GWUnavailablePeopleSearch"}

        # `total` is the source of truth when we can read it from the aria
        # label. Icons are classification hints that are occasionally wrong
        # (DOC has been observed showing GWUnavailablePeopleSearch even when
        # total == 0), which previously caused a "partial availability"
        # notification on a site that had zero spots. The rule:
        #
        #   total >= people_wanted  -> AVAILABLE
        #   0 < total < people_wanted -> PARTIALLY_AVAILABLE
        #   total == 0              -> UNAVAILABLE
        #
        # Icon-based classification is only consulted when `total` is None.
        if total is not None:
            if total >= people_wanted:
                status = AvailabilityStatus.AVAILABLE
            elif total > 0:
                status = AvailabilityStatus.PARTIALLY_AVAILABLE
            else:
                status = AvailabilityStatus.UNAVAILABLE
        elif icon in bookable_icons:
            status = AvailabilityStatus.AVAILABLE
        elif icon in partial_icons:
            status = AvailabilityStatus.PARTIALLY_AVAILABLE
        elif icon in not_bookable_icons:
            status = AvailabilityStatus.UNAVAILABLE
        else:
            return AvailabilityResult(
                site=site,
                status=AvailabilityStatus.UNKNOWN,
                evidence=f"Could not determine availability. aria='{aria}' icon='{icon}'",
                icon=icon,
            )

        return AvailabilityResult(
            site=site,
            status=status,
            evidence=f"icon={icon} total={total} peopleWanted={people_wanted}",
            total_available=total,
            icon=icon,
        )

    async def attempt_hold(self, page: Page, params: dict) -> BookingResult:
        date_str = params["date"]  # start date DD/MM/YYYY
        nights = int(params.get("nights", 1))
        sites = _parse_sites(params)
        occupants = params.get("occupants", [])

        if not occupants:
            return BookingResult(
                success=False, held=False,
                message="No occupant details provided — cannot complete hold",
            )

        # Build list of dates for each night DD/MM/YYYY
        night_dates = self._generate_night_dates(date_str, nights)
        logger.info(f"Attempting hold for {nights} night(s): {night_dates} at sites: {sites}")

        # --- 1. Get sites in DOM order (top to bottom as displayed) ---
        table = page.locator("table.js-book-modal")
        site_links = table.locator("a.gridParkLink span")
        dom_ordered_sites = []
        for j in range(await site_links.count()):
            txt = (await site_links.nth(j).inner_text()).strip()
            if txt in sites:
                dom_ordered_sites.append(txt)

        logger.info(f"Sites in DOM order: {dom_ordered_sites}")

        # --- 2. Select one cell per night in DOM order ---
        # Each site maps to the corresponding night: site[0] on night_dates[0],
        # site[1] on night_dates[1], etc. The DOC availability table orders huts
        # top-to-bottom matching the track direction, so this naturally maps to
        # night 1 hut → night 2 hut → etc.
        #
        # Use JS click (el.click()) rather than Playwright's coordinate-based
        # click to reliably target each cell regardless of DOM overlay position.
        selected_count = 0
        for i, night_date in enumerate(night_dates):
            if i >= len(dom_ordered_sites):
                logger.warning(f"No site available for night {i + 1}")
                continue

            site = dom_ordered_sites[i]
            site_link = table.locator("a.gridParkLink span", has_text=site).first
            row = site_link.locator("xpath=ancestor::tr[1]")
            btn = row.locator(f'button[aria-label*="on{night_date}"]').first

            if await btn.count() == 0:
                logger.warning(f"No cell found for {site} on {night_date}")
                continue

            await btn.evaluate("el => el.click()")

            logger.info(f"Selected cell: {site} on {night_date}")
            await page.wait_for_timeout(300)
            selected_count += 1

        if selected_count == 0:
            return BookingResult(
                success=False, held=False,
                message="Could not select any availability cells",
            )

        if selected_count < nights:
            return BookingResult(
                success=False, held=False,
                message=(
                    f"Only selected {selected_count}/{nights} nights "
                    f"— cannot proceed to Reserve"
                ),
            )

        # --- 3. Click Reserve (outside loop, after all selections) ---
        reserve_btn = page.get_by_role("button", name="Reserve")
        try:
            await reserve_btn.wait_for(state="visible", timeout=10_000)
            await page.wait_for_function(
                """() => {
                  const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => b.textContent.trim() === 'Reserve');
                  return btn && !btn.disabled;
                }""",
                timeout=10_000,
            )
            await reserve_btn.click()
            logger.info("Clicked Reserve button")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "reserve_button_timeout")
            return BookingResult(
                success=False, held=False,
                message=f"Reserve button did not become enabled after {selected_count} selection(s)",
            )

        # --- 3b. Handle login modal if session has expired ---
        try:
            logged_in = await self._login_if_prompted(page)
            if logged_in:
                # After login the site should automatically proceed to the occupant
                # modal. If it doesn't (some SPA flows need a nudge), click Reserve
                # again — the 15s timeout on the occupant modal below will catch it
                # either way.
                logger.info("Login completed — continuing to occupant details")
        except RuntimeError as e:
            await self.snapshot(page, "login_error")
            return BookingResult(success=False, held=False, message=str(e))

        # --- 4. Fill occupant details modal ---
        try:
            await page.locator("text=Occupant Details").first.wait_for(
                state="visible", timeout=15_000
            )
            logger.info("Occupant details modal appeared")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "occupant_modal_timeout")
            return BookingResult(
                success=False, held=False,
                message="Occupant details modal did not appear after Reserve",
            )

        await self._fill_occupants(page, occupants)

        # --- 5. Save & Continue ---
        await page.get_by_role("button", name="Save & Continue").click()
        logger.info("Clicked Save & Continue")

        # --- 6. Wait for Reservation Details page ---
        try:
            await page.wait_for_url("**/SelectReservationPreCartGreatWalk**", timeout=15_000)
            logger.info("Reached Reservation Details page")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "reservation_details_url_timeout")
            return BookingResult(
                success=False, held=False,
                message="Did not reach Reservation Details page",
            )

        # --- 7a. Wait for Book Great Walk button ---
        try:
            book_link = page.locator("#mainContent_bReserve")
            await book_link.wait_for(state="visible", timeout=15_000)
        except PlaywrightTimeoutError:
            await self.snapshot(page, "book_great_walk_timeout")
            return BookingResult(
                success=False,
                held=False,
                message="Book Great Walk button did not appear on Reservation Details page",
            )

        # --- 7b. Best-effort: open View Occupants modal for a richer snapshot ---
        # This is snapshot-only; any failure here must not abort the booking.
        try:
            view_occ_btn = page.locator("#aViewOccupant")
            if await view_occ_btn.count() > 0:
                await view_occ_btn.click()
                logger.info("Opened View Occupants modal on Reservation Details page")
                await page.locator("#myModal_occu").wait_for(state="visible", timeout=6_000)
                await page.wait_for_timeout(300)
                await self.snapshot(page, "reservation_details")
                await page.locator("#myModal_occu .close").first.click()
                await page.locator("#myModal_occu").wait_for(state="hidden", timeout=8_000)
            else:
                await self.snapshot(page, "reservation_details")
        except Exception as modal_err:
            logger.warning(f"View Occupants modal snapshot failed (non-fatal): {modal_err}")
            try:
                await self.snapshot(page, "reservation_details")
            except Exception:
                pass

        # --- 7c. Click Book Great Walk ---
        try:
            await book_link.click()
            logger.info("Clicked Book Great Walk")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "book_great_walk_timeout")
            return BookingResult(
                success=False,
                held=False,
                message="Book Great Walk button click timed out — check artifact for page state",
            )

        # --- 8. Wait for Shopping Cart ---
        try:
            await page.wait_for_url("**/ShoppingCart**", timeout=15_000)
            logger.info("Reached Shopping Cart")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "shopping_cart_timeout")
            return BookingResult(
                success=False,
                held=False,
                message="Did not reach Shopping Cart page",
            )

        # --- 9. T&Cs, checkout, and cart session ---
        await self._check_terms(page)

        cart_url = await self._proceed_to_checkout(page)
        if cart_url is None:
            return BookingResult(
                success=False, held=False,
                message="Did not reach payment page",
            )

        job_id = params.get("_job_id", "unknown")
        resume_url = await self._persist_cart_session(page, job_id, cart_url)

        return BookingResult(
            success=True,
            held=True,
            reservation_url=resume_url,
            message=f"Cart secured for {selected_count} night(s). 24 minutes to complete payment.",
        )
