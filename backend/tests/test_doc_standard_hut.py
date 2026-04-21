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
