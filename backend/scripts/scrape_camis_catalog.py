#!/usr/bin/env python3
"""Scrape a Camis reservation site's bookable catalog into JSON.

Parameterized by ``--base-url`` so the *same* script covers every Camis
instance — BC Parks, Ontario Parks, and (per recon) the other Camis provinces
(NS/NB/Yukon/NL, Parks Canada). Analogous to ``scrape_great_walks.py`` /
``scrape_standard_huts.py``, but where those drive a Playwright browser, this
is plain HTTP: recon (docs/adapters/camis-recon.md §2) established that the
Camis ``/api/*`` catalog endpoints answer **unauthenticated**.

The clean enumeration endpoint is ``GET /api/resourcelocation`` — it returns
every bookable resource location (park) with localized names, region, timezone,
and category ids. This avoids the fragile visual ``/api/maps`` tree entirely.

Output (written to ``backend/app/adapters/<slug>.json`` by default)::

    {
      "scraped_at": "2026-07-05T19:30:00Z",
      "source": "camping.bcparks.ca",
      "base_url": "https://camping.bcparks.ca",
      "culture": "en-CA",
      "booking_categories": [
        {"booking_category_id": 0, "booking_model": 0, "name": "Campsite"},
        ...
      ],
      "equipment": [
        {"equipment_category_id": -32768, "name": "Equipment", "order": 1,
         "sub_categories": [
           {"sub_equipment_category_id": -32768, "name": "1 Tent", "order": 1},
           ...
         ]},
        ...
      ],
      "parks": [
        {
          "resource_location_id": -2147483646,
          "short_name": "Bamberton",
          "full_name": "Bamberton Provincial Park",
          "region": null,
          "timezone": "America/Vancouver",
          "transaction_location_id": 123,
          "resource_category_ids": [-2147483648]
        },
        ...
      ]
    }

The park list feeds the concrete adapters' ``param_fields()`` (HH-102 / HH-104);
``resource_location_id`` is the key the availability endpoint
(``/api/dateschedule/resourcelocationid``) and the search flow key off.

Usage::

    python backend/scripts/scrape_camis_catalog.py \
        --base-url https://camping.bcparks.ca --slug bc_parks
    python backend/scripts/scrape_camis_catalog.py \
        --base-url https://reservations.ontarioparks.ca --slug ontario_parks --culture en-CA
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx


log = logging.getLogger("scrape_camis_catalog")

# A realistic desktop UA. The Camis edge (Azure Front Door + WAF, recon §5)
# intermittently serves a challenge HTML page to non-browser clients; browser
# headers plus a retry on non-JSON get past it.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

ADAPTERS_DIR = Path(__file__).resolve().parents[1] / "app" / "adapters"

RESOURCE_LOCATION_PATH = "/api/resourcelocation"
BOOKING_CATEGORIES_PATH = "/api/bookingcategories"
EQUIPMENT_PATH = "/api/equipment"


# --------------------------------------------------------------------------- #
# Pure transforms (unit-tested without network)
# --------------------------------------------------------------------------- #

def _pick_localized(values: list[dict] | None, culture: str, field: str) -> str | None:
    """Return ``field`` from the localized-values entry matching ``culture``.

    Falls back to the same language prefix (e.g. any ``en-*`` when asked for
    ``en-CA``), then to the first entry, then ``None``.
    """
    values = values or []
    if not values:
        return None
    lang = culture.split("-")[0].lower()
    exact = next((v for v in values if (v.get("cultureName") or "").lower() == culture.lower()), None)
    same_lang = next((v for v in values if (v.get("cultureName") or "").lower().startswith(lang)), None)
    chosen = exact or same_lang or values[0]
    val = chosen.get(field)
    return val if val else None


def normalize_parks(raw: list[dict], culture: str = "en-CA") -> list[dict]:
    """Normalize ``/api/resourcelocation`` entries into catalog park dicts.

    Keeps only entries with a localized full name (drops nameless system rows),
    de-duplicates by ``resource_location_id``, and sorts by full name.
    """
    parks: dict[int, dict] = {}
    for entry in raw:
        rl_id = entry.get("resourceLocationId")
        if rl_id is None:
            continue
        localized = entry.get("localizedValues")
        full_name = _pick_localized(localized, culture, "fullName")
        short_name = _pick_localized(localized, culture, "shortName")
        if not full_name:
            # Nameless entries are internal/system locations, not bookable parks.
            continue
        parks[rl_id] = {
            "resource_location_id": rl_id,
            "short_name": short_name or full_name,
            "full_name": full_name,
            "region": entry.get("region"),
            "timezone": entry.get("ianaTimeZone"),
            "transaction_location_id": entry.get("transactionLocationId"),
            # root_map_id is the mapId the availability endpoint keys off
            # (/api/availability/map?mapId=...); the adapter resolves it per park.
            "root_map_id": entry.get("rootMapId"),
            "resource_category_ids": entry.get("resourceCategoryIds") or [],
        }
    return sorted(parks.values(), key=lambda p: p["full_name"].lower())


def normalize_booking_categories(raw: list[dict], culture: str = "en-CA") -> list[dict]:
    """Normalize ``/api/bookingcategories`` into id/model/name triples."""
    out = []
    for cat in raw:
        cat_id = cat.get("bookingCategoryId")
        if cat_id is None:
            continue
        out.append({
            "booking_category_id": cat_id,
            "booking_model": cat.get("bookingModel"),
            "name": _pick_localized(cat.get("localizedValues"), culture, "name"),
        })
    return sorted(out, key=lambda c: c["booking_category_id"])


def normalize_equipment(raw: list[dict], culture: str = "en-CA") -> list[dict]:
    """Normalize ``/api/equipment`` into category → sub-category trees.

    THR-132: ``/api/equipment`` is a **flat, site-level** list — it returns the
    same equipment tree regardless of ``bookingCategoryId`` (confirmed live
    2026-07-08 on BC Parks, Ontario Parks, and Parks Canada), so it's fetched
    once per site. Each top-level entry is an equipment *category* (e.g.
    "Equipment" for frontcountry, "Backcountry" on Parks Canada); its
    ``subEquipmentCategories`` are the actual tent/RV sizes the availability
    read (``equipmentCategoryId`` / ``subEquipmentCategoryId``) and the reserve
    funnel filter on. All three sites share the same id enum (category
    ``-32768`` "Equipment", sub ``-32768`` = the smallest/first tent), differing
    only in labels ("1 Tent" / "Single Tent" / "Small Tent").
    """
    out = []
    for cat in raw:
        cat_id = cat.get("equipmentCategoryId")
        if cat_id is None:
            continue
        subs = []
        for sub in cat.get("subEquipmentCategories") or []:
            sub_id = sub.get("subEquipmentCategoryId")
            if sub_id is None:
                continue
            subs.append({
                "sub_equipment_category_id": sub_id,
                "name": _pick_localized(sub.get("localizedValues"), culture, "name"),
                "order": sub.get("order"),
            })
        out.append({
            "equipment_category_id": cat_id,
            "name": _pick_localized(cat.get("localizedValues"), culture, "name"),
            "order": cat.get("order"),
            "sub_categories": subs,
        })
    return out


def build_catalog(
    base_url: str,
    resource_locations: list[dict],
    booking_categories: list[dict],
    culture: str,
    *,
    equipment: list[dict] | None = None,
    now: datetime | None = None,
) -> dict:
    """Assemble the final catalog dict from raw API responses."""
    now = now or datetime.now(timezone.utc)
    host = urlparse(base_url).netloc or base_url
    return {
        "scraped_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": host,
        "base_url": base_url.rstrip("/"),
        "culture": culture,
        "booking_categories": normalize_booking_categories(booking_categories, culture),
        "equipment": normalize_equipment(equipment or [], culture),
        "parks": normalize_parks(resource_locations, culture),
    }


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def fetch_json(client: httpx.Client, base_url: str, path: str, *, retries: int = 3) -> list[dict]:
    """GET a Camis API path and parse JSON, retrying past WAF challenge pages.

    The WAF sometimes returns an HTML challenge (``text/html``) instead of the
    JSON payload; those are transient, so retry a few times with a short backoff
    before giving up.
    """
    url = f"{base_url.rstrip('/')}{path}"
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = client.get(url)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if "json" not in ctype and resp.text.lstrip()[:1] not in "[{":
                raise ValueError(f"non-JSON response (content-type={ctype!r}) — likely a WAF challenge")
            return resp.json()
        except Exception as e:  # noqa: BLE001 — retry any transient failure
            last_err = e
            log.warning("fetch %s attempt %d/%d failed: %s", path, attempt, retries, e)
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"failed to fetch {url} after {retries} attempts: {last_err}")


def scrape(base_url: str, culture: str) -> dict:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": culture,
    }
    with httpx.Client(timeout=30.0, headers=headers, follow_redirects=True) as client:
        log.info("fetching resource locations from %s%s", base_url, RESOURCE_LOCATION_PATH)
        resource_locations = fetch_json(client, base_url, RESOURCE_LOCATION_PATH)
        log.info("fetching booking categories from %s%s", base_url, BOOKING_CATEGORIES_PATH)
        booking_categories = fetch_json(client, base_url, BOOKING_CATEGORIES_PATH)
        log.info("fetching equipment from %s%s", base_url, EQUIPMENT_PATH)
        equipment = fetch_json(client, base_url, EQUIPMENT_PATH)
    return build_catalog(
        base_url, resource_locations, booking_categories, culture, equipment=equipment
    )


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _default_out(slug: str) -> Path:
    return ADAPTERS_DIR / f"{slug}.json"


def write_output(catalog: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    log.info(
        "wrote %d parks + %d booking categories + %d equipment categories → %s",
        len(catalog["parks"]), len(catalog["booking_categories"]),
        len(catalog.get("equipment") or []), out_path,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="Camis site origin, e.g. https://camping.bcparks.ca")
    parser.add_argument("--slug", help="Output basename (default: derived from host, e.g. camping_bcparks_ca)")
    parser.add_argument("--out", type=Path, help="Explicit output path (overrides --slug)")
    parser.add_argument("--culture", default="en-CA", help="Localization culture for names (default: en-CA)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and summarize, but don't write")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    try:
        catalog = scrape(args.base_url, args.culture)
    except Exception as e:  # noqa: BLE001
        log.exception("scrape failed: %s", e)
        return 1

    if not catalog["parks"]:
        log.error("No parks collected from %s%s — check the endpoint/UA.", args.base_url, RESOURCE_LOCATION_PATH)
        return 2

    if args.dry_run:
        log.info("--dry-run: %d parks, %d booking categories (not writing)",
                 len(catalog["parks"]), len(catalog["booking_categories"]))
        for park in catalog["parks"][:10]:
            log.info("  rl=%s %r [%s]", park["resource_location_id"], park["full_name"], park["timezone"])
        if len(catalog["parks"]) > 10:
            log.info("  … (+%d more)", len(catalog["parks"]) - 10)
        return 0

    slug = args.slug or (urlparse(args.base_url).netloc or "camis").replace(".", "_").replace("-", "_")
    out_path = args.out or _default_out(slug)
    write_output(catalog, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
