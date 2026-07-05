# Camis platform recon — BC Parks & Ontario Parks

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
| `GET /api/equipment` | Equipment types (tent/RV/etc.) | Per booking category. |
| `GET /api/attribute/filterable`, `/api/attribute/getById` | Site attribute filters | Amenity/attribute filters. |
| `GET /api/reachableresources/resourcelocationid` | Reachable resources for a location | Availability-adjacent — resources bookable at a location. |
| `GET /api/dateschedule/resourcelocationid` | **Date availability schedule for a location** | Prime candidate for `detect_availability()` polling — JSON availability rather than DOM scraping. Exact query params **OPEN**, confirm in M2. |

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

**Cart/hold funnel (mapped in HH-100):** `/create-booking/results?resourceLocationId=&mapId=&bookingCategoryId=&startDate=&endDate=` → drill into a map loop (Leaflet `path.mapLinkArea-*`, needs force-click) → the site grid renders each site/date cell as a `<button>` whose **aria-label** states availability (`"Available for all selected dates"` is the only bookable one; others: `"Not available for selected dates"`, `"Closed during selected dates"`, `"Does not match all search filters"`) → click an available cell → Shopping Cart → `#proceedToCheckout` → occupant/party → payment. Occupancy/equipment are chosen during search; a single **permit-holder** name is taken at checkout (not per-person like DOC). **Still OPEN (defer to E2E HH-103):** the interactive site-config/checkout/occupant tail, and the exact **cart-hold expiry** — no countdown timer surfaces before the payment step, so it must be measured during a real E2E hold (still *not* assumed to be DOC's 25 min).

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

Detection semantics: a stay is only bookable if a **single site** is free (code `0`) every night — day-wise aggregates can read "available every day" when no one site covers the whole stay. `detect_availability` therefore short-circuits to UNAVAILABLE when no loop shows an open day, and otherwise drills into the open loops (bounded) and classifies per site: ≥1 full-stay site → AVAILABLE; free nights but no full-stay site → PARTIALLY_AVAILABLE.

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

**Design conclusion:** the split is clean. `BaseCamisAdapter` owns the flow, endpoints, Queue-it handling, and login. Subclasses set `base_url`, catalog path, and (for Ontario) tolerate the `fr-CA` localization arrays. Ontario's `bookingModel: 2` / `Seasonal` category suggests some categories won't map to the nightly-site model — the subclass/catalog should filter to the bookable-night categories Hut Hunter targets.

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

## 7. Open items to resolve in M2 (carry into the build log)

1. Exact **cart hold / expiry duration** — **still OPEN after HH-100:** no timer surfaces before payment; measure during the live E2E hold (HH-103). Not assumed to be DOC's 25 min.
2. **Occupant fields** — **partially resolved (HH-100):** Camis takes party/equipment at search + a single permit-holder name at checkout; `occupant_fields()` exposes `permit_holder`. Full checkout form finalized at E2E (HH-103).
3. **Login timing** — **RESOLVED (HH-100):** login is a dedicated `/login` route (consent gate + `#email`/`#password` + Enter → `POST /api/auth/login`), required before holding (cart is account-scoped).
4. ~~Exact query params for the availability endpoint~~ — **RESOLVED (HH-99):** `GET /api/availability/map` (see §3). `/api/dateschedule` turned out to be season metadata, not live availability.
5. ~~Map-tree traversal to enumerate parks~~ — **RESOLVED (HH-101):** the visual `/api/maps` tree dead-ends; use the flat `GET /api/resourcelocation` instead.
6. Behaviour of the **Queue-it handshake** under Playwright, headless vs headed (HH-97 follow-through in M2) — `fill_form` now calls `_pass_queue_it`; still to be exercised against a live queue.
