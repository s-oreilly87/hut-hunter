# DOC booking-site link parity — decision (THR-130)

**Question:** Camis adapters expose a fully date/party-prefilled results URL
(`…/create-booking/results?resourceLocationId=…&startDate=…&partySize=…`).
Can the DOC booking site (`bookings.doc.govt.nz`) get the same, and if not,
what's the cheap parity ceiling?

## Finding

**DOC's booking site takes no URL-driven prefill of dates or party size.**
Both DOC flows are JavaScript/Playwright search flows: the user lands on a
page and drives in-page dropdowns (track/facility, month, nights, party) —
there is no query-param equivalent of the Camis deep link. The furthest a URL
can address is the **page**, not a filled-in search:

- **Standard huts** — a per-facility page: `…/Web/#!park/{park_id}/{facility_id}`.
  This is the same link the frontend already builds client-side from the
  `facility` option string (`parseFacilityOption`).
- **Great Walks** — no per-track page at all; the track is a dropdown on the
  booking landing page. The ceiling is the landing page itself:
  `…/Web/Default.aspx#!greatwalk-result`.

So **page-level is the ceiling** for DOC. Dated/party prefill is not achievable.

## Decision

Give both DOC adapters a server-side `results_url` (rather than leaving the
link client-side only), so **every adapter flows through one `park_url` code
path**:

- `DocStandardHutAdapter.results_url` → the facility page deep-link (same URL
  as the client-side `parseFacilityOption` link), fail-soft to `None` when no
  facility is selected.
- `DocGreatWalkAdapter.results_url` → the Great Walk booking landing page.

### Why unify rather than leave it client-side

The THR-130 work surfaces the booking link in two new places that have no
access to the frontend's `parseFacilityOption` helper:

1. the **availability-tile "Go To Site" button**, and
2. **email + Gotify notifications**.

Routing all adapters through `BaseAdapter.results_url` → `WatchJob.park_url`
means both consume one field with no per-adapter special-casing. The existing
client-side info-bar facility link is left untouched (it renders from
`params.facility`, independent of `park_url`), so there's no behavioural change
or double-link there.

## Cost

Two small `results_url` overrides + a test update. No scraping or live-site
work — the URLs are already known from the existing adapters (`base_url` /
`_url_for`).
