#!/usr/bin/env python3
"""Scrape DOC "standard hut" facilities from bookings.doc.govt.nz.

Writes ``backend/app/adapters/doc_standard_huts.json`` with a park-grouped
structure::

    {
      "scraped_at": "2026-04-20T10:15:03Z",
      "source": "bookings.doc.govt.nz",
      "parks": [
        {
          "park_id": "747",
          "park_name": "Aoraki/Mount Cook National Park",
          "facilities": [
            {"facility_id": "2487", "facility_name": "Mueller Hut"},
            ...
          ]
        },
        ...
      ]
    }

Strategy
--------
The DOC booking site is a React SPA sitting behind a Queue-It waiting room.
Playwright handles the Queue-It cookie handshake automatically (do NOT use
raw HTTP for this).

1. Open ``#!results`` — the search-results page. Starting here (rather
   than the home page) means clicking a listbox option goes straight to
   the ``#!park/{park_id}`` page. Starting from the home page lands on an
   intermediate date-selection screen instead, which complicates the flow.
2. Click the "Search" pill to reveal the autocomplete
   ``<ul role="listbox">`` (~322 options) and snapshot all option texts in
   one pass.
3. For each option: go back to ``#!results``, reopen the popup, click the
   matching option, dismiss the "part of …" modal if it appears, then
   click the primary result tile (the "0 km away" top card) which
   navigates to ``#!park/{park_id}``.
4. On the park page: enumerate all ``<a href="…#!park/{park_id}/{fid}">``
   facility links and capture the facility name from the nearest heading.
5. Dedupe by ``park_id`` — many listbox entries resolve to the same park,
   so the final count will be ~50-100 parks rather than 322.
6. Write the JSON file sorted park-name alphabetically, facilities
   alphabetically within each park.

Each failed option is retried 2× before giving up; HTML + screenshot
artifacts are dumped on the final failure for debugging. Progress is
logged every 10 options.

Usage::

    # from ``backend/`` with Playwright installed:
    #     pip install playwright
    #     playwright install chromium
    python scripts/scrape_standard_huts.py                 # headless
    python scripts/scrape_standard_huts.py --headful       # watch it run
    python scripts/scrape_standard_huts.py --dry-run       # no write
    python scripts/scrape_standard_huts.py --out path.json # custom path
    python scripts/scrape_standard_huts.py --debug         # verbose log

Avoid running between 7:30–8:30 pm NZ time — that is the DOC booking rush
when real users are competing for slots.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    from playwright.async_api import (
        Page,
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "playwright is required. Install with:\n"
        "    pip install playwright\n"
        "    playwright install chromium\n"
    )
    raise


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO_ROOT / "app" / "adapters" / "doc_standard_huts.json"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"

LANDING_URL = "https://bookings.doc.govt.nz/Web/#!results"

# Matches  href="…#!park/747/2487"  (facility link) or  href="…#!park/747"  (park link)
FACILITY_LINK_RE = re.compile(r"#!park/(\d+)/(\d+)")

log = logging.getLogger("scrape_standard_huts")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Facility:
    facility_id: str
    facility_name: str


@dataclass
class Park:
    park_id: str
    park_name: str
    facilities: list[Facility] = field(default_factory=list)

    @property
    def facility_ids(self) -> set[str]:
        return {f.facility_id for f in self.facilities}


@dataclass
class ScrapeResult:
    parks: dict[str, Park] = field(default_factory=dict)  # park_id → Park

    def add_facility(
        self,
        park_id: str,
        park_name: str,
        facility_id: str,
        facility_name: str,
    ) -> None:
        if park_id not in self.parks:
            self.parks[park_id] = Park(park_id=park_id, park_name=park_name)
        park = self.parks[park_id]
        if not park.park_name and park_name:
            park.park_name = park_name
        if facility_id not in park.facility_ids:
            park.facilities.append(Facility(facility_id=facility_id, facility_name=facility_name))

    def load_from_file(self, path: Path) -> int:
        """Seed this result from an existing JSON catalog (for resume).

        Silently returns 0 if the file is missing or unparseable.  Returns
        the number of parks loaded.
        """
        try:
            raw = json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return 0
        for park in raw.get("parks") or []:
            park_id = park.get("park_id", "")
            park_name = park.get("park_name", "")
            for f in park.get("facilities") or []:
                self.add_facility(park_id, park_name, f["facility_id"], f["facility_name"])
        return len(self.parks)

    def known_names(self) -> set[str]:
        """Lowercase set of every park name and facility name already scraped.

        Used to skip listbox options whose text matches something we already
        have, without needing to open the search pill or navigate at all.
        """
        names: set[str] = set()
        for park in self.parks.values():
            if park.park_name:
                names.add(park.park_name.lower())
            for f in park.facilities:
                if f.facility_name:
                    names.add(f.facility_name.lower())
        return names

    def to_parks(self) -> list[dict]:
        out = []
        for park in sorted(self.parks.values(), key=lambda p: p.park_name.lower()):
            facilities = sorted(park.facilities, key=lambda f: f.facility_name.lower())
            out.append({
                "park_id": park.park_id,
                "park_name": park.park_name,
                "facilities": [
                    {"facility_id": f.facility_id, "facility_name": f.facility_name}
                    for f in facilities
                ],
            })
        return out

    @property
    def facility_count(self) -> int:
        return sum(len(p.facilities) for p in self.parks.values())


# ---------------------------------------------------------------------------
# Artifact helpers
# ---------------------------------------------------------------------------


async def snapshot(page: Page, label: str) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = ARTIFACTS_DIR / f"{ts}_{label}"
    try:
        await page.screenshot(path=str(base.with_suffix(".png")), full_page=True)
    except Exception as e:
        log.warning("screenshot failed (%s): %s", label, e)
    try:
        html = await page.content()
        base.with_suffix(".html").write_text(html)
    except Exception as e:
        log.warning("html dump failed (%s): %s", label, e)
    log.info("snapshot saved: %s", base)


# ---------------------------------------------------------------------------
# Search-popup helpers
# ---------------------------------------------------------------------------


async def _click_search_pill(page: Page) -> None:
    """Click the "Search" pill/input to reveal the autocomplete listbox.

    Tries multiple selector strategies in sequence; raises RuntimeError if
    none succeed (which will cause the caller to snapshot and retry).
    """
    candidates = [
        # Exact role match first
        page.get_by_role("button", name=re.compile(r"^search$", re.IGNORECASE)),
        page.locator('button:has-text("Search")').first,
        page.locator('[placeholder*="search" i]').first,
        page.locator('[aria-label*="search" i]').first,
        page.locator('input[type="search"]').first,
        # Last-ditch: any element with class containing "search"
        page.locator('[class*="search" i]').first,
    ]
    for i, cand in enumerate(candidates):
        try:
            if await cand.count() == 0:
                continue
            await cand.first.click(timeout=5_000)
            try:
                await page.locator('[role="listbox"]').wait_for(state="visible", timeout=8_000)
                log.debug("search pill opened via candidate %d", i)
                return
            except PlaywrightTimeoutError:
                # Click worked but listbox didn't appear — try next candidate
                continue
        except Exception:
            continue
    raise RuntimeError("Could not open the search autocomplete — listbox did not appear")


async def _collect_option_texts(page: Page) -> list[str]:
    """Open the search popup once and return all option texts from the listbox."""
    await _click_search_pill(page)
    listbox = page.locator('[role="listbox"]')
    await listbox.wait_for(state="visible", timeout=15_000)
    # Brief pause for all options to render
    await page.wait_for_timeout(1_500)
    options = listbox.locator('li[role="option"]')
    count = await options.count()
    log.info("Listbox contains %d options", count)
    texts: list[str] = []
    for i in range(count):
        try:
            t = (await options.nth(i).inner_text()).strip()
            if t:
                texts.append(t)
        except Exception as e:
            log.debug("Could not read listbox option %d: %s", i, e)
    return texts


# ---------------------------------------------------------------------------
# Navigation / dialog helpers
# ---------------------------------------------------------------------------


async def _try_dismiss_dialog(page: Page) -> bool:
    """Dismiss the 'part of <park>, click OK' modal if it's visible.

    Returns True if a dialog was found and dismissed.
    """
    for sel in [
        page.get_by_role("button", name=re.compile(r"^ok$", re.IGNORECASE)),
        page.locator('button:has-text("OK")').first,
        page.get_by_role("button", name=re.compile(r"^continue$", re.IGNORECASE)),
    ]:
        try:
            if await sel.count() > 0 and await sel.is_visible():
                await sel.click(timeout=2_000)
                log.debug("Dismissed park-redirect dialog")
                return True
        except Exception:
            pass
    return False


async def _dismiss_dialog_with_poll(page: Page, timeout_ms: int = 3_000) -> bool:
    """Poll for up to *timeout_ms* ms attempting to dismiss a dialog."""
    elapsed = 0
    while elapsed < timeout_ms:
        if await _try_dismiss_dialog(page):
            return True
        await page.wait_for_timeout(200)
        elapsed += 200
    return False


async def _recover_from_place_not_found(page: Page) -> None:
    """Navigate back to ``#!results`` from DOC's "place not found" screen.

    ``page.goto(LANDING_URL)`` from the not-found page is intercepted by the
    SPA and loops back to ``#!placenotfound``.  The only reliable exit is:

      1. Click the **"Go home"** button on the not-found page.
      2. Click the **"Book a campsite, hut or lodge"** link on the home page.

    After both clicks we verify we actually reached a ``#!results``-style URL
    and log a warning if we didn't.
    """
    log.debug("Recovering from place-not-found page …")

    # ── Step 1: click "Go home" ───────────────────────────────────────────
    home_clicked = False
    for sel in [
        page.get_by_role("link",   name=re.compile(r"go home", re.IGNORECASE)),
        page.get_by_role("button", name=re.compile(r"go home", re.IGNORECASE)),
        page.locator('a:has-text("Go home")').first,
        page.locator('a:has-text("Go Home")').first,
        page.locator('button:has-text("Go home")').first,
    ]:
        try:
            if await sel.count() > 0 and await sel.is_visible():
                await sel.click(timeout=5_000)
                home_clicked = True
                log.debug("Clicked 'Go home'")
                break
        except Exception:
            continue

    if not home_clicked:
        log.warning("'Go home' button not found on place-not-found page")
        # Can't use goto — it loops. Nothing more we can do here.
        return

    # Wait for the home page to render
    await page.wait_for_timeout(2_000)
    try:
        await page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeoutError:
        pass

    # ── Step 2: click "Book a campsite, hut or lodge" ────────────────────
    book_clicked = False
    for sel in [
        # Exact phrase variations the DOC home page may use
        page.get_by_role("link",   name=re.compile(r"book a campsite", re.IGNORECASE)),
        page.get_by_role("button", name=re.compile(r"book a campsite", re.IGNORECASE)),
        page.locator('a:has-text("Book a campsite")').first,
        page.locator('a:has-text("campsite, hut or lodge")').first,
        page.locator('a:has-text("hut or lodge")').first,
        # Broader fallback
        page.locator('a[href*="results"]').first,
    ]:
        try:
            if await sel.count() > 0 and await sel.is_visible():
                await sel.click(timeout=5_000)
                book_clicked = True
                log.debug("Clicked 'Book a campsite / hut or lodge'")
                break
        except Exception:
            continue

    if not book_clicked:
        log.warning("'Book a campsite, hut or lodge' link not found on home page")

    # Wait for #!results to settle
    await page.wait_for_timeout(2_000)
    try:
        await page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        pass

    if "results" not in page.url.lower():
        log.warning("Recovery may have failed — current URL: %s", page.url)
    else:
        log.debug("Recovered to: %s", page.url)


_PARK_TILE_RE = re.compile(r"#!park/(\d+)$")
# Matches the park-level segment of the URL (park page, no facility suffix)
_PARK_URL_RE = re.compile(r"park/(\d+)(?:[^/]|$)")

# Lines in tile text that are definitely NOT a park name
_TILE_NOISE_RE = re.compile(
    r"""
    ^\d+[\.,]?\d*\s*(km|m)\b     # distance: "0.0 km"
    | estimated                   # "Estimated drive time …"
    | book\s*now                  # "Book Now"
    | select\s*dates              # "Select Dates"
    | view\s*details              # "View Details"
    | check\s*availability        # "Check Availability"
    | next\s*available            # "Next Available …"
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _is_place_not_found(url: str) -> bool:
    return "placenotfound" in url.lower()


def _park_id_from_url(url: str) -> str | None:
    """Return the park_id if *url* is a park-level page (no facility segment)."""
    m = _PARK_TILE_RE.search(url)
    return m.group(1) if m else None


def _park_name_from_title(title: str) -> str:
    """Strip site-name suffixes from a browser ``<title>`` string."""
    for sep in (" | ", " - ", " – ", " — "):
        if sep in title:
            return title.split(sep)[0].strip()
    return title.strip()


async def _peek_primary_result(
    page: Page,
    timeout_ms: int = 15_000,
) -> tuple[str, str] | None:
    """Return ``(park_id, park_name)`` for the primary result WITHOUT clicking.

    Two cases handled:
    * **Results page** — page is still at ``#!results`` showing tile cards.
      Scans ``<a href="…#!park/{id}">`` anchors for the first park-level link
      and tries to extract the park name from the tile's visible text.
    * **Already on park page** — the "part of <park>" dialog was dismissed and
      the SPA navigated directly to ``#!park/{id}``.  We detect this via the
      current URL and get the park name from ``page.title()``.

    Returns ``None`` on timeout or when the DOC "place not found" page is shown.
    """
    elapsed = 0
    while elapsed < timeout_ms:
        # Fast-fail: redirected to DOC's "place not found" page
        if _is_place_not_found(page.url):
            return None

        # Case A: dialog dismissed us directly to the park page
        direct_park_id = _park_id_from_url(page.url)
        if direct_park_id:
            title = await page.title()
            park_name = _park_name_from_title(title) if title else ""
            return direct_park_id, park_name

        # Case B: still on #!results — scan tile anchors
        anchors = page.locator('a[href*="!park/"]')
        count = await anchors.count()
        for i in range(count):
            a = anchors.nth(i)
            try:
                href = (await a.get_attribute("href")) or ""
                m = _PARK_TILE_RE.search(href)
                if not m:
                    continue
                park_id = m.group(1)

                # Attempt to read park name from tile text (first meaningful line)
                park_name = ""
                try:
                    full_text = (await a.inner_text()).strip()
                    for line in full_text.splitlines():
                        line = line.strip()
                        if line and len(line) > 2 and not _TILE_NOISE_RE.match(line):
                            park_name = line
                            break
                except Exception:
                    pass

                return park_id, park_name
            except Exception:
                continue

        await page.wait_for_timeout(300)
        elapsed += 300

    return None


async def _click_primary_result_tile(
    page: Page,
    park_id: str,
    timeout_ms: int = 20_000,
) -> str | None:
    """Click the park tile for *park_id* and wait for the URL to update.

    Returns the actual park_id present in the URL once navigation completes
    (which should equal *park_id*), or ``None`` on timeout.  Using the URL
    as the source of truth means we still succeed when a dialog redirects us
    to a slightly different park.
    """
    # If we're already on a park page (dialog navigated us here), no click needed
    if direct := _park_id_from_url(page.url):
        return direct

    elapsed = 0
    while elapsed < timeout_ms:
        anchors = page.locator('a[href*="!park/"]')
        count = await anchors.count()
        for i in range(count):
            a = anchors.nth(i)
            try:
                href = (await a.get_attribute("href")) or ""
                m = _PARK_TILE_RE.search(href)
                if not m or m.group(1) != park_id:
                    continue
                log.debug("Clicking result tile for park %s", park_id)
                await a.scroll_into_view_if_needed()
                await a.click(timeout=5_000)
                # Wait for any park URL to appear in the address bar
                result = await _wait_for_park_url_in_address_bar(page)
                return result
            except Exception:
                continue
        await page.wait_for_timeout(300)
        elapsed += 300

    # Last-ditch: maybe we ended up on a park page despite the wait failing
    return _park_id_from_url(page.url)


async def _wait_for_park_url_in_address_bar(
    page: Page,
    timeout_ms: int = 20_000,
) -> str | None:
    """Poll until the address-bar URL is a park-level page.

    Returns the park_id found in the URL, or ``None`` on timeout.  Accepts
    any ``park/{id}`` URL so that dialog-redirected parks still count.
    """
    elapsed = 0
    while elapsed < timeout_ms:
        pk = _park_id_from_url(page.url)
        if pk:
            return pk
        await page.wait_for_timeout(300)
        elapsed += 300
    return None


# ---------------------------------------------------------------------------
# Park-page extraction
# ---------------------------------------------------------------------------


async def _extract_park_name(page: Page) -> str:
    """Extract the park name from the park page.

    The DOC booking SPA sets ``id="park-name"`` on the ``<h1>`` containing the
    park name.  We use that ID directly — it's far more reliable than
    ``page.title()`` (which returns "New Zealand") or generic ``<h1>`` scans
    (which pick up section headings like "Search Results").
    """
    try:
        el = page.locator("#park-name")
        # Wait up to 10s for the element to appear — the SPA may still be rendering
        await el.wait_for(state="visible", timeout=10_000)
        txt = (await el.first.inner_text()).strip()
        if txt and len(txt) > 2:
            return txt
    except Exception:
        pass
    # Fallback: try any h1 with data-wg-notranslate (DOC's park-name marker)
    try:
        el = page.locator('h1[data-wg-notranslate]')
        if await el.count() > 0:
            txt = (await el.first.inner_text()).strip()
            if txt and len(txt) > 2:
                return txt
    except Exception:
        pass
    return ""


async def _extract_facilities(
    page: Page,
    park_id: str,
    park_name: str,
    result: ScrapeResult,
) -> int:
    """Enumerate facility links on the park page and add them to *result*.

    Facilities appear in **two** sections on the park page:
    * **Search Results** — facilities with available sites (rendered first).
    * **Other Facilities** — facilities with no current availability but still
      bookable and therefore still worth cataloguing.

    We scroll the page to force both sections to render, then collect all
    ``<a href="…#!park/{park_id}/{facility_id}">`` links from both.

    Returns the number of new facilities added.
    """
    # networkidle + initial render wait are done by the caller (_process_option)
    # before _extract_park_name, so the page is already settled when we arrive.
    # Give the SPA a brief moment to finish painting the first section.
    await page.wait_for_timeout(1_000)

    # Scroll to the bottom so lazy-rendered "Other Facilities" cards load
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await page.wait_for_timeout(1_500)
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await page.wait_for_timeout(1_000)

    facility_url_re = re.compile(rf"#!park/{re.escape(park_id)}/(\d+)")
    anchors = page.locator(f'a[href*="park/{park_id}/"]')
    count = await anchors.count()
    log.debug("Park %s: %d facility link candidates (both sections)", park_id, count)

    added = 0
    seen: set[str] = set()

    for i in range(count):
        a = anchors.nth(i)
        try:
            href = (await a.get_attribute("href")) or ""
        except Exception:
            continue

        m = facility_url_re.search(href)
        if not m:
            continue
        facility_id = m.group(1)
        if facility_id in seen:
            continue
        seen.add(facility_id)

        # ── Facility name extraction ─────────────────────────────────────
        # The DOC booking SPA wraps each facility card in an <a> tag:
        #
        #   <a href="#!park/{park_id}/{facility_id}">
        #     <div class="py-5 px-4 flex-grow">
        #       <h3 data-wg-notranslate="manual">Kaiaraara Hut</h3>
        #       <p>Starting at $12.50</p>
        #     </div>
        #     <div ...><span>25</span><span>Available</span></div>
        #   </a>
        #
        # The facility name is ALWAYS the <h3> (or similar heading) inside the
        # anchor.  We must NOT use a.inner_text() directly — that returns the
        # entire card text ("Kaiaraara Hut\nStarting at $12.50\n25\nAvailable").
        #
        # Priority:
        # 1. Heading (h3/h2/h4) with data-wg-notranslate inside anchor — exact match
        # 2. Any heading inside anchor
        # 3. First non-noise line of anchor inner_text (stripped of price / count)
        # 4. Heading in immediate parent only (depth=1, avoids cross-card bleed)
        facility_name = ""

        # 1. Heading with data-wg-notranslate inside anchor (DOC's name marker)
        try:
            h = a.locator("[data-wg-notranslate]").first
            if await h.count() > 0:
                txt = (await h.inner_text()).strip()
                if txt and len(txt) > 1:
                    facility_name = txt
        except Exception:
            pass

        # 2. Any heading inside anchor
        if not facility_name:
            try:
                h = a.locator("h3, h2, h4, h1").first
                if await h.count() > 0:
                    txt = (await h.inner_text()).strip()
                    if txt and len(txt) > 1:
                        facility_name = txt
            except Exception:
                pass

        # 3. First non-noise line of anchor inner_text
        if not facility_name:
            _SKIP_LABELS = {
                "next available date", "book now", "view", "more info",
                "next available", "select dates", "check availability",
                "available", "unavailable",
            }
            try:
                full_text = (await a.inner_text()).strip()
                for line in full_text.splitlines():
                    line = line.strip()
                    # Skip blank lines, pure numbers ("25"), price lines, noise labels
                    if (line
                            and len(line) > 1
                            and line.lower() not in _SKIP_LABELS
                            and not re.match(r"^\d+$", line)
                            and not re.match(r"starting at", line, re.IGNORECASE)):
                        facility_name = line
                        break
            except Exception:
                pass

        # 4. Heading in immediate parent only (depth=1, avoids cross-card bleed)
        if not facility_name:
            try:
                parent = a.locator("xpath=ancestor::*[1]").first
                if await parent.count() > 0:
                    for hsel in ("h3, h2, h4, h1", '[class*="title" i]'):
                        h = parent.locator(hsel).first
                        if await h.count() > 0:
                            txt = (await h.inner_text()).strip()
                            if txt and len(txt) > 1:
                                facility_name = txt
                                break
            except Exception:
                pass

        if not facility_name:
            log.debug("Park %s: facility %s has no name — skipping", park_id, facility_id)
            continue

        result.add_facility(park_id, park_name, facility_id, facility_name)
        added += 1

    log.info("Park %s (%r): +%d facilities", park_id, park_name, added)
    return added


# ---------------------------------------------------------------------------
# Per-option processor
# ---------------------------------------------------------------------------


async def _process_option(
    page: Page,
    option_text: str,
    option_index: int,
    result: ScrapeResult,
    max_retries: int = 2,
) -> bool:
    """Click one listbox option and harvest its park page.

    The full flow (per the live site behaviour):
    1. Click the search pill on the **current** page — the pill is present
       on both ``#!results`` and ``#!park/…`` pages, so we avoid a round-
       trip back to the landing URL between options.  Only on retries do we
       reload ``#!results`` to recover from a broken page state.
    2. Click the option matching *option_text* in the autocomplete listbox.
    3. Dismiss the "part of <park> — click OK" dialog if it appears.
    4. The page re-renders at ``#!results`` with search result cards.
       Peek at the primary tile's href to get the park_id without clicking.
    5. Dedupe: if park_id is already in *result*, return True immediately
       (no tile click, no park-page navigation).
    6. Click the tile → ``#!park/{park_id}``.  Scrape facilities from both
       "Search Results" (available) and "Other Facilities" (unavailable).

    Retries up to *max_retries* times on failure; dumps artifacts on the
    final failure.  Returns True on success (including dedupe skips).
    """
    for attempt in range(max_retries + 1):
        try:
            log.debug("Option %d %r (attempt %d/%d)", option_index, option_text, attempt + 1, max_retries + 1)

            # ── 1. Ensure we're on a page that has the search pill ────────
            # On the first attempt we reuse whatever page the browser is
            # already on (either #!results or #!park/…) — both expose the
            # same location search pill.  On retries we navigate back to
            # the base URL so a half-broken page state doesn't carry over.
            if attempt > 0:
                log.debug("Retry %d: navigating back to %s", attempt, LANDING_URL)
                await page.goto(LANDING_URL, wait_until="domcontentloaded", timeout=60_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=20_000)
                except PlaywrightTimeoutError:
                    pass

            # ── 2. Open search popup ─────────────────────────────────────
            await _click_search_pill(page)
            listbox = page.locator('[role="listbox"]')
            await listbox.wait_for(state="visible", timeout=15_000)
            await page.wait_for_timeout(500)

            # ── 3. Click the matching listbox option ─────────────────────
            options = listbox.locator('li[role="option"]')
            opt_count = await options.count()
            clicked = False
            for j in range(opt_count):
                opt = options.nth(j)
                try:
                    txt = (await opt.inner_text()).strip()
                    if txt == option_text:
                        await opt.click(timeout=5_000)
                        clicked = True
                        break
                except Exception:
                    continue

            if not clicked:
                log.warning("Option %r not found in listbox", option_text)
                return False  # Text mismatch — not a transient error, skip retries

            # ── 4. Dismiss "part of <park>" dialog if present ────────────
            # Note: dismissing the dialog may navigate us directly to
            # #!park/{id}, bypassing the #!results tile step entirely.
            await _dismiss_dialog_with_poll(page, timeout_ms=3_000)

            # ── 5. Determine park_id (and candidate park_name from tile) ──
            # _peek_primary_result handles two cases:
            # (A) We're already on #!park/{id} — dialog navigated us there.
            # (B) Still on #!results — reads the tile href + tile text.
            peek = await _peek_primary_result(page, timeout_ms=15_000)
            if peek is None:
                # Place-not-found redirect — gracefully reset and skip
                if _is_place_not_found(page.url):
                    log.info(
                        "Option %d %r → place-not-found; skipping (no retry)",
                        option_index, option_text,
                    )
                    await _recover_from_place_not_found(page)
                    return False
                raise RuntimeError(
                    f"Primary result tile / park URL not found after selecting {option_text!r}"
                )

            park_id, tile_park_name = peek

            # ── Dedupe — skip everything for already-known parks ──────────
            if park_id in result.parks:
                log.debug(
                    "Park %s already processed — skipping (from %r)", park_id, option_text
                )
                return True

            # ── 6. Click the tile if we're still on #!results ────────────
            # If Case A applied (already on park page), _click_primary_result_tile
            # detects this via the URL and returns immediately without clicking.
            actual_park_id = await _click_primary_result_tile(page, park_id, timeout_ms=20_000)
            if not actual_park_id:
                raise RuntimeError(
                    f"Did not reach a park page after clicking tile for {option_text!r}"
                )
            if actual_park_id != park_id:
                log.info(
                    "Option %d %r: redirected from park %s to park %s",
                    option_index, option_text, park_id, actual_park_id,
                )
                park_id = actual_park_id
                if park_id in result.parks:
                    log.debug("Redirected park %s already processed — skipping", park_id)
                    return True

            # ── 7. Extract park name and facilities ───────────────────────
            # Wait for the SPA to finish rendering the new park page before
            # reading #park-name.  Without this, the element is still visible
            # from the *previous* park while the new content loads, causing
            # the old name to be returned immediately.
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(500)

            # Primary: #park-name element on the park page.
            # Fallback: tile text captured during peek (Case B, results page).
            park_name = await _extract_park_name(page) or tile_park_name
            log.info("Option %d: park_id=%s park_name=%r", option_index, park_id, park_name)

            await _extract_facilities(page, park_id, park_name, result)
            return True

        except Exception as e:
            log.warning(
                "Option %d %r attempt %d/%d failed: %s",
                option_index, option_text, attempt + 1, max_retries + 1, e,
            )
            if attempt == max_retries:
                log.error(
                    "Option %d %r exhausted all %d attempts — saving artifacts",
                    option_index, option_text, max_retries + 1,
                )
                await snapshot(page, f"option_{option_index:04d}_failed")

    return False


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def scrape(*, headful: bool, debug: bool, out_path: Path, dry_run: bool = False) -> ScrapeResult:
    result = ScrapeResult()

    # Resume from an existing catalog so already-scraped parks are not revisited.
    n_loaded = result.load_from_file(out_path)
    if n_loaded:
        log.info(
            "Resumed from %s: %d parks / %d facilities already known",
            out_path, n_loaded, result.facility_count,
        )

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not headful,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="en-NZ",
            timezone_id="Pacific/Auckland",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        # ── Phase 1: collect all option texts in one pass ────────────────
        log.info("Opening landing page: %s", LANDING_URL)
        await page.goto(LANDING_URL, wait_until="domcontentloaded", timeout=60_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=20_000)
        except PlaywrightTimeoutError:
            pass

        option_texts: list[str] = []
        try:
            option_texts = await _collect_option_texts(page)
        except Exception as e:
            await snapshot(page, "collect_options_failed")
            log.error("Could not collect listbox options: %s", e)
            await context.close()
            await browser.close()
            return result

        if not option_texts:
            await snapshot(page, "no_options_found")
            log.error("Listbox returned zero options — check the snapshot in %s", ARTIFACTS_DIR)
            await context.close()
            await browser.close()
            return result

        log.info("Processing %d listbox options …", len(option_texts))

        # ── Phase 2: click through every option ──────────────────────────
        import random
        succeeded = 0
        skipped = 0
        failed = 0
        active_requests = 0  # counts options that actually hit the network
        # Pre-filter: names (park + facility) already in the catalog.
        # Rebuilt after each successful new-park scrape so the set grows
        # as the run progresses, skipping more and more options over time.
        known = result.known_names()

        for i, option_text in enumerate(option_texts):
            if i > 0 and i % 10 == 0:
                log.info(
                    "Progress: %d/%d options — %d parks, %d facilities, "
                    "%d skipped, %d failed",
                    i, len(option_texts), len(result.parks),
                    result.facility_count, skipped, failed,
                )
                if not dry_run:
                    write_output(result, out_path)

            # Fast skip: option text matches a park or facility name we already have
            if option_text.lower() in known:
                log.debug("Skipping already-known option %r", option_text)
                skipped += 1
                continue

            # Rest every 40 active (non-skipped) requests to avoid throttling
            if active_requests > 0 and active_requests % 40 == 0:
                log.info("Pausing 20s after %d active requests …", active_requests)
                await page.wait_for_timeout(20_000)

            parks_before = len(result.parks)
            ok = await _process_option(page, option_text, i, result)
            active_requests += 1
            if ok:
                succeeded += 1
                # If a new park was added, refresh the skip set so subsequent
                # options that name its facilities are also bypassed
                if len(result.parks) > parks_before:
                    known = result.known_names()
            else:
                failed += 1
            # Brief random pause between active requests
            await page.wait_for_timeout(random.randint(800, 2_000))

        log.info(
            "Finished: %d/%d options — %d new, %d skipped, %d failed | "
            "%d parks, %d facilities total",
            succeeded + skipped + failed, len(option_texts),
            succeeded, skipped, failed,
            len(result.parks), result.facility_count,
        )

        await context.close()
        await browser.close()

    return result


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_output(result: ScrapeResult, out_path: Path) -> None:
    payload = {
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "bookings.doc.govt.nz",
        "parks": result.to_parks(),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    log.info(
        "Wrote %d parks / %d facilities → %s",
        len(payload["parks"]),
        sum(len(p["facilities"]) for p in payload["parks"]),
        out_path,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--headful", action="store_true", help="run browser visibly")
    parser.add_argument("--debug", action="store_true", help="verbose logging")
    parser.add_argument("--dry-run", action="store_true", help="do not write output file")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output JSON path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    try:
        result = asyncio.run(
            scrape(headful=args.headful, debug=args.debug, out_path=args.out, dry_run=args.dry_run)
        )
    except KeyboardInterrupt:
        log.error("interrupted")
        return 130
    except Exception as e:
        log.exception("scrape failed: %s", e)
        return 1

    if not result.parks:
        log.error(
            "No parks collected — check snapshots in %s for clues, then adjust "
            "the selectors in _click_search_pill / _extract_facilities.",
            ARTIFACTS_DIR,
        )
        return 2

    if args.dry_run:
        log.info("--dry-run: not writing output")
        for park in list(result.parks.values())[:10]:
            log.info("  Park %s: %r (%d facilities)", park.park_id, park.park_name, len(park.facilities))
            for f in park.facilities[:3]:
                log.info("    facility %s: %r", f.facility_id, f.facility_name)
        if len(result.parks) > 10:
            log.info("  … (+%d more parks)", len(result.parks) - 10)
        return 0

    write_output(result, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
