# Handoff: DOC standard-hut nested catalog

You're picking up work on **hut-hunter** at `/Users/sean/PyCharmProjects/hut-hunter`.
This is the full task — read it end to end before touching anything.

## Why this exists

The adapter `backend/app/adapters/doc_standard_hut.py` (`DocStandardHutAdapter`) watches
availability for non-Great-Walk DOC huts/campsites. It builds URLs of the form
`https://bookings.doc.govt.nz/Web/Default.aspx#!park/{park_id}/{facility_id}` and
currently only knows about Mueller Hut (park_id=747, facility_id=2487), which is seeded
in `backend/app/adapters/doc_standard_huts.json`.

We need the adapter's `Hut` dropdown to match what DOC's booking site offers — ~322
facilities grouped under ~50-ish parks — so users can set up watch jobs for any of them.

## The DOC booking flow (important — don't skip)

1. Landing page: `https://bookings.doc.govt.nz/Web/Default.aspx`. Behind a Queue-It
   waiting room (the cross-host cookie handshake is handled automatically if you use
   Playwright; don't try raw HTTP).
2. Click the "Search" pill → reveals an autocomplete with a `<ul role="listbox">`
   containing ~322 options. **The `id` attribute on each `<li>` is an opaque "place"
   id — NOT a park_id or a facility_id.** Do not try to use it for URL construction.
   (We learned this the hard way; an earlier attempt baked these ids into the adapter
   as `DOC_STANDARD_HUT_OPTIONS` and broke Mueller Hut — that work was reverted.)
3. Click any listbox option. Two possible redirects:
    - If the option IS a park (e.g. "St James Walkway"), browser goes straight to
      `#!park/{park_id}` (a park page listing its facilities).
    - If the option is a sub-place of a park (e.g. "Cannibal Gorge Hut", which is part
      of St James Walkway), a modal dialog pops up: *"The place you've selected is part
      of St James Walkway, click on OK button to continue."* Click OK → same destination.
4. Park page (`#!park/{park_id}`): shows the park name as a heading, and a grid of
   facility cards (Cannibal Gorge Hut, Ada Pass Hut, Christopher Hut, Anne Hut, Boyle
   Flat Hut, …). Each card links to `#!park/{park_id}/{facility_id}`.
5. Facility page: actual availability grid. **This is the URL the adapter needs.**

Note: URLs use the hash fragment for client-side routing, so after clicking you need
to wait for the `hashchange` (or poll `page.url`) rather than relying on a nav event.

## What you're building

Three coordinated changes:

### 1. Scraper rewrite: `backend/scripts/scrape_standard_huts.py`

The existing script uses Playwright and has decent infrastructure (fallback selectors,
artifact dumps on failure, facility-type filtering). Keep the boilerplate. Replace the
core harvesting logic with a click-through over the 322 listbox options:

- Open the search popup, enumerate every `<li role="option">` in the listbox.
- For each one: click it, dismiss the "part of …" dialog if it appears, wait for URL
  to match `#!park/\d+` (20s timeout), capture `park_id` from the URL and `park_name`
  from the page heading/breadcrumb.
- On the park page: enumerate all facility links matching `#!park/{park_id}/(\d+)`,
  capture each `facility_id` + facility name from the card title.
- Dedupe by `park_id` — many listbox entries resolve to the same park, so you'll end up
  with ~50-100 parks, not 322.
- Write `backend/app/adapters/doc_standard_huts.json` in the **new shape** (see §2).
- Sort parks alphabetically by `park_name`, facilities alphabetically by `facility_name`.
- Log progress every 10 options. Running time will be 20-40 minutes; expect flakes.
  Retry each failed option 2× before giving up, and dump HTML + screenshot on final
  failure so debugging is tractable.
- Preserve the existing facility-type filter idea but invert the sense: you want to
  INCLUDE huts + campsites + lodges (everything in the listbox). The current
  `EXCLUDED_FACILITY_LABELS` was oriented toward great-walk exclusion — probably not
  needed in the new flow, but keep or remove deliberately, don't leave it dead.
- Do not hit the booking site during DOC's 8pm NZ cutoff window if you can avoid it;
  that's when real users are racing for booking slots.

### 2. JSON shape change: `backend/app/adapters/doc_standard_huts.json`

Current shape (flat, one entry):
```json
{
  "huts": [
    {"park_id": "747", "facility_id": "2487", "hut_name": "Mueller Hut",
     "park_name": "Aoraki/Mount Cook National Park", "region": "Canterbury"}
  ]
}
```

New shape (park-grouped):
```json
{
  "parks": [
    {
      "park_id": "747",
      "park_name": "Aoraki/Mount Cook National Park",
      "facilities": [
        {"facility_id": "2487", "facility_name": "Mueller Hut"}
      ]
    }
  ]
}
```

Mueller Hut MUST survive the migration — verify it appears in the new output with
`park_id=747, facility_id=2487`.

Drop `region` entirely unless the scrape can recover it reliably from the park page;
it's not load-bearing anywhere (grep confirms).

### 3. Adapter + ParamField + frontend updates

Three coordinated files:

**`backend/app/adapters/base.py`** — extend `ParamField` with an `options_tree` field
of shape `list[dict]` where each dict is `{"group": str, "items": list[str]}`. Keep
the existing flat `options` field for backwards compat; when `options_tree` is set,
`options` should be unset (or serialized as the flattened list so old clients still
work). Add a short docstring explaining the intent.

**`backend/app/adapters/doc_standard_hut.py`**:
- Update `_load_hut_catalog()` to read the new `{"parks": [...]}` shape. Return a
  list of `(park_name, [(facility_id, facility_name), …])` tuples or similar — your
  call on the intermediate shape, but sort within it for deterministic dropdown order.
- Update `_format_facility_option()` to work on the new entry shape. Keep the option
  value format `"{facility_name} ({park_id}/{facility_id}) — {park_name}"` — the
  regex `_FACILITY_OPTION_RE` already handles this and you don't need to change it.
- Update `param_fields()` to emit `options_tree=[{group: park_name, items: [opt1, opt2, …]}, …]`
  instead of the flat `options=[opt1, opt2, …]`. Default value should be the first
  option of the first group.
- `_resolve_site()` and `_parse_facility_option()` don't need changes — the encoded
  `(park_id/facility_id)` in the option value still works.

**`frontend/src/components/jobs/CreateJobDialog.tsx`** — the `ParamFieldInput`
component around lines 40-65 currently does `selectOptions.map(...)` into
`<SelectItem>`s. Teach it to branch on whether the field carries `options_tree`:

- If `options_tree` is present: render `<SelectGroup>` per group with the group name
  as a non-selectable label (Radix UI's `<SelectLabel>` inside `<SelectGroup>`), then
  `<SelectItem>`s for each facility in the group.
- Else: current flat rendering.

Radix supports this natively. The TypeScript type for the param field needs the new
optional `options_tree?: { group: string; items: string[] }[]` field — check where
`ParamField` is typed on the frontend and extend it there too.

## Verification

- `python3 -c "import ast; ast.parse(open('backend/app/adapters/doc_standard_hut.py').read())"` passes.
- `python3 backend/scripts/scrape_standard_huts.py` runs to completion; output has
  Mueller Hut under park_id 747 with facility_id 2487.
- Add a tiny unit test under `backend/tests/` that imports the adapter, calls
  `DocStandardHutAdapter.param_fields()`, and asserts the `Hut` field has
  `options_tree` with at least one group and the Mueller Hut option appears in an
  Aoraki/Mount Cook group. There are no existing adapter-specific tests, so you're
  setting the precedent — keep it minimal.
- Frontend: run the dev server, open the create-job dialog, select DocStandardHut
  adapter, confirm the Hut dropdown shows grouped options.

## Things to not do

- Don't use the listbox `id` attribute as a park_id or facility_id. It's opaque.
  (An earlier version of this work tried to; it got reverted. See the NOTE comment
  near the top of `doc_standard_hut.py`.)
- Don't break the Mueller Hut seed — it's what proves the adapter works end-to-end.
- Don't delete the legacy `park_id`/`facility_id`/`hut_name` fallback fields in the
  adapter's `param_fields()` — existing jobs in the DB may still serialize params
  that way.
- Don't run the scrape against DOC's booking site during NZ 7:30-8:30pm — that's the
  booking rush. Any other time is fine.

## Files touched (expected)

- `backend/scripts/scrape_standard_huts.py` — rewritten core loop
- `backend/app/adapters/doc_standard_huts.json` — new shape, ~50 parks
- `backend/app/adapters/base.py` — add `options_tree` to `ParamField`
- `backend/app/adapters/doc_standard_hut.py` — `_load_hut_catalog`, `_format_facility_option`, `param_fields`
- `frontend/src/components/jobs/CreateJobDialog.tsx` — grouped select rendering
- Frontend `ParamField` type definition (find via grep) — add optional `options_tree`
- `backend/tests/test_doc_standard_hut.py` — new, one small test

Report back with the scraper's final output count (parks / facilities), a note on
anything in the scrape that needed manual fix-up, and confirmation the frontend
renders correctly.
