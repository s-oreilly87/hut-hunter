"""Unit tests for DocGreatWalkAdapter — THR-128 applied-date verification.

THR-128 asked us to verify `_set_start_date` fails loudly when the calendar
navigation lands on the wrong month/day rather than silently letting
`detect_availability` search a default date instead of the target (the
concrete risk called out in the ticket is month navigation to a far-future
date, e.g. Dec 2026, silently failing to land and leaving some earlier
default date applied). It turns out this verification already exists in
`_set_start_date` (the `selected` / `want` / TimeoutError block) — these
tests exercise it directly with a minimal fake Page/popper, no Playwright
browser involved, mirroring the fake-Page style used in test_base_doc.py.
"""

from __future__ import annotations

import pytest

import app.adapters.doc_great_walk as _mod
from app.adapters.doc_great_walk import DocGreatWalkAdapter

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeHeader:
    """Stand-in for the datepicker popup's `.react-datepicker__current-month`
    label — already showing the target month/year, so `_set_start_date`'s
    month-navigation loop breaks on its first check without needing to click
    next/prev."""

    def __init__(self, text: str):
        self._text = text

    async def inner_text(self):
        return self._text


class _FakeDayLocator:
    """Stand-in for both the aria-label day locator and the plain-text day
    locator — reports a fixed `count()` and accepts a click."""

    def __init__(self, count: int):
        self._count = count

    async def count(self):
        return self._count

    @property
    def first(self):
        return self

    async def click(self, timeout=None, force=False):
        return None


class _FakePopper:
    def __init__(self, header_text: str):
        self.header = _FakeHeader(header_text)

    def locator(self, _selector: str):
        # Next/prev month nav buttons — unused when the header already
        # matches the target month/year.
        return _FakeDayLocator(count=0)

    def get_by_role(self, role, name=None):
        return _FakeDayLocator(count=1)

    def get_by_text(self, _pattern):
        return _FakeDayLocator(count=1)


class _FakeSelectedDateLocator:
    """Stand-in for `#great-walk-start-date .selectedDate span` — reports
    whatever date string the fake page currently has "applied"."""

    def __init__(self, applied_text: str):
        self._applied_text = applied_text

    async def wait_for(self, state="visible", timeout=None):
        return None

    async def inner_text(self):
        return self._applied_text


class _FakeGreatWalkPage:
    def __init__(self, applied_date_text: str):
        self._applied_date_text = applied_date_text

    def locator(self, selector: str):
        if selector == "#great-walk-start-date .selectedDate span":
            return _FakeSelectedDateLocator(self._applied_date_text)
        raise AssertionError(f"unexpected selector on fake page: {selector!r}")


# ---------------------------------------------------------------------------
# Speed up the polling loops inside _set_start_date / _wait_for_header_change
# — they use asyncio.sleep(0.2)/asyncio.sleep(0.12) between polls, which
# would otherwise make a "never matches" test take several real seconds.
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def fast_sleep(monkeypatch):
    async def _fast_sleep(_seconds):
        return None

    monkeypatch.setattr(_mod.asyncio, "sleep", _fast_sleep)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_set_start_date_succeeds_when_applied_date_matches_target():
    """Sanity check: when the site's selected-date control actually updates
    to the requested day/month/year, `_set_start_date` returns normally."""
    adapter = DocGreatWalkAdapter()
    target_month, target_year, day = "December", 2026, 25

    fake_popper = _FakePopper(f"{target_month} {target_year}")

    async def fake_open_datepicker(_page):
        return fake_popper, fake_popper.header

    adapter._open_datepicker = fake_open_datepicker  # type: ignore[method-assign]

    page = _FakeGreatWalkPage(applied_date_text="Selected: 25/12/2026")

    await adapter._set_start_date(page, target_month, target_year, day)


async def test_set_start_date_raises_when_applied_date_never_matches_target():
    """THR-128: the risky case is month navigation to a far-future date
    (e.g. Dec 2026) silently failing to actually apply — the site could be
    left showing some earlier default date while the adapter proceeds as if
    December were selected, and `detect_availability` would then read
    availability for the wrong month/day entirely. `_set_start_date` must
    fail loudly (TimeoutError) instead of silently continuing when the
    selected-date control never reflects the target date."""
    adapter = DocGreatWalkAdapter()
    target_month, target_year, day = "December", 2026, 25

    fake_popper = _FakePopper(f"{target_month} {target_year}")

    async def fake_open_datepicker(_page):
        return fake_popper, fake_popper.header

    adapter._open_datepicker = fake_open_datepicker  # type: ignore[method-assign]

    # The control never updates — stays on some unrelated default date.
    page = _FakeGreatWalkPage(applied_date_text="Selected: 08/07/2026")

    with pytest.raises(TimeoutError, match="Start date did not update"):
        await adapter._set_start_date(page, target_month, target_year, day)
