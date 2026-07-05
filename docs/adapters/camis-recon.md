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

**Login model:** account-based (`/login`, `/logout`, `/account/*`), so `requires_credentials = True` for both provinces (matches the DOC adapters). Whether login is required *before* holding a cart or only *at* checkout is **OPEN** — confirm in M2.

### Availability endpoint (resolved in HH-99)

The live availability read is **`GET /api/availability/map`** (verified on BC + Ontario, unauthenticated). It is *not* in the static endpoint list because the results-page bundle builds it dynamically; recovered from the bundle's `availabilityService.getMapAvailabilityByMapId({...})` call.

Query params: `resourceLocationId`, `mapId` (the park's `rootMapId` from `/api/resourcelocation`), `bookingCategoryId`, `startDate`, `endDate` (ISO, inclusive), `getDailyAvailability=true`.

Response: `mapLinkAvailabilities` is an object keyed by `resourceLocationId` whose value is a **per-day status-code array** over `[startDate, endDate]`. Status codes, decoded empirically (the Angular enum is inlined and not statically recoverable):

| Code | Meaning | Adapter mapping |
|---|---|---|
| `1` | available | AVAILABLE |
| `2` | unavailable (booked / closed / past date) | UNAVAILABLE |
| `6` | not yet released (booking window not open) | UNAVAILABLE |
| other | unknown | UNKNOWN (never treated as free) |

A per-day *mix* of codes over a multi-night stay maps to **PARTIALLY_AVAILABLE**. This is park-level detection (any bookable site in the park); per-individual-site detail lives in `resourceAvailabilities` / `getResourceDailyAvailability` and is only needed for the hold flow (HH-100).

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
| `detect_availability()` | prefer JSON `/api/dateschedule/resourcelocationid` over DOM scraping |
| `attempt_hold()` | add-to-cart → `/create-booking/*` → park on `/create-booking/payment` for noVNC, mirroring `BaseDOCAdapter._persist_cart_session()` |
| `is_expired()` | default cutoff logic with per-province timezone |

---

## 7. Open items to resolve in M2 (carry into the build log)

1. Exact **cart hold / expiry duration** per province (HH-100) — measure with a live hold.
2. **Occupant field** requirements from `/create-booking/partyinfo` + `/permitholder` (HH-100).
3. Whether **login is required pre-hold or only at checkout** (HH-98/100).
4. ~~Exact query params for the availability endpoint~~ — **RESOLVED (HH-99):** `GET /api/availability/map` (see §3). `/api/dateschedule` turned out to be season metadata, not live availability.
5. ~~Map-tree traversal to enumerate parks~~ — **RESOLVED (HH-101):** the visual `/api/maps` tree dead-ends; use the flat `GET /api/resourcelocation` instead.
6. Behaviour of the **Queue-it handshake** under Playwright, headless vs headed (HH-97 follow-through in M2) — `fill_form` now calls `_pass_queue_it`; still to be exercised against a live queue.
