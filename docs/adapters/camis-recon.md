# Camis platform recon — BC Parks & Ontario Parks

> **SYNCED TO DOCS** — 2026-07-08. Covers M1–M5 build plus post-launch hardening (THR-122–133). Linear project overview synced same date.

**Milestone:** M1 — Recon & documentation groundwork
**Covers Linear issues:** HH-95 (BC recon), HH-96 (Ontario recon + diff), HH-97 (anti-bot / sessions / hold window)
**Recon date:** 2026-07-05
**Method:** unauthenticated HTTP probing of the two live sites + static analysis of the shipped Angular bundles. No live booking session was driven, so anything that requires reaching the cart (occupant fields, exact hold duration) is flagged **OPEN** below and must be confirmed with a headed Playwright pass in M2.

Targets:

- **BC Parks** — `https://camping.bcparks.ca`
- **Ontario Parks** — `https://reservations.ontarioparks.ca`

Both are confirmed to run the **Camis** reservation platform. The two sites ship the **same Angular application** and the **same `/api/*` backend contract**; they differ only in base URL, catalog data, and localization. This validates the project's core bet: one `BaseCamisAdapter` plus thin per-province subclasses.

---

## 1. Platform fingerprint

| Signal | BC Parks | Ontario Parks |
|---|---|---|
| App shell | Angular SPA, `<title>Home Page</title>` | Angular SPA, `<title>Home Page</title>` |
| Bundling | esbuild-style `main-<hash>.js` + lazy `chunk-<HASH>.js` | same |
| Edge | Azure Front Door (`x-azure-ref`, `x-cache: PRIVATE_NOSTORE`) | same, with a more aggressive **Azure WAF** (see §5) |
| Waiting room | **Queue-it**, `customerId: "camis"`, `appUrlDomain: "camping.bcparks.ca"` | **Queue-it**, `customerId: "camis"`, per-site `appUrlDomain` |
| Support chat | Amazon Connect (`*.connect.ca-central-1.amazonaws.com`) in CSP `connect-src` | same |
| Backend | JSON REST under `/api/*` | same, identical response shapes |

**Key architectural difference from the existing DOC adapters:** DOC (`base_doc.py`) is a server-rendered ASP.NET flow — availability and checkout are scraped straight from the DOM (`#mainContent_bCheckOut`, `**/CreditCardPayment**`, `#FirstName_N`). Camis is a **client-side Angular app talking to a JSON API**. The DOC selector-scraping approach does **not** transfer. Camis availability and catalog data should be read from `/api/*` JSON; only the cart/checkout hand-off needs a driven browser. This is the single biggest design input for `BaseCamisAdapter`.

---

## 2. Catalog & search API (feeds `param_fields` / the scraper — HH-101)

All of the following return JSON **unauthenticated** on both sites (verified 2026-07-05 with a browser User-Agent). This means the site catalog can be scraped over plain HTTP — no DOM walking, no Playwright — a major simplification versus the DOC scrapers.

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /api/maps/root` | Top-level region tree (organization root) | Returns region nodes with `mapLinks[]`; each link has `childMapId`, `resourceLocationId`, `localizations[].title`, and map coordinates. BC root = 4 regions (Southern Interior, Northern, Coastal Mainland, Islands). |
| `GET /api/maps?resourceLocationId=<id>` | Map for a given location | Service call is `getMaps(resourceLocationId)`; drill the tree to reach bookable parks (leaf links have a non-null `resourceLocationId`). |
| `GET /api/bookingcategories` | Booking category taxonomy | Per-site. BC: `Campsite`, … ; Ontario: `Seasonal`, `Group Campsite`, … Each has `bookingModel`, `capacityCategoryId`, `localizedValues[]`. |
| `GET /api/searchcriteriatabs` | Search UI tab groups | `bookingCategoryGroupId`, `iconName`, `childBookingCategoryIds`. Drives which search tabs render. |
| `GET /api/capacitycategory/capacitycategories` | Party-size / capacity dimensions | e.g. "Total Party Size". Informs `param_fields` party inputs. |
| `GET /api/equipment` | Equipment types (tent/RV/etc.) | **Flat, site-level list** — returns the same tree regardless of `bookingCategoryId` (re-confirmed live 2026-07-08 on all three sites; the earlier "per booking category" note was wrong). Scraped into the catalog `equipment` tree in THR-132. |
| `GET /api/attribute/filterable`, `/api/attribute/getById` | Site attribute filters | Amenity/attribute filters. |
| `GET /api/reachableresources/resourcelocationid` | Reachable resources for a location | Availability-adjacent — resources bookable at a location. |
| `GET /api/dateschedule/resourcelocationid` | **Season / booking-window calendar for a location** | Query params `resourceLocationId`, `bookingCategoryId`. **Response shape confirmed live 2026-07-07** on both BC Parks and Ontario Parks (THR-124) — see §7 item 7. Not live availability (see §3); used for booking-window gating only. |

Other catalog endpoints seen in the bundle: `/api/carousel/cards`, `/api/branding/header/image`, `/api/footer/*`, `/api/golive`, `/api/maps/legendicons`, `/api/mapLegendResourceIconLabel`, `/api/department/webstore`, `/api/auth/logout`.

**Scraper implication (HH-101):** a parameterized script taking the Camis base URL can walk `/api/maps/root` → child maps → leaf `resourceLocationId`s, join `bookingcategories` + `equipment` + `capacitycategories`, and emit a `bc_parks.json` / `ontario_parks.json` catalog in the same spirit as `great_walks.json`. This should be dramatically less brittle than the DOC DOM scrapers.

---

## 3. Booking flow (feeds `fill_form` / `attempt_hold`)

The booking wizard is an Angular router flow (not separate page loads). Route paths extracted from the bundle:

```
/                          → search / home
/cart                      → shopping cart
/reservation-information   → reservation detail
/create-booking/results
/create-booking/partyinfo
/create-booking/contactinfo
/create-booking/additionalinfo
/create-booking/addons
/create-booking/permitholder
/create-booking/reviewpolicies
/create-booking/harborinformation   (boat/marina categories)
/create-booking/shipment-info
/create-booking/payment
/self-checkout/success
/account/all-bookings, /account/my-purchases, /login, /logout
```

Flow shape: **search → results → add to cart → `/create-booking/*` multi-step (party → contact → policies) → payment**. Analytics hooks in the bundle (`add_to_cart`, `begin_checkout`, `LoadAvailabilitySuccess`, `CART_INIT`) confirm the cart/checkout state machine. The payment step (`/create-booking/payment`) is the noVNC hand-off point, analogous to DOC's `CreditCardPayment` page.

**Login model (confirmed in HH-100):** account-based, `requires_credentials = True`. Verified flow against live BC Parks: navigate `/login` → dismiss the cookie-consent gate (`#login-cookie-consent`) which otherwise hides the form → fill `#email` / `#password` → **press Enter** (the Angular form does *not* submit on the button click alone) → the site posts `POST /api/auth/login` and redirects to `/account`. The cart is account-scoped, so login is required before holding.

**Cart/hold funnel (confirmed end-to-end in HH-103; HH-100's mapping was wrong).** The confirmed live flow:

1. `/create-booking/results?resourceLocationId=&mapId=&bookingCategoryId=&startDate=&endDate=` — navigate at an **open loop's** `mapId` (from the availability read) so the per-site list renders directly, skipping the park's loop overview.
2. **Select equipment** in the search-form dropdown (`#equipment-field` → e.g. "1 Tent") and re-search (`#actionSearch`). A site refuses to reserve until an equipment type is chosen ("You must select equipment before adding this location…").
3. Switch to **List view** (`[aria-label='List view of results']`). Each site is a Material expansion panel: availability marker `.resource-availability .icon-available`, expander `#details-N` (`aria-label="select for details"`), and once expanded a Reserve button `[id^=reserveButton]`.
4. Expand an available site → **Reserve** → `POST /api/cart/commit` → **Review Reservation Details** (`/create-booking/reservationmessages`).
5. Tick the acknowledgement checkboxes → **Confirm reservation details** (`#confirmReservationDetails`) → `/cart` with the item held (header badge shows "N Item").
6. **Proceed to checkout** (`#proceedToCheckout`) → payment (the noVNC hand-off).

Equipment + party size are chosen during search; a single **permit-holder** name (the account occupant) is shown on the review page, not per-person like DOC.

> ⚠️ **HH-100 was a false positive.** Its "available cell" selector `"Available for all selected dates"` actually matched the availability **legend's** tooltip trigger (a `mat-mdc-tooltip-trigger` button), so it clicked nothing; its success check was a URL substring (`create-booking`) that the results URL satisfies trivially — so it reported `held=True` with an empty cart. The real Leaflet map has **no semantic per-site markers** (image pins only), which is why HH-103 uses the **List view** instead. Hold verification now reads the **DOM cart badge** (`#viewShoppingCartButton` → "N Item"); `/api/cart` fetched from a fresh request context returns an *empty* cart because the committed booking lives in the Angular app's in-memory session, not the REST snapshot.

**Cart-hold expiry — 15 minutes (confirmed HH-103).** No countdown timer surfaces before the payment page and no expiry field is exposed in `/api/cart`, so it was measured empirically: a committed hold auto-released at **~15.9 min** of inactivity. Independently confirmed — the live Shopping Cart page states *"All reservations in your shopping cart will be held for 15 minutes or until the reservation has been paid for."* `cart_hold_minutes = 15` on `BaseCamisAdapter` (rounded down so the /pay page never overpromises). NOT DOC's 25 min.

### Availability endpoint (resolved in HH-99)

The live availability read is **`GET /api/availability/map`** (verified on BC + Ontario, unauthenticated). It is *not* in the static endpoint list because the results-page bundle builds it dynamically; recovered from the bundle's `availabilityService.getMapAvailabilityByMapId({...})` call.

Query params: `resourceLocationId`, `mapId` (the park's `rootMapId` from `/api/resourcelocation`), `bookingCategoryId`, `startDate`, `endDate` (ISO, inclusive), `getDailyAvailability=true`.

Response shape (**corrected in HH-102** — the HH-99 decode below was wrong on both the keying and the code values):

- `mapLinkAvailabilities` — keyed by **child map id** (campground loop) of the *queried map*, not by `resourceLocationId`. Values are **per-day aggregate** status arrays over `[startDate, endDate]`.
- `mapAvailabilities` — the same per-day aggregate for the queried map itself.
- `resourceAvailabilities` — present on **leaf (loop) maps**: keyed by site resource id, values are per-day `{availability, remainingQuota}` objects.

Status codes, decoded empirically in HH-102 by cross-checking the live BC API on a fully-booked long weekend (BC Day at Golden Ears), a quiet mid-September weekday, next-day, and beyond-window dates:

| Code | Site level (`resourceAvailabilities`) | Link/map level (aggregate) |
|---|---|---|
| `0` | **available** | some site available that day |
| `1` | booked / unavailable | no site available that day |
| `2` | — | closed |
| `3` | non-reservable / does not match search filters | — |
| `6` | — | not yet released (booking window not open) |
| other | never treated as free | never treated as free |

> ⚠️ HH-99 shipped `1 = available` — **inverted** (it read a fully-booked park as AVAILABLE) — and read `mapLinkAvailabilities[resourceLocationId]`, which never matches on a park map. Corrected in `BaseCamisAdapter` under HH-102.

Detection semantics: a stay is only bookable if a **single site** is free (code `0`) every night — day-wise aggregates can read "available every day" when no one site covers the whole stay. Aggregates **prioritize** which loops to drill first; they do **not** skip drill (THR-129 Finding A — Parks Canada nests three levels; Pukaskwa-style trees need every loop visited). `detect_availability` breadth-first drills every discovered `mapLinkAvailabilities` child (open-looking first), capped at `_MAX_DRILL_REQUESTS = 40`, then classifies per site: ≥1 full-stay site → AVAILABLE; free nights but no full-stay site → PARTIALLY_AVAILABLE. Evidence uses six site-state labels (Finding B); only code `0` is bookable (code `3` later surfaces as `RESTRICTED` — THR-133).

Beyond-window dates can still show site-level `0` — the window gate lives in `/api/dateschedule`, not in the availability codes. Poll gating must use the season calendar (or `is_expired`), not availability alone.

Note: `/api/dateschedule/resourcelocationid` is the operating-**season** calendar (reservable date ranges, go-live dates, min/max stay, check-in/out times) — useful for gating polling to the open booking window, **not** live availability.

---

## 4. BC vs Ontario diff (HH-96)

**Identical (belongs in `BaseCamisAdapter`):**

- Angular app shell, route table, and `/create-booking/*` wizard steps.
- `/api/*` endpoint set and JSON response shapes (verified field-for-field on `bookingcategories`, `searchcriteriatabs`, `maps/root`).
- Queue-it waiting room with `customerId: "camis"`.
- Azure Front Door edge + CSP (Amazon Connect chat, Google/Facebook analytics allowances).
- Auth / account model.

**Per-site (belongs in the subclass config / catalog JSON):**

| Axis | BC Parks | Ontario Parks |
|---|---|---|
| Base URL | `camping.bcparks.ca` | `reservations.ontarioparks.ca` |
| Queue-it `appUrlDomain` | `camping.bcparks.ca` | `reservations.ontarioparks.ca` |
| Localization cultures | `en-CA` only | `en-CA` **and** `fr-CA` (bilingual) |
| Booking categories | Campsite-led | includes `Seasonal`, `Group Campsite` |
| Region tree / catalog data | BC parks | Ontario parks |
| Single-tent equipment label | `"1 Tent"` | `"Single Tent"` (Parks Canada: `"Small Tent"`) — **same id `-32768/-32768` on all three**, only the label differs (§9). |
| Park Alerts interstitial | not seen | modal with **Acknowledge** on some parks (e.g. Algonquin invasive-species notice) — overlays the results map and intercepts clicks |

**Hold funnel deltas confirmed live (HH-105).** Only two, both absorbed into `BaseCamisAdapter`:
1. **Equipment wording** — `_DEFAULT_EQUIPMENT_RE` matches both `1 Tent` and `Single Tent`.
2. **Park Alerts modal** — `_dismiss_park_alerts` clicks *Acknowledge* after the results page loads and again after Reserve. Some parks gate the results page behind it; it silently no-ops where absent (BC). Everything else (login, list-view funnel, `POST /api/cart/commit`, reservationmessages → confirm → cart → checkout, the 15-minute hold window, badge-based verification) transferred **unchanged**.

**Design conclusion:** the split is clean. `BaseCamisAdapter` owns the flow, endpoints, Queue-it handling, and login. Subclasses set `base_url`, catalog path, culture, and timezone — nothing else (HH-104/105 proved it). Ontario's `bookingModel: 2` / `Seasonal` category suggests some categories won't map to the nightly-site model — the subclass/catalog should filter to the bookable-night categories Hut Hunter targets.

---

## 5. Anti-bot, sessions, and hold window (HH-97)

- **Queue-it waiting room** is the primary throttle at high demand (launch mornings). `customerId: "camis"`, per-site `appUrlDomain`. As with the DOC adapters (whose scraper notes that "Playwright handles the Queue-It cookie handshake automatically"), the poll/hold workers must be prepared to sit in and pass through the Queue-it handshake. Polling cadence should stay conservative to avoid being queued or flagged.
- **Azure Front Door + WAF.** During this recon, scripted (`curl`) fetches of Ontario's JS **chunks** were served an **Azure WAF challenge page** (`<title>Azure WAF</title>`, ~11 KB) instead of the asset, while the same requests to BC succeeded. The JSON `/api/*` endpoints answered on both. Takeaway: the WAF challenges non-browser clients unevenly — **recon and polling must run through a real (headed) browser context**, not raw HTTP, for anything beyond the open JSON catalog endpoints. Expect to need realistic headers / a warmed browser session.
- **Caching:** `x-cache: PRIVATE_NOSTORE` on document responses — no shared caching; every session is fresh.
- **Cart hold / expiry duration — OPEN.** Not observable without placing a real hold. DOC's is 25 min (`cart_hold_minutes = 25`). The Camis equivalent drives `CartSession` timing and the noVNC payment window and **must be measured in M2** (HH-100) by placing a test hold and watching for the cart-expiry timer/countdown. Do **not** assume it equals DOC's 25 min.
- **Occupant fields — OPEN.** The `/create-booking/partyinfo` / `permitholder` steps define required occupant fields; capture them from a driven session in M2 to fill `occupant_fields()`.

---

## 6. Mapping onto the `BaseAdapter` contract

| `BaseAdapter` member | Camis plan |
|---|---|
| `base_url` | per-subclass (`camping.bcparks.ca` / `reservations.ontarioparks.ca`) |
| `requires_credentials` | `True` (account-based login) |
| `booking_timezone` | `America/Vancouver` (BC) / `America/Toronto` (Ontario) |
| `cart_hold_minutes` | **OPEN** — measure in M2, default unknown (not DOC's 25) |
| `param_fields()` | built from `/api/searchcriteriatabs` + `bookingcategories` + `equipment` + `capacitycategories` + catalog JSON |
| `occupant_fields()` | **OPEN** — capture from `/create-booking/partyinfo` in M2 |
| `fill_form()` | drive search (or hit search API) for the selected park/date/party |
| `detect_availability()` | JSON `/api/availability/map` per-site drill (see §3; corrected in HH-102) |
| `attempt_hold()` | add-to-cart → `/create-booking/*` → park on `/create-booking/payment` for noVNC, mirroring `BaseDOCAdapter._persist_cart_session()` |
| `is_expired()` | default cutoff logic with per-province timezone |

---

## 7. Open items (final status — project complete through M5)

1. ~~Exact **cart hold / expiry duration**~~ — **RESOLVED (HH-103/105): 15 minutes**, measured on a live BC hold and stated verbatim on both provinces' cart pages (see §3). Not DOC's 25.
2. ~~**Occupant fields**~~ — **RESOLVED (HH-100/103, refined THR-129):** party/equipment at search + a single permit-holder at checkout. `occupant_fields()` no longer declares a redundant `permit_holder` text field; Camis sets `uses_single_permit_holder = True` and derives the name via `resolve_permit_holder_name` (optional `permit_holder_occupant_id` + wizard `PermitHolderPicker` when multiple campers are selected). Funnel was driven to payment live on both provinces; checkout typing of the permit-holder field remains future work once holds need it.
3. ~~**Login timing**~~ — **RESOLVED (HH-100):** dedicated `/login` route (consent gate + `#email`/`#password` + Enter → `POST /api/auth/login`), required before holding. **Caveat (HH-118):** Parks Canada has *no* native login — Google/Facebook/GCKey SSO only, so it's watch/notify-only (`supports_automated_booking = False`) pending session-linking (THR-119; Camis sessions verified to survive transfer into a fresh browser, unlike DOC's).
4. ~~Exact query params for the availability endpoint~~ — **RESOLVED (HH-99):** `GET /api/availability/map` (see §3). `/api/dateschedule` turned out to be season metadata, not live availability.
5. ~~Map-tree traversal to enumerate parks~~ — **RESOLVED (HH-101):** the visual `/api/maps` tree dead-ends; use the flat `GET /api/resourcelocation` instead.
6. Behaviour of the **Queue-it handshake** under Playwright, headless vs headed — `_pass_queue_it` is wired throughout but no live queue was encountered during any E2E run; remains to be exercised on a launch morning.
7. ~~`/api/dateschedule/resourcelocationid` response field names (THR-124)~~ — **RESOLVED, confirmed live 2026-07-07** against both `camping.bcparks.ca` and `reservations.ontarioparks.ca` (unauthenticated GET, identical shape on both). Shape: a dict keyed by `scheduleId`, each holding a `reservableDates` **list** of per-season dicts — nested `reservableDates: {start, end}` (ISO, tz-aware) plus `goLiveDate` (naive local) / `goLiveDateUtc` (UTC) / `goLiveTimeZone`. A separate `operatingDates` field is the facility's broad operating range, **not** the reservable window.

   THR-124's original best-effort field mapping (flat `startDate`/`endDate`/`goLiveDate` keys, one level deep) was **wrong on the nesting** — confirmed against real responses, not just a guess. It also assumed a season's *start date* was a safe fallback "opens on" time when no go-live date was published; live sampling disproved this: BC go-live dates ranged from ~11 months before to several months after the corresponding season's start, while Ontario's go-live is typically the *same instant* as the season start — two different rolling-release models on one API shape, with no reliable offset to guess from. A future season commonly exists with `goLiveDate`/`goLiveDateUtc` still null (site hasn't published a release date yet — true for every BC 2027 season sampled). `BaseCamisAdapter._parse_booking_window` (`app/adapters/base_camis.py`) now parses the confirmed nested shape directly and only computes an arm time from a genuinely-published go-live field; a covered-by-a-range-but-no-go-live-yet case fails open (keeps polling normally) rather than guessing.

---

## 8. Parks Canada Accommodation — the huts (THR-131)

**Recon date:** 2026-07-07. Live-probed against `reservation.pc.gc.ca` (unauthenticated `/api/*`).

`Parks Canada Accommodation` is the booking category the oTENTiks / cabins / yurts live under — the actual reason Hut Hunter exists — and until this ticket the Camis path was only exercised for the frontcountry `Campsite` nightly-site model. The ticket's hypothesis was that Accommodation would be a *different shape* (different endpoint, unit-type inventory). **Live probing disproved that** — it's the same shape, and detection is config over the shared `BaseCamisAdapter` path:

- **Same model, endpoint, tree, and codes.** Accommodation is `bookingCategoryId=1`, `bookingModel=0`, `capacityCategoryId=-32767` — identical model + capacity dimension to `Campsite` (0). It rides the **same** `GET /api/availability/map`, the **same** map tree (park root map → loop children → per-site `resourceAvailabilities`), and the **same** per-site `{availability, remainingQuota}` code shape (§3). No separate endpoint, no separate inventory tree.
- **`bookingCategoryId` genuinely filters availability.** Same loop + date, cat 0 vs cat 1, returns the **same resource-id set** but **different per-site codes** — each site's availability is computed *for the queried category*. Example: Fundy - Headquarters loop `-2147483520`, 2026-09-19, 2N → cat 0 = 9 free campsites, cat 1 = 2 free accommodations. So querying with `bookingCategoryId=1` yields accommodation-correct detection.
- **No equipment step.** Accommodation availability reads correctly with **no equipment params at all**; the frontcountry equipment ids (`-32768` "Small Tent" etc., §4 / §9) are a semantic no-op for cat 1 (byte-identical results with and without them). `BaseCamisAdapter` skips the equipment extras for the categories in `_NON_EQUIPMENT_BOOKING_CATEGORY_IDS` (Parks Canada → `{1}`); every *other* category now carries the equipment filter on **every** site (THR-132, §9 — not just Parks Canada as under the original THR-129 shape).
- **Party-size capacity still applies** to accommodation (same `capacityCategoryId -32767`) and is honored live (`count=2` → units code 0; `count=99` → those units code 5), so it is sent for both categories.
- **`peopleCapacityCategoryCounts` wire format — fixes a latent bug on BOTH categories.** The live API requires a URL-encoded **JSON array**: `peopleCapacityCategoryCounts=[{"capacityCategoryId":-32767,"subCapacityCategoryId":null,"count":N}]` → 200; a bare JSON object → **400**. The adapter previously assigned a Python *list-of-dict* to the query value, which neither `httpx` nor Playwright can encode as a query param (httpx emits a Python `repr` → the availability read 400s). This 400'd the None-page/`httpx` detect path for **campsite and accommodation alike** — masked on the campsite polling path only because production drove it through a browser context that dropped the malformed param. `_build_availability_query` now `json.dumps()` the array so every query value is a scalar string both transports encode identically. **Behavior note:** the campsite party-size filter now actually engages where it silently didn't before — availability matches the site's own party-filtered view (a watch for `people=N` sees only sites that fit N).
- **Verified end-to-end live (2026-07-07).** The real `CamisParksCanadaAdapter.detect_availability` returns `AVAILABLE` for Fundy - Headquarters accommodation on 2026-09-19, 2N (6 of 117 units free), and campsite (37 free). Captured as a deterministic offline fixture: `backend/tests/fixtures/camis_parks_canada_accommodation_fundy.json`.
- **Booking is out of scope (unchanged).** Parks Canada remains watch/notify-only (`supports_automated_booking = False`, IdP-only sign-in — §3 caveat, THR-118/119), so `attempt_hold` is untouched. What booking an accommodation would *additionally* require once session-linking (THR-119) lands: the reserve funnel has no equipment-dropdown step for a unit-type booking (the §3 `_select_equipment` step is campsite-specific), and selection is per-unit-type rather than per-site-plus-equipment; the review → cart → checkout tail is expected to match. Not implemented or driven live here.

---

## 9. Equipment is a shared filter across all three sites (THR-132)

**Recon date:** 2026-07-08. Live-probed unauthenticated against `camping.bcparks.ca`, `reservations.ontarioparks.ca`, and `reservation.pc.gc.ca`.

Equipment (a tent/RV size) is a **real availability filter** and it's now a visible, configurable Form field on every Camis adapter, sourced from the scraped `/api/equipment` tree (was previously an invisible constant). This section also **corrects the THR-129 Finding C assumption** that the equipment enum was Parks-Canada-specific.

- **The equipment enum is identical on all three sites.** Every site exposes equipment category `-32768` "Equipment" whose first sub-category `-32768` is the smallest tent — labelled `"1 Tent"` (BC), `"Single Tent"` (Ontario), `"Small Tent"` (Parks Canada) — ascending through tents → vans → trailers/RVs by size. Parks Canada adds a second category `-32767` "Backcountry" (single/2–6 tents). Same id space, only labels differ.
- **Equipment is accepted, not required, on every site.** `GET /api/availability/map` returns **HTTP 200 with or without** the equipment params on BC, Ontario, and Parks Canada alike. So it can be sent uniformly — there is no site that rejects it.
- **The sub-category genuinely changes results.** Live, Parks Canada Banff – Castle Mountain, 2026-08-15 2N: `subEquipmentCategoryId=-32768` (Small Tent) → 14 sites available (code 0); `-32759` (Trailer/Motorhome over 35ft) → **0** available, 78 sites report code 5 ("doesn't fit"). This is exactly why equipment must be user-selectable — a small-tent default would falsely report tent-only sites as bookable for someone with a large trailer. The default is the least-constrained small tent (fits every site → never hides availability).
- **`numEquipment` does not gate the filter.** The fit-filter engages via `subEquipmentCategoryId` alone (`numEquipment=0` and `=1` return identical results for the RV case above), so the adapter keeps `numEquipment=0` — the exact shape Parks Canada was already confirmed on.
- **Corrects THR-129's misdiagnosis.** THR-129 believed sending "Parks Canada's" equipment ids to BC's `/api/availability/map` 400'd, and gated the whole extended query shape behind a PC-only `_INCLUDE_UI_QUERY_EXTRAS` flag. The ids were never the problem (they're identical) — the real BC 400 was the malformed `peopleCapacityCategoryCounts` param (a Python list `httpx` serialized to a repr; see §8), which THR-131 fixed. THR-132 removes that flag: equipment now rides every adapter's query, driven by the Form field with the shared `-32768/-32768` default as the fallback. `peopleCapacityCategoryCounts` (party-size capacity) stays Parks-Canada-only — it's the one part of that shape only ever confirmed against `reservation.pc.gc.ca`.
- **Verified end-to-end live (2026-07-08).** The real `_build_availability_query` output for the first catalog park on each site returns HTTP 200: BC (Akamina-Kishinena), Ontario (Aaron), Parks Canada Campsite + Accommodation + a large-RV form selection (Banff – Castle Mountain) — all 200.

---

## 10. Post-launch hardening (THR-122–133, THR-125)

**Sync date:** 2026-07-08. These tickets shipped after the initial M1–M5 build; they changed the practical end state of the Camis adapters.

### Booking-window gating (THR-124, THR-126, THR-127)

- Hunts for dates outside the rolling window enter `awaiting_window` with a stored `window_opens_at`; the poll worker arms them at window open.
- **Rolling windows are authoritative:** BC = 3 months before arrival @ 07:00 `America/Vancouver`; Ontario = 5 months @ 07:00 `America/Toronto`. These take priority over dateschedule season-range checks (season ranges describe operating season, not release window).
- Poll worker re-gates before reporting AVAILABLE; hold funnel recognizes "Cannot Reserve — not yet allowed" modals and maps to `awaiting_window` instead of Hold Failed.
- `/api/dateschedule` still supplies go-live dates for fixed-season launches and stay-pattern rules (§10.4).

### Hold-flow robustness (THR-122, THR-125, THR-126)

- **Cookie consent:** `_accept_cookie_consent` races consent banner vs `#email`, clicks the actual button (not the container), and verifies dismissal before login.
- **noVNC prod fix (THR-125):** Caddy `/websockify` proxy uses bare `reverse_proxy` — manual `Connection`/`Upgrade` header overrides were removed.
- **Manual takeover:** unexpected hold failures (consent stuck, unknown dialogs) raise `UnexpectedHoldFailure` → job enters `needs_attention`, browser parked for noVNC takeover with notification.
- Login-phase failures must raise (not return clean `BookingResult`) so takeover fires.

### Credential verification (THR-123, THR-126, THR-127)

- `AdapterCredential.verification_status`: `verified | failed | inconclusive | pending | unverified`.
- Verify-on-save runs on the hold worker queue; Sign-Ins dialog shows badge states.
- Auto-book requires `verification_status == verified` (not just stored credentials).
- Hold-time login rejection demotes credential to `failed`; infra failures do not demote.
- Single "Save & Verify" action in credentials dialog (no race between edit and verify).

### Booking-site links (THR-130)

- `BaseCamisAdapter.results_url()` → date-prefilled `…/create-booking/results?…` deep link.
- Surfaced on job info bar (`park_url`), availability tile "Go To Site", and email/Gotify notifications (booking-site link + Hut Hunter show-hunt link).
- DOC parity decision: page-level ceiling only — see `docs/adapters/doc-links-parity.md`.

### Availability correctness & product wiring (THR-129)

Shipped before the 2026-07-08 docs pass but under-documented then; Finding C's
equipment assumption was later corrected by THR-132 (§9).

- **Finding A / B** — always drill nested loops (cap 40); six-state site labels in evidence (§3).
- **Finding E** — `fill_form` navigates to the results deep link so artifacts show the queried park/dates, not the homepage (same `results_url` later reused by THR-130).
- **Permit-holder derivation** — see §7 item 2 (`uses_single_permit_holder`, picker).
- **Edit-triggered rechecks** — `update_job` compares semantic params; real edits clear `last_result`/artifacts and re-run the booking-window check; no-op wizard resaves do not. Mid-flight param changes in `poll_worker` discard the stale result and schedule an immediate recheck.
- **Dashboard UX** — compact `StatsGrid` tooltips + mobile `RecentHuntsPreview` so the home surface is not blank.

### Restricted availability (THR-133)

- New `AvailabilityStatus.RESTRICTED` for site code 3 (restriction, not sold out) and stay-pattern violations.
- `check_stay_pattern()` pre-validates arrival/departure changeover days and min/max stay from `/api/dateschedule`.
- Wizard warns at job creation when the requested stay pattern is non-compliant.
- Distinct from `unavailable` (fully booked) — user sees "restricted" with actionable evidence.
