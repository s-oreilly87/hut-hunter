"""Unit tests for DocStandardHutAdapter — param schema and catalog loading.

These tests do not spin up a browser or hit DOC's booking site. They work
against a fixture catalog (patched in via monkeypatch) so they are not
sensitive to whatever the live doc_standard_huts.json currently contains.
"""

from __future__ import annotations

import json
import pytest

import app.adapters.doc_standard_hut as _mod
from app.adapters.doc_standard_hut import DocStandardHutAdapter


# ---------------------------------------------------------------------------
# Fixture catalog — includes Mueller Hut so the known-good seed is always
# verifiable regardless of what the scraper has produced so far.
# ---------------------------------------------------------------------------

FIXTURE_CATALOG = {
    "scraped_at": "2026-01-01T00:00:00Z",
    "source": "test-fixture",
    "parks": [
        {
            "park_id": "747",
            "park_name": "Aoraki/Mount Cook National Park",
            "facilities": [
                {"facility_id": "2487", "facility_name": "Mueller Hut"},
                {"facility_id": "2488", "facility_name": "Hooker Hut"},
            ],
        },
        {
            "park_id": "897",
            "park_name": "Acheron Accommodation House Campsite",
            "facilities": [
                {"facility_id": "2965", "facility_name": "Top Camp"},
                {"facility_id": "2966", "facility_name": "Middle Camp"},
                {"facility_id": "2967", "facility_name": "Bottom Riverside Camp"},
            ],
        },
    ],
}


@pytest.fixture(autouse=True)
def patch_catalog(tmp_path, monkeypatch):
    """Write the fixture catalog to a temp file and point the adapter at it."""
    catalog_file = tmp_path / "doc_standard_huts.json"
    catalog_file.write_text(json.dumps(FIXTURE_CATALOG))
    monkeypatch.setattr(_mod, "_HUT_CATALOG_PATH", catalog_file)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_hut_field(fields):
    for f in fields:
        if f.key == "facility":
            return f
    return None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDocStandardHutParamFields:
    def test_hut_field_has_options_tree(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None, "Expected a 'facility' ParamField"
        assert hut_field.options_tree is not None, "options_tree must be set"
        assert len(hut_field.options_tree) > 0, "options_tree must have at least one group"

    def test_tree_has_group_and_items(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None
        for group in hut_field.options_tree:
            assert "group" in group, "Each tree entry needs a 'group' key"
            assert "items" in group, "Each tree entry needs an 'items' key"
            assert isinstance(group["items"], list)
            assert len(group["items"]) > 0, f"Group {group['group']!r} has no items"

    def test_mueller_hut_in_aoraki_group(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None

        aoraki_groups = [
            g for g in hut_field.options_tree
            if "Aoraki" in g["group"] or "Mount Cook" in g["group"]
        ]
        assert aoraki_groups, "Expected an Aoraki/Mount Cook group in options_tree"

        group = aoraki_groups[0]
        mueller_items = [i for i in group["items"] if "Mueller Hut" in i and "747/2487" in i]
        assert mueller_items, (
            f"Mueller Hut (747/2487) not found in {group['group']!r} group. "
            f"Items: {group['items']}"
        )

    def test_flat_options_matches_tree(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None

        tree_items = [item for g in hut_field.options_tree for item in g["items"]]
        flat_options = hut_field.options or []
        assert set(tree_items) == set(flat_options), (
            "flat options must be the same set as the flattened tree items"
        )

    def test_default_is_first_tree_item(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None
        first_item = hut_field.options_tree[0]["items"][0]
        assert hut_field.default == first_item, (
            f"default should be {first_item!r}, got {hut_field.default!r}"
        )

    def test_groups_sorted_alphabetically(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None
        names = [g["group"] for g in hut_field.options_tree]
        assert names == sorted(names, key=str.lower), "Groups must be sorted alphabetically"

    def test_items_sorted_within_group(self):
        fields = DocStandardHutAdapter.param_fields()
        hut_field = _get_hut_field(fields)
        assert hut_field is not None
        for group in hut_field.options_tree:
            assert group["items"] == sorted(group["items"], key=str.lower), (
                f"Items in group {group['group']!r} are not sorted"
            )


class TestDocStandardHutClassification:
    def test_campsite_summary_count_uses_sites_not_people(self):
        adapter = DocStandardHutAdapter()

        result = adapter._classify(
            {
                "ok": True,
                "site_cell_text": "",
                "site_cell_html": (
                    '<button tabindex="0" aria-label="Unpowered #1 04/24/2026 - available">'
                    '<div style="background: url(&quot;themes/NewZealand/Arrival.svg&quot;);"></div>'
                    "</button>"
                ),
                "people_cell_text": "",
                "sites_cell_text": "1",
                "unit_cells": [],
            },
            hut_name="Anaura Bay Campsite",
            people_wanted=4,
        )

        assert result.status.value == "available"
        assert result.total_available == 1

    def test_campsite_unit_grid_counts_bookable_cells(self):
        adapter = DocStandardHutAdapter()

        result = adapter._classify(
            {
                "ok": True,
                "site_cell_text": "",
                "site_cell_html": "",
                "people_cell_text": "",
                "sites_cell_text": "",
                "unit_cells": [
                    {
                        "site_name": "Unpowered #1",
                        "text": "",
                        "html": (
                            '<button tabindex="0" aria-label="Unpowered #1 04/24/2026 - available">'
                            '<div style="background: url(&quot;themes/NewZealand/Arrival.svg&quot;);"></div>'
                            "</button>"
                        ),
                    },
                    {
                        "site_name": "Unpowered #2",
                        "text": "",
                        "html": (
                            '<button tabindex="-1" aria-label="Unpowered #2 04/24/2026 - not available">'
                            '<div style="background: url(&quot;themes/NewZealand/NA.svg&quot;);"></div>'
                            "</button>"
                        ),
                    },
                ],
            },
            hut_name="Anaura Bay Campsite",
            people_wanted=2,
        )

        assert result.status.value == "available"
        assert result.total_available == 1

    def test_campsite_unit_grid_all_unavailable(self):
        adapter = DocStandardHutAdapter()

        result = adapter._classify(
            {
                "ok": True,
                "site_cell_text": "",
                "site_cell_html": "",
                "people_cell_text": "",
                "sites_cell_text": "",
                "unit_cells": [
                    {
                        "site_name": "Unpowered #1",
                        "text": "",
                        "html": (
                            '<button tabindex="-1" aria-label="Unpowered #1 04/24/2026 - not available">'
                            '<div style="background: url(&quot;themes/NewZealand/NA.svg&quot;);"></div>'
                            "</button>"
                        ),
                    },
                ],
            },
            hut_name="Anaura Bay Campsite",
            people_wanted=2,
        )

        assert result.status.value == "unavailable"
        assert result.total_available == 0


# ---------------------------------------------------------------------------
# THR-128 — month-blind fast path / placeholder-load / retry regressions.
#
# Live repro: a Mueller Hut hunt for Dec 25 2026, checked while the DOC site
# still shows its default ~3-week window (currently Jul 8-28). The original
# `_target_day_in_visible_table` matched on day-of-month alone, so day 25
# matched the visible Jul 25 column and `detect_availability` went on to read
# July's Site List as December's — a false Unavailable, or worse a false
# Available leading to a wrong-date hold. These fakes model just enough of
# the Playwright Locator surface (`count`/`nth`/`inner_text`/`locator`) for
# `_target_day_in_visible_table` and `_extract_column_data` to run against a
# scripted table, without a browser.
# ---------------------------------------------------------------------------

class _FakeCell:
    def __init__(self, text: str):
        self._text = text

    async def inner_text(self):
        return self._text

    async def inner_html(self):
        return f"<span>{self._text}</span>"


class _FakeCellsRow:
    """Stand-in for `row.locator("th, td")` — a fixed list of cell texts."""

    def __init__(self, texts: list[str]):
        self._cells = [_FakeCell(t) for t in texts]

    async def count(self):
        return len(self._cells)

    def nth(self, i: int):
        return self._cells[i]


class _FakeRow:
    def __init__(self, texts: list[str]):
        self._texts = texts

    def locator(self, _selector: str):
        return _FakeCellsRow(self._texts)


class _FakeRows:
    def __init__(self, rows_texts: list[list[str]]):
        self._rows = [_FakeRow(t) for t in rows_texts]

    async def count(self):
        return len(self._rows)

    def nth(self, i: int):
        return self._rows[i]


class _FakeTable:
    """Stand-in for the Site List `<table>` locator, driven by a 2D grid of
    cell texts (one list of strings per row)."""

    def __init__(self, rows_texts: list[list[str]]):
        self._rows_texts = rows_texts

    def locator(self, selector: str):
        assert selector == "tr", f"unexpected selector on fake table: {selector!r}"
        return _FakeRows(self._rows_texts)


def _patch_table(adapter: DocStandardHutAdapter, rows_texts: list[list[str]]) -> None:
    async def fake_get_site_list_table(_page):
        return _FakeTable(rows_texts)

    adapter._get_site_list_table = fake_get_site_list_table  # type: ignore[method-assign]


class TestTargetDayInVisibleTableMonthGuard:
    """`_target_day_in_visible_table` — the fast-path decision in fill_form."""

    async def test_fast_path_not_taken_when_bar_shows_different_month(self):
        """Regression for the live bug: today's default window is July, the
        job's target is Dec 25. Day 25 genuinely appears as a column header,
        but the booking bar text still says "Jul" — that must be enough to
        veto the fast path, since taking it would silently read July's
        column as December's."""
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["Site", "08", "09", "10", "20", "25", "26", "27", "28"],
        ])

        taken = await adapter._target_day_in_visible_table(
            page=object(),
            target_day=25,
            target_month="December",
            bar_text="1 Night Wed, Jul 08 - Thu, Jul 09",
        )

        assert taken is False

    async def test_fast_path_not_taken_when_table_month_label_contradicts_target(self):
        """Defense-in-depth: even with no usable bar text (e.g. the bar read
        came back empty because the site is between hydration states), a
        month label rendered in the table itself (here embedded in the
        header row, as some DOC layouts do) must also veto the fast path."""
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["Site", "Jul", "08", "09", "25", "26"],
        ])

        taken = await adapter._target_day_in_visible_table(
            page=object(),
            target_day=25,
            target_month="December",
            bar_text="",
        )

        assert taken is False

    async def test_fast_path_taken_when_target_genuinely_inside_default_window(self):
        """A target date genuinely inside the default window (same month the
        bar/table are showing) must still use the fast path — the fix must
        not make every hunt fall through to the slow datepicker path."""
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["Site", "08", "09", "10", "20", "25", "26", "27", "28"],
        ])

        taken = await adapter._target_day_in_visible_table(
            page=object(),
            target_day=20,
            target_month="July",
            bar_text="1 Night Wed, Jul 08 - Thu, Jul 09",
        )

        assert taken is True

    async def test_fast_path_not_taken_when_day_not_a_column(self):
        """Sanity check: the original day-not-found behaviour is preserved."""
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["Site", "08", "09", "10"],
        ])

        taken = await adapter._target_day_in_visible_table(
            page=object(),
            target_day=25,
            target_month="July",
            bar_text="1 Night Wed, Jul 08 - Thu, Jul 09",
        )

        assert taken is False


class TestExtractColumnDataMonthMismatchGuard:
    """`_extract_column_data` — defense-in-depth, independent of the fast path."""

    async def test_ok_false_with_distinct_evidence_when_table_month_disagrees(self):
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["July"],
            ["Site", "24", "25", "26"],
            ["Mueller Hut", "available", "available", "available"],
        ])

        parsed = await adapter._extract_column_data(
            page=object(), hut_name="Mueller Hut", target_day=25, target_month="December",
        )

        assert parsed["ok"] is False
        assert "July" in parsed["reason"]
        assert "December" in parsed["reason"]

    async def test_ok_true_when_table_month_matches_target(self):
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["July"],
            ["Site", "24", "25", "26"],
            ["Mueller Hut", "available", "available", "available"],
        ])

        parsed = await adapter._extract_column_data(
            page=object(), hut_name="Mueller Hut", target_day=25, target_month="July",
        )

        assert parsed["ok"] is True

    async def test_ok_true_when_table_has_no_month_label_at_all(self):
        """Not every facility layout renders a standalone month label — in
        that case there's nothing to contradict target_month, so extraction
        must proceed exactly as it did before THR-128."""
        adapter = DocStandardHutAdapter()
        _patch_table(adapter, rows_texts=[
            ["Site", "24", "25", "26"],
            ["Mueller Hut", "available", "available", "available"],
        ])

        parsed = await adapter._extract_column_data(
            page=object(), hut_name="Mueller Hut", target_day=25, target_month="December",
        )

        assert parsed["ok"] is True


# ---------------------------------------------------------------------------
# THR-128 — booking-bar placeholder read must not crash.
# ---------------------------------------------------------------------------

class _FakePlaceholderLocator:
    """Always-visible, single-match locator that reports `text` for both
    itself and its "ancestor container"."""

    def __init__(self, text: str):
        self._text = text

    async def count(self):
        return 1

    def nth(self, _i: int):
        return self

    async def is_visible(self):
        return True

    def locator(self, _selector: str):
        return self

    async def inner_text(self):
        return self._text


class _EmptyLocator:
    async def count(self):
        return 0


class TestReadBookingBarTextPlaceholder:
    async def test_returns_placeholder_text_instead_of_raising(self):
        """THR-128: the DOC booking bar now sometimes loads with the "Select
        Arrival - End Date" placeholder rather than a pre-filled default
        range. That text never matches `_DATE_RANGE_TEXT_RE`, so the
        un-patched `_read_booking_bar_text` raised RuntimeError("No visible
        matching locator found") on a perfectly normal "no dates chosen yet"
        page state."""
        adapter = DocStandardHutAdapter()

        async def fake_get_date_range_locator(_page):
            raise RuntimeError("No visible matching locator found")

        adapter._get_date_range_locator = fake_get_date_range_locator  # type: ignore[method-assign]

        class _Page:
            def get_by_text(self, _pattern):
                return _FakePlaceholderLocator("Select Arrival - End Date")

        text = await adapter._read_booking_bar_text(_Page())

        assert "Select Arrival" in text

    async def test_returns_empty_string_when_bar_is_entirely_unreadable(self):
        """If neither a date range nor the placeholder can be found at all,
        the read must degrade to an empty string, not raise — callers
        already treat a non-matching `before` as "no target range yet"."""
        adapter = DocStandardHutAdapter()

        async def fake_get_date_range_locator(_page):
            raise RuntimeError("No visible matching locator found")

        adapter._get_date_range_locator = fake_get_date_range_locator  # type: ignore[method-assign]

        async def fake_first_visible(_loc, timeout_ms=3000, poll_ms=200):
            raise RuntimeError("No visible matching locator found")

        adapter._first_visible = fake_first_visible  # type: ignore[method-assign]

        class _Page:
            def get_by_text(self, _pattern):
                return _EmptyLocator()

        text = await adapter._read_booking_bar_text(_Page())

        assert text == ""


# ---------------------------------------------------------------------------
# THR-128 — `_first_visible` bounded retry.
# ---------------------------------------------------------------------------

class _NeverVisibleLocator:
    def __init__(self):
        self.is_visible_calls = 0

    async def count(self):
        return 1

    def nth(self, _i: int):
        return self

    async def is_visible(self):
        self.is_visible_calls += 1
        return False


class _EventuallyVisibleLocator:
    def __init__(self, visible_after: int):
        self._visible_after = visible_after
        self.calls = 0

    async def count(self):
        return 1

    def nth(self, _i: int):
        return self

    async def is_visible(self):
        self.calls += 1
        return self.calls > self._visible_after


class TestFirstVisibleBoundedRetry:
    async def test_retries_then_raises_with_original_message(self):
        """THR-128: the original implementation made a single pass and
        raised immediately. It must now poll for a bounded window before
        giving up — verified here by a locator that's never visible, kept
        fast with a tiny timeout/poll interval."""
        adapter = DocStandardHutAdapter()
        loc = _NeverVisibleLocator()

        with pytest.raises(RuntimeError, match="No visible matching locator found"):
            await adapter._first_visible(loc, timeout_ms=30, poll_ms=5)

        assert loc.is_visible_calls > 1, (
            "expected _first_visible to poll more than once before raising"
        )

    async def test_returns_locator_once_it_becomes_visible_after_polling(self):
        adapter = DocStandardHutAdapter()
        loc = _EventuallyVisibleLocator(visible_after=2)

        result = await adapter._first_visible(loc, timeout_ms=200, poll_ms=5)

        assert result is loc
        assert loc.calls > 2
