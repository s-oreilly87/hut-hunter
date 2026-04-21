#!/usr/bin/env python3
"""Scrape DOC Great Walk sites from bookings.doc.govt.nz.

Writes ``backend/app/adapters/great_walks.json`` with per-track site data::

    {
      "scraped_at": "2026-04-21T...",
      "source": "bookings.doc.govt.nz",
      "great_walks": [
        {
          "id": "routeburn-track",
          "name": "Routeburn Track",
          "directions": ["Routeburn Shelter – The Divide", "The Divide - Routeburn Shelter"],
          "sites": [
            {"siteName": "Routeburn Flats Hut", "type": "hut"},
            {"siteName": "Routeburn Flats Camp", "type": "camp"},
            ...
          ]
        },
        ...
      ]
    }

Strategy
--------
The DOC booking site is a React SPA sitting behind a Queue-It waiting room.
Playwright handles the Queue-It cookie handshake automatically.

1. Open the great walk booking form (``#!greatwalk-result``).
2. Read all track names from the Track dropdown.
3. For each track:
   a. Select the track in the dropdown.
   b. Read available direction options (if the direction dropdown is present
      and enabled) — these become the track's ``directions`` list.
   c. Fill a future start date (~70 days out), nights = first available
      option, people = 1.
   d. Select the first direction (if any), then click "Search".
   e. Wait for ``table.js-book-modal`` to appear.
   f. Read every ``a.gridParkLink span`` in the table's first column —
      these are the site names in track order.
   g. Infer site type (hut/camp/shelter) from the name.
4. Write the sorted JSON output.

Usage::

    # from ``backend/`` with Playwright installed:
    python scripts/scrape_great_walks.py                 # headless
    python scripts/scrape_great_walks.py --headful       # watch it run
    python scripts/scrape_great_walks.py --dry-run       # no write
    python scripts/scrape_great_walks.py --out path.json # custom path
    python scripts/scrape_great_walks.py --debug         # verbose log
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
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
DEFAULT_OUT = REPO_ROOT / "app" / "adapters" / "great_walks.json"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"

BASE_URL = "https://bookings.doc.govt.nz/Web/Default.aspx#!greatwalk-result"

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

log = logging.getLogger("scrape_great_walks")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Site:
    site_name: str
    type: str  # "hut" | "camp" | "shelter"


@dataclass
class GreatWalk:
    name: str
    id: str
    directions: list[str] = field(default_factory=list)
    sites: list[Site] = field(default_factory=list)


def _slugify(name: str) -> str:
    """Convert a track name to a URL-friendly id slug."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def _infer_site_type(name: str) -> str:
    """Infer site type from the site name."""
    n = name.lower()
    if "hut" in n or "lodge" in n or "chalet" in n:
        return "hut"
    if "camp" in n or "campsite" in n:
        return "camp"
    if "shelter" in n:
        return "shelter"
    return "hut"  # sensible default


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
# Dropdown helpers
# ---------------------------------------------------------------------------


async def _get_role_options(page: Page, btn_selector: str) -> list[str]:
    """Click a dropdown button and collect all role='option' texts, then close."""
    await page.locator(btn_selector).click(timeout=8_000)
    await page.wait_for_timeout(700)

    options = page.get_by_role("option")
    try:
        await options.first.wait_for(state="visible", timeout=5_000)
    except PlaywrightTimeoutError:
        await page.keyboard.press("Escape")
        return []

    count = await options.count()
    texts: list[str] = []
    for i in range(count):
        try:
            txt = (await options.nth(i).inner_text()).strip()
            if txt:
                texts.append(txt)
        except Exception:
            continue

    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)
    return texts


async def _select_role_option(page: Page, btn_selector: str, option_text: str) -> None:
    """Click a dropdown button and select the option matching option_text."""
    await page.locator(btn_selector).click(timeout=8_000)
    await page.wait_for_timeout(600)
    await page.get_by_role("option").filter(has_text=option_text).first.click(timeout=5_000)
    await page.wait_for_timeout(400)


async def _get_box_options(page: Page, box_selector: str) -> list[str]:
    """Read option texts from a dropdown box via the li > a > span pattern."""
    items = page.locator(f"{box_selector} li a span")
    count = await items.count()
    texts: list[str] = []
    for i in range(count):
        try:
            txt = (await items.nth(i).inner_text()).strip()
            if txt:
                texts.append(txt)
        except Exception:
            continue
    return texts


# ---------------------------------------------------------------------------
# Date picker helper
# ---------------------------------------------------------------------------


async def _set_start_date(page: Page, target: datetime) -> None:
    """Open the great-walk date picker and navigate to target date."""
    btn = page.locator("#great-walk-start-date")
    await btn.scroll_into_view_if_needed()
    await btn.click(force=True)

    popper = page.locator(".react-datepicker-popper:visible")
    try:
        await popper.wait_for(state="visible", timeout=10_000)
    except PlaywrightTimeoutError:
        log.warning("Date picker popper did not appear — skipping date set")
        return

    # Find month header
    header = popper.locator(".react-datepicker__current-month").first
    if await header.count() == 0:
        month_pattern = re.compile(
            r"^(January|February|March|April|May|June|July|August"
            r"|September|October|November|December)\s+\d{4}$"
        )
        header = popper.get_by_text(month_pattern, exact=False).first

    next_btn = popper.locator(
        'button[aria-label="Next Month"], button.react-datepicker__navigation--next'
    ).first

    target_month = MONTHS[target.month - 1]
    target_year = target.year
    target_idx = target_year * 12 + (target.month - 1)

    for _ in range(24):
        try:
            cur_text = (await header.inner_text()).strip()
            parts = cur_text.split()
            if len(parts) == 2 and parts[0] in MONTHS:
                cur_idx = int(parts[1]) * 12 + MONTHS.index(parts[0])
                if cur_idx == target_idx:
                    break
                await next_btn.click()
                await page.wait_for_timeout(400)
        except Exception:
            break

    # Click the target day
    day = target.day
    day_regex = re.compile(
        rf"Choose .*?, {target_month} {day}(st|nd|rd|th)?, {target_year}",
        re.IGNORECASE,
    )
    day_btn = popper.get_by_role("button", name=day_regex)
    if await day_btn.count() > 0:
        await day_btn.first.click()
    else:
        await popper.get_by_text(re.compile(rf"^{day}$")).first.click()

    await page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# Per-track scraper
# ---------------------------------------------------------------------------


async def _scrape_track(page: Page, track_name: str, future_date: datetime) -> GreatWalk:
    """
    Select one track, fill the search form, wait for the results table,
    and extract site names + inferred types.

    Direction discovery: we first read the direction dropdown options (if the
    dropdown is present and enabled) before selecting the track, because some
    tracks have no direction and the element may not exist at all.
    """
    log.info("Scraping track: %r", track_name)
    walk = GreatWalk(name=track_name, id=_slugify(track_name))

    # ── 1. Select the track ──────────────────────────────────────────────────
    await _select_role_option(page, "#great-walk-dropdown-button", track_name)
    await page.wait_for_timeout(1_000)

    # ── 2. Read directions ───────────────────────────────────────────────────
    dir_btn = page.locator("#great-walk-direction-dropdown-button")
    directions: list[str] = []
    if await dir_btn.count() > 0:
        try:
            is_disabled = await dir_btn.get_attribute("disabled")
            aria_disabled = await dir_btn.get_attribute("aria-disabled")
            if is_disabled is None and aria_disabled != "true":
                directions = await _get_role_options(page, "#great-walk-direction-dropdown-button")
                log.info("  directions: %s", directions)
        except Exception as e:
            log.debug("  direction dropdown read failed: %s", e)
    walk.directions = directions

    # ── 3. Set date ──────────────────────────────────────────────────────────
    await _set_start_date(page, future_date)

    # ── 4. Nights — pick the first available option ──────────────────────────
    nights_btn = page.locator("#great-walk-night-dropdown-button")
    if await nights_btn.count() > 0:
        try:
            night_opts = await _get_box_options(page, "#great-walk-night-dropdown-box")
            if night_opts:
                first_night = night_opts[0]
                log.debug("  selecting nights: %r", first_night)
                await page.locator("#great-walk-night-dropdown-button").click(timeout=5_000)
                await page.wait_for_timeout(400)
                await page.get_by_role("option").filter(has_text=re.compile(rf"^{re.escape(first_night)}")).first.click()
                await page.wait_for_timeout(400)
        except Exception as e:
            log.debug("  could not set nights: %s", e)

    # ── 5. People = 1 ────────────────────────────────────────────────────────
    try:
        await _select_role_option(page, "#great-walk-people-dropdown-button", "1")
    except Exception as e:
        log.debug("  could not set people: %s", e)

    # ── 6. Direction — select first if available ──────────────────────────────
    if directions:
        try:
            await _select_role_option(
                page, "#great-walk-direction-dropdown-button", directions[0]
            )
            log.debug("  selected direction: %r", directions[0])
        except Exception as e:
            log.warning("  could not select direction %r: %s", directions[0], e)

    # ── 7. Click Search ───────────────────────────────────────────────────────
    try:
        search_btn = page.get_by_role("button", name=re.compile(r"^search$", re.IGNORECASE))
        await search_btn.scroll_into_view_if_needed()
        await search_btn.click(timeout=10_000, force=True)
        await page.wait_for_load_state("networkidle", timeout=30_000)
        await page.locator("table.js-book-modal").wait_for(state="visible", timeout=45_000)
        log.info("  search succeeded")
    except Exception as e:
        log.warning("  search failed for %r: %s", track_name, e)
        await snapshot(page, f"search_failed_{_slugify(track_name)}")
        return walk

    # ── 8. Read site names from the first column ──────────────────────────────
    table = page.locator("table.js-book-modal")
    site_links = table.locator("a.gridParkLink span")
    count = await site_links.count()
    log.info("  found %d site links", count)

    seen: set[str] = set()
    for i in range(count):
        try:
            txt = (await site_links.nth(i).inner_text()).strip()
        except Exception:
            continue
        if txt and txt not in seen:
            seen.add(txt)
            site_type = _infer_site_type(txt)
            walk.sites.append(Site(site_name=txt, type=site_type))
            log.debug("    site: %r (%s)", txt, site_type)

    return walk


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def scrape(
    *,
    headful: bool,
    debug: bool,
    out_path: Path,
    dry_run: bool = False,
) -> list[GreatWalk]:
    great_walks: list[GreatWalk] = []

    # Target date: ~70 days from today (well inside the booking window)
    future_date = datetime.now() + timedelta(days=70)

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

        # ── Phase 1: Open the form and collect track names ───────────────────
        log.info("Opening: %s", BASE_URL)
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=20_000)
        except PlaywrightTimeoutError:
            pass

        try:
            await page.locator('div[role="search"]').wait_for(state="visible", timeout=45_000)
        except PlaywrightTimeoutError:
            await snapshot(page, "form_not_found")
            log.error("Great walk search form did not load")
            await context.close()
            await browser.close()
            return great_walks

        log.info("Collecting track options...")
        track_names: list[str] = []
        try:
            track_names = await _get_role_options(page, "#great-walk-dropdown-button")
            log.info("Found %d tracks: %s", len(track_names), track_names)
        except Exception as e:
            await snapshot(page, "collect_tracks_failed")
            log.error("Could not collect track options: %s", e)
            await context.close()
            await browser.close()
            return great_walks

        if not track_names:
            log.error("No tracks found in the dropdown")
            await context.close()
            await browser.close()
            return great_walks

        # ── Phase 2: Scrape each track ───────────────────────────────────────
        for i, track_name in enumerate(track_names):
            log.info("--- Track %d/%d: %r ---", i + 1, len(track_names), track_name)

            # Reload the form for a clean state each iteration
            try:
                await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=20_000)
                except PlaywrightTimeoutError:
                    pass
                await page.locator('div[role="search"]').wait_for(state="visible", timeout=30_000)
            except Exception as e:
                log.warning("Could not reload form before track %r: %s", track_name, e)
                continue

            try:
                walk = await _scrape_track(page, track_name, future_date)
                great_walks.append(walk)
                log.info(
                    "  ✓ %r: %d directions, %d sites",
                    track_name,
                    len(walk.directions),
                    len(walk.sites),
                )
            except Exception as e:
                log.warning("  ✗ Failed to scrape %r: %s", track_name, e)
                await snapshot(page, f"track_{i:02d}_failed")

            # Brief pause between tracks to avoid throttling
            await page.wait_for_timeout(1_000)

        await context.close()
        await browser.close()

    return great_walks


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_output(great_walks: list[GreatWalk], out_path: Path) -> None:
    payload = {
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "bookings.doc.govt.nz",
        "great_walks": [
            {
                "id": w.id,
                "name": w.name,
                "directions": w.directions,
                "sites": [
                    {"siteName": s.site_name, "type": s.type}
                    for s in w.sites
                ],
            }
            for w in sorted(great_walks, key=lambda w: w.name.lower())
        ],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    total_sites = sum(len(w.sites) for w in great_walks)
    log.info(
        "Wrote %d great walks / %d sites → %s",
        len(great_walks),
        total_sites,
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
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help="output JSON path"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    try:
        great_walks = asyncio.run(
            scrape(
                headful=args.headful,
                debug=args.debug,
                out_path=args.out,
                dry_run=args.dry_run,
            )
        )
    except KeyboardInterrupt:
        log.error("interrupted")
        return 130
    except Exception as e:
        log.exception("scrape failed: %s", e)
        return 1

    if not great_walks:
        log.error(
            "No great walks collected — check snapshots in %s for clues",
            ARTIFACTS_DIR,
        )
        return 2

    if args.dry_run:
        log.info("--dry-run: not writing output")
        for walk in great_walks:
            log.info(
                "  %s: %d directions, %d sites",
                walk.name,
                len(walk.directions),
                len(walk.sites),
            )
            for site in walk.sites[:5]:
                log.info("    %s (%s)", site.site_name, site.type)
            if len(walk.sites) > 5:
                log.info("    … (+%d more sites)", len(walk.sites) - 5)
        return 0

    write_output(great_walks, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
