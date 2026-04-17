import re
import logging
import asyncio
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError
from app.adapters.base import (
    BaseAdapter, ParamField, AvailabilityResult, AvailabilityStatus, BookingResult
)
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

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

GREAT_WALK_REGISTRY: list[GreatWalkInfo] = [
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

# Derived lookups — no duplication
GREAT_WALKS = [w.name for w in GREAT_WALK_REGISTRY]
GREAT_WALK_MAP = {w.name: w for w in GREAT_WALK_REGISTRY}

PEOPLE_OPTIONS = [str(i) for i in range(1, 26)]  # 1-25, always consistent


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


class DocGreatWalkAdapter(BaseAdapter):
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
                default="Routeburn Track",
            ),
            ParamField(
                key="date",
                label="Start Date",
                type="date",
            ),
            ParamField(
                key="nights",
                label="Nights",
                type="number",
                default=1,
            ),
            ParamField(
                key="people",
                label="People",
                type="select",
                options=PEOPLE_OPTIONS,
                default="2",
            ),
            ParamField(
                key="direction",
                label="Direction",
                type="select",
                options=[d for w in GREAT_WALK_REGISTRY for d in w.directions],
                default="",
                required=False,
            ),
            ParamField(
                key="sites",
                label="Sites to Watch (comma separated)",
                type="text",
                default="",
            ),
        ]

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    async def _click_with_fallback(self, locator) -> None:
        try:
            await locator.click(timeout=1500)
        except PlaywrightTimeoutError:
            await locator.click(timeout=8000, force=True)

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

    async def _select_dropdown_option(self, page: Page, btn_selector: str, option_text: str) -> None:
        await page.locator(btn_selector).click()
        # Use contains-text with exact=False to be tolerant of leading/trailing whitespace
        await page.get_by_role("option").filter(has_text=option_text).first.click()

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
        dd, mm, yyyy = date_str.split("/")
        await self._set_start_date(page, MONTHS[int(mm) - 1], int(yyyy), int(dd))

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

    async def _click_search_and_wait(self, page: Page) -> None:
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
                await self.fill_form(page, {}) # refill after reload

        raise TimeoutError("Search results table never appeared after 3 attempts")

    async def detect_availability(self, page: Page, params: dict) -> list[AvailabilityResult]:
        date_str = params["date"]
        people_wanted = int(params.get("people", 2))
        sites = [s.strip() for s in params.get("sites", "").split(",") if s.strip()]

        await self._click_search_and_wait(page)

        results = []
        for site in sites:
            result = await self._detect_site(page, site, date_str, people_wanted)
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
        partial_icons = {"GWUnavailablePeopleSearch"}  # available but not enough for requested party size

        if icon in bookable_icons:
            status = AvailabilityStatus.AVAILABLE
        elif icon in partial_icons:
            status = AvailabilityStatus.PARTIALLY_AVAILABLE
        elif icon in not_bookable_icons:
            status = AvailabilityStatus.UNAVAILABLE
        elif total is not None:
            if total >= people_wanted:
                status = AvailabilityStatus.AVAILABLE
            elif total > 0:
                status = AvailabilityStatus.PARTIALLY_AVAILABLE
            else:
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
        """Click the available cell to initiate the 25-minute hold."""
        date_str = params["date"]
        sites = [s.strip() for s in params.get("sites", "").split(",") if s.strip()]

        for site in sites:
            table = page.locator("table.js-book-modal")
            site_link = table.locator("a.gridParkLink span", has_text=site).first
            if await site_link.count() == 0:
                continue

            row = site_link.locator("xpath=ancestor::tr[1]")
            btn = row.locator(f'button[aria-label*="on{date_str}"]').first
            if await btn.count() == 0:
                continue

            await btn.click()

            # Wait for reservation details page
            try:
                await page.wait_for_url("**/SelectReservationPreCartGreatWalk**", timeout=15_000)
                return BookingResult(
                    success=True,
                    held=True,
                    reservation_url=page.url,
                    message=f"Hold secured for {site} on {date_str}. 25 minutes to complete payment.",
                )
            except Exception as e:
                return BookingResult(
                    success=False,
                    held=False,
                    message=f"Clicked cell but reservation page did not load: {e}",
                )

        return BookingResult(
            success=False,
            held=False,
            message="No available site found to hold",
        )