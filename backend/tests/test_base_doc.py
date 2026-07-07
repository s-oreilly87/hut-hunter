"""Unit tests for BaseDOCAdapter's login path (THR-127).

Focused narrowly on the CredentialsRejectedError split introduced here: a
CONFIRMED rejection (the login modal was filled + submitted and never
closes) must raise CredentialsRejectedError, not a plain RuntimeError, so
the hold worker can demote the stored credential instead of treating it as
an unknown/infra state. Uses the real DocGreatWalkAdapter (concrete,
_login_if_prompted is inherited unchanged from BaseDOCAdapter) against a
minimal fake Page — no Playwright browser involved.
"""

from __future__ import annotations

import pytest
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.adapters.base import CredentialsRejectedError
from app.adapters.doc_great_walk import DocGreatWalkAdapter
from app.models.credential import AdapterCredentialSecret

pytestmark = pytest.mark.asyncio


class _DocModalLocator:
    """Stand-in for `page.locator("#loginPopup").first` — visible
    immediately, but never closes (models the confirmed-rejection case)."""

    def __init__(self, *, closes: bool):
        self._closes = closes

    async def count(self):
        return 1

    @property
    def first(self):
        return self

    async def wait_for(self, state="visible", timeout=None):
        if state == "visible":
            return None
        if state == "hidden" and not self._closes:
            raise PlaywrightTimeoutError("modal did not close")


class _FillableLocator:
    async def fill(self, _value):
        return None


class _ClickableLocator:
    async def click(self):
        return None


class _DocLoginPage:
    def __init__(self, modal: _DocModalLocator):
        self._modal = modal

    def locator(self, selector):
        if selector == "#loginPopup":
            return self._modal
        return _FillableLocator()

    def get_by_role(self, role, name=None):
        return _ClickableLocator()

    async def wait_for_load_state(self, state, timeout=None):
        return None


async def test_login_if_prompted_raises_credentials_rejected_on_confirmed_rejection():
    """Form filled + submitted (Sign In clicked), the modal never closes —
    the exact confirmed-rejection signal verify_credentials already trusts
    as FAILED. Must raise CredentialsRejectedError, not a bare RuntimeError."""
    adapter = DocGreatWalkAdapter()
    adapter.set_login_credentials(
        AdapterCredentialSecret(username="user@example.com", password="hunter2")
    )

    async def fake_snapshot(_page, label, *, include_html=None):
        return f"artifacts/{label}"

    adapter.snapshot = fake_snapshot  # type: ignore[method-assign]

    page = _DocLoginPage(_DocModalLocator(closes=False))

    with pytest.raises(CredentialsRejectedError):
        await adapter._login_if_prompted(page)


async def test_login_if_prompted_succeeds_when_modal_closes():
    # Sanity check the fake's "closes" branch actually represents success,
    # so the failure test above is meaningfully exercising the other path.
    adapter = DocGreatWalkAdapter()
    adapter.set_login_credentials(
        AdapterCredentialSecret(username="user@example.com", password="hunter2")
    )
    page = _DocLoginPage(_DocModalLocator(closes=True))

    result = await adapter._login_if_prompted(page)
    assert result is True


async def test_login_if_prompted_missing_credentials_raises_plain_runtime_error():
    # Unrelated to a rejection — a config problem stays a plain RuntimeError,
    # not the confirmed-rejection signal (no credentials were ever
    # submitted to reject).
    adapter = DocGreatWalkAdapter()
    page = _DocLoginPage(_DocModalLocator(closes=True))

    with pytest.raises(RuntimeError) as exc_info:
        await adapter._login_if_prompted(page)
    assert not isinstance(exc_info.value, CredentialsRejectedError)
