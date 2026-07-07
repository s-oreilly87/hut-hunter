"""Tests for the hold worker's attempt_hold_task state machine, focused on
THR-122: the branch that parks a session for manual takeover instead of
tearing the browser down when a hold attempt hits an UNEXPECTED condition
(as opposed to a known clean-negative outcome like no availability, missing
credentials, or login rejected — those keep going through the existing
Hold Failed path unchanged).
"""

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import timedelta

import pytest

import app.workers.hold_worker as hold_worker
from app.adapters.base import (
    AvailabilityResult,
    AvailabilityStatus,
    BookingResult,
    BookingWindowClosedDuringHold,
    BookingWindowInfo,
    CredentialsRejectedError,
    UnexpectedHoldFailure,
)
from app.core.adapter_credentials import get_adapter_credential_record
from app.models.job import JobStatus, as_utc, utcnow
from app.models.session import CartSession

pytestmark = pytest.mark.asyncio


class _FakePage:
    """Just enough of a Playwright Page for the code paths under test."""

    def __init__(self, url: str = "https://example.test/checkout"):
        self.url = url

    async def screenshot(self, **kwargs):
        return None

    async def content(self):
        return "<html></html>"

    @property
    def context(self):
        return self

    async def cookies(self):
        return [{"name": "session", "value": "abc", "domain": "example.test", "path": "/"}]


@dataclass
class _FakeAdapter:
    """Minimal BaseAdapter stand-in. Each test configures the hold_effect to
    control what attempt_hold does: return a BookingResult, or raise."""

    adapter_id: str = "fake_adapter"
    name: str = "Fake Adapter"
    cart_hold_minutes: int | None = 15
    hold_effect: object = None  # BookingResult to return, or an Exception to raise
    persist_effect: object = None  # Exception to raise from _persist_cart_session, if set
    _artifact_log: list = field(default_factory=list)
    _login_credentials: object = None

    def set_login_credentials(self, credentials):
        self._login_credentials = credentials

    async def fill_form(self, page, params):
        return None

    async def detect_availability(self, page, params):
        return [
            AvailabilityResult(site="Test Site", status=AvailabilityStatus.AVAILABLE, evidence="1 spot", total_available=1)
        ]

    async def attempt_hold(self, page, params):
        if isinstance(self.hold_effect, Exception):
            raise self.hold_effect
        if self.hold_effect is not None:
            return self.hold_effect
        return BookingResult(success=True, held=True, reservation_url="https://app.test/pay/x", message="ok")

    async def snapshot(self, page, label, *, include_html=None):
        base = f"artifacts/fake_{label}"
        self._artifact_log.append(type("S", (), {"label": label, "base": base})())
        return base

    def consume_artifacts(self):
        artifacts = self._artifact_log[:]
        self._artifact_log.clear()
        return artifacts

    async def _persist_cart_session(self, page, job_id, cart_url):
        if self.persist_effect is not None:
            raise self.persist_effect
        cart_url = cart_url or page.url
        # Mirror the real adapters' _persist_cart_session: actually write a
        # CartSession row (via the same encrypt/AsyncSessionLocal machinery)
        # so tests can assert on it exactly like the production path.
        from app.core.crypto import encrypt
        from app.core.database import AsyncSessionLocal

        cookies = await page.context.cookies()
        cart = CartSession(
            job_id=job_id,
            encrypted_cookies=encrypt(json.dumps(cookies)),
            cart_url=cart_url,
            expires_at=utcnow() + timedelta(minutes=self.cart_hold_minutes or 25),
        )
        async with AsyncSessionLocal() as db_session:
            db_session.add(cart)
            await db_session.commit()
        return f"http://testserver/pay/{job_id}"


@asynccontextmanager
async def _fake_browser_page(*, headless, display=None, registry=None):
    page = _FakePage()
    keep_key: list[str | None] = [None]

    def keep_alive(job_id: str) -> None:
        keep_key[0] = job_id

    try:
        yield page, keep_alive
    finally:
        if keep_key[0] is not None and registry is not None:
            registry[keep_key[0]] = {
                "pw_cm": None,
                "browser": None,
                "context": None,
                "page": page,
                "created_at": utcnow(),
                "last_keepalive_at": utcnow(),
            }


@pytest.fixture(autouse=True)
def _patch_hold_worker_session(session_factory, monkeypatch):
    """Point the hold worker's AsyncSessionLocal at the test's sqlite DB."""
    monkeypatch.setattr(hold_worker, "AsyncSessionLocal", session_factory)
    import app.workers._shared as worker_shared
    monkeypatch.setattr(worker_shared, "AsyncSessionLocal", session_factory)
    yield
    # Module-level LIVE_BROWSERS is process-global state; don't leak entries
    # between tests.
    hold_worker.LIVE_BROWSERS.clear()


@pytest.fixture
def notifications(monkeypatch):
    calls = []

    async def _fake_dispatch(settings_secret, *, title, message, priority=5):
        calls.append({"title": title, "message": message, "priority": priority})

    monkeypatch.setattr(hold_worker, "dispatch_notification_targets", _fake_dispatch)
    return calls


def _install_fake_adapter(monkeypatch, adapter: _FakeAdapter):
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: False)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)


async def test_unexpected_failure_parks_session_and_sets_needs_attention(
    monkeypatch, seed_job, fetch_job, notifications, list_carts,
):
    """An exception that isn't a known clean-negative outcome (e.g. an
    unrecognized blocking dialog) should park the browser and flip the job to
    needs_attention instead of tearing down and marking Hold Failed."""
    adapter = _FakeAdapter(hold_effect=UnexpectedHoldFailure("Unknown 'Double Site' dialog blocked Reserve"))
    _install_fake_adapter(monkeypatch, adapter)

    job = await seed_job(status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "needs_attention"

    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.NEEDS_ATTENTION.value

    # Browser stays alive — registered in LIVE_BROWSERS, not torn down.
    assert job.id in hold_worker.LIVE_BROWSERS

    # Cart session parked exactly like a successful hold would be.
    carts = await list_carts(job.id)
    assert len(carts) == 1

    # Notified immediately, with the takeover link, at hold-secured urgency.
    assert len(notifications) == 1
    assert notifications[0]["priority"] == 10
    assert f"/pay/{job.id}" in notifications[0]["message"]
    assert "unexpected" in notifications[0]["message"].lower()


async def test_parking_failure_falls_back_to_hold_failed_teardown(
    monkeypatch, seed_job, fetch_job, notifications, list_carts,
):
    """If _persist_cart_session itself blows up, fail closed: tear the
    browser down and report the original failure via the existing Hold
    Failed path rather than leaving a browser alive with no CartSession."""
    adapter = _FakeAdapter(
        hold_effect=UnexpectedHoldFailure("Unknown dialog"),
        persist_effect=RuntimeError("DB is down"),
    )
    _install_fake_adapter(monkeypatch, adapter)

    job = await seed_job(status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "hold_failed"

    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.WAITING.value  # enable_monitoring=True path

    # No live browser left registered for this job.
    assert job.id not in hold_worker.LIVE_BROWSERS

    # No cart session was persisted.
    carts = await list_carts(job.id)
    assert carts == []

    # Falls through to the *existing* hold-failed notification path (sites
    # were available, hold failed) — no needs-attention notification fires.
    assert len(notifications) == 1
    assert notifications[0]["title"] == "🏕️ Available but hold failed"


async def test_known_clean_negative_outcome_still_uses_existing_hold_failed_path(
    monkeypatch, seed_job, fetch_job, notifications,
):
    """A known clean-negative outcome (e.g. login rejected) is reported by
    the adapter as a returned BookingResult(held=False, ...), not a raised
    exception, so it should be entirely unaffected by the THR-122 branch."""
    adapter = _FakeAdapter(
        hold_effect=BookingResult(success=False, held=False, message="Camis login did not complete"),
    )
    _install_fake_adapter(monkeypatch, adapter)

    job = await seed_job(status=JobStatus.CHECKING.value, enable_monitoring=False)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "hold_failed"
    assert result["message"] == "Camis login did not complete"

    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.PAUSED.value  # enable_monitoring=False path
    last_result = json.loads(refreshed.last_result)
    assert last_result == [{"type": "hold_failed", "error": "Camis login did not complete"}]

    assert job.id not in hold_worker.LIVE_BROWSERS


async def test_hold_skipped_when_credential_failed_verification(
    monkeypatch, seed_job, seed_credential, fetch_job, notifications,
):
    """THR-123: a credential that failed its login check is treated the same
    as no credential at all — never worth burning a hold attempt on a
    known-bad login. attempt_hold gates on this before the browser opens, so
    hold_effect being a success here proves the gate short-circuited first."""
    adapter = _FakeAdapter(
        hold_effect=BookingResult(success=True, held=True, reservation_url="http://testserver/pay/x", message="ok"),
    )
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: True)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)

    await seed_credential(adapter_id="doc_great_walk", is_verified=False)
    job = await seed_job(adapter_id="doc_great_walk", status=JobStatus.CHECKING.value, enable_monitoring=False)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "hold_failed"
    assert "failed verification" in result["message"]

    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.PAUSED.value
    assert job.id not in hold_worker.LIVE_BROWSERS


async def test_successful_hold_is_unaffected_by_needs_attention_branch(
    monkeypatch, seed_job, fetch_job, notifications, list_carts,
):
    adapter = _FakeAdapter(
        hold_effect=BookingResult(success=True, held=True, reservation_url="http://testserver/pay/abc", message="Cart secured"),
    )
    _install_fake_adapter(monkeypatch, adapter)

    job = await seed_job(status=JobStatus.CHECKING.value)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "held"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.HOLD_PLACED.value
    assert job.id in hold_worker.LIVE_BROWSERS
    assert len(notifications) == 1
    assert notifications[0]["title"] == "🏕️ Hold Secured!"


# ---------------------------------------------------------------------------
# THR-127 §3 — verified-only credential gate (a stored-but-not-FAILED
# credential used to be enough; now it must have actually PASSED
# verification).
# ---------------------------------------------------------------------------

async def test_hold_skipped_when_credential_not_yet_verified(
    monkeypatch, seed_job, seed_credential, fetch_job, notifications,
):
    """A credential that's stored but never verified (unverified/pending/
    inconclusive — as opposed to actively FAILED) must also skip the hold,
    not just a FAILED one — THR-123's original gate only excluded FAILED."""
    adapter = _FakeAdapter(
        hold_effect=BookingResult(success=True, held=True, reservation_url="http://testserver/pay/x", message="ok"),
    )
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: True)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)

    await seed_credential(adapter_id="doc_great_walk")  # defaults to "unverified"
    job = await seed_job(adapter_id="doc_great_walk", status=JobStatus.CHECKING.value, enable_monitoring=False)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "hold_failed"
    assert "not been verified yet" in result["message"]

    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.PAUSED.value
    assert job.id not in hold_worker.LIVE_BROWSERS


async def test_hold_proceeds_when_credential_is_verified(
    monkeypatch, seed_job, seed_credential, fetch_job,
):
    """The positive case: a VERIFIED credential passes the gate and the hold
    actually runs (proven by hold_effect's success reaching HOLD_PLACED)."""
    adapter = _FakeAdapter(
        hold_effect=BookingResult(success=True, held=True, reservation_url="http://testserver/pay/x", message="ok"),
    )
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: True)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)

    await seed_credential(adapter_id="doc_great_walk", is_verified=True)
    job = await seed_job(adapter_id="doc_great_walk", status=JobStatus.CHECKING.value)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "held"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.HOLD_PLACED.value


# ---------------------------------------------------------------------------
# THR-127 §4 — CredentialsRejectedError: a CONFIRMED login rejection during a
# hold attempt is a CLEAN negative (demote + normal Hold Failed), NOT the
# THR-122 takeover path, and NOT a silent Hold Failed that leaves a
# known-bad credential sitting there as VERIFIED.
# ---------------------------------------------------------------------------

async def test_credentials_rejected_during_hold_demotes_credential_and_reports_hold_failed(
    monkeypatch, seed_job, seed_credential, fetch_job, notifications, session_factory,
):
    adapter = _FakeAdapter(hold_effect=CredentialsRejectedError("Camis login did not complete"))
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: True)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)

    await seed_credential(adapter_id="doc_great_walk", is_verified=True)
    job = await seed_job(adapter_id="doc_great_walk", status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    # Clean Hold Failed, NOT needs_attention — the whole point of the split.
    assert result["status"] == "hold_failed"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.WAITING.value
    assert job.id not in hold_worker.LIVE_BROWSERS

    # The credential is demoted to FAILED — blocks further auto-book via the
    # verified-only gate and surfaces in Sign-Ins/JobBlockingNotices.
    async with session_factory() as session:
        record = await get_adapter_credential_record(session, job.user_id, "doc_great_walk")
        assert record.verification_status == "failed"
        assert record.is_verified is False
        assert "hold attempt" in record.verification_message

    assert len(notifications) == 1
    assert notifications[0]["title"] == "🏕️ Sign-in rejected"


async def test_infra_login_failure_during_hold_does_not_demote_and_still_takes_over(
    monkeypatch, seed_job, seed_credential, fetch_job, notifications, session_factory,
):
    """The THR-126 §2 split this must preserve: an infra-flavored failure
    (stuck consent gate, queue-it, an unrecognized state) is NOT a
    credentials rejection — it must still take the existing
    UnexpectedHoldFailure/generic-exception takeover path, and must NOT
    demote the credential (it says nothing about whether the login itself
    is good or bad)."""
    adapter = _FakeAdapter(hold_effect=UnexpectedHoldFailure("Camis cookie-consent banner would not dismiss"))
    monkeypatch.setattr(hold_worker, "get_adapter", lambda adapter_id: adapter)
    monkeypatch.setattr(hold_worker, "adapter_requires_credentials", lambda adapter_id: True)
    monkeypatch.setattr(hold_worker, "_browser_page", _fake_browser_page)

    await seed_credential(adapter_id="doc_great_walk", is_verified=True)
    job = await seed_job(adapter_id="doc_great_walk", status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "needs_attention"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.NEEDS_ATTENTION.value
    assert job.id in hold_worker.LIVE_BROWSERS

    # Credential untouched — still VERIFIED.
    async with session_factory() as session:
        record = await get_adapter_credential_record(session, job.user_id, "doc_great_walk")
        assert record.verification_status == "verified"


# ---------------------------------------------------------------------------
# THR-127 §1 — BookingWindowClosedDuringHold: the site's own "Cannot Reserve
# ... not yet allowed" modal maps to AWAITING_WINDOW, not Hold Failed and not
# the needs-attention takeover.
# ---------------------------------------------------------------------------

async def test_booking_window_closed_during_hold_maps_to_awaiting_window(
    monkeypatch, seed_job, fetch_job, notifications,
):
    opens_at = utcnow() + timedelta(days=10)
    window = BookingWindowInfo(is_open=False, opens_at=opens_at, opens_at_precise=True)
    adapter = _FakeAdapter(hold_effect=BookingWindowClosedDuringHold(window))
    _install_fake_adapter(monkeypatch, adapter)  # requires_credentials=False, irrelevant here

    job = await seed_job(status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "awaiting_window"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.AWAITING_WINDOW.value
    assert refreshed.enable_monitoring is True
    assert as_utc(refreshed.window_opens_at) == opens_at
    assert refreshed.window_opens_precise is True
    assert refreshed.next_check_at is None

    # No live browser left registered — same as a normal Hold Failed, not a
    # parked takeover session.
    assert job.id not in hold_worker.LIVE_BROWSERS

    assert len(notifications) == 1
    assert notifications[0]["title"] == "🏕️ Not released yet"


async def test_window_closed_during_hold_without_opens_at_does_not_strand(
    monkeypatch, seed_job, fetch_job, notifications,
):
    """THR-127: if the recomputed window carries no opens_at (fail-open
    lookup error, or the window opened between the modal and the recompute),
    the job must NOT be parked AWAITING_WINDOW — scheduler Pass 0 only arms
    rows with a non-null window_opens_at, so that would strand it forever.
    It falls back to the normal WAITING retry instead."""
    window = BookingWindowInfo(is_open=True)  # opens_at is None
    adapter = _FakeAdapter(hold_effect=BookingWindowClosedDuringHold(window))
    _install_fake_adapter(monkeypatch, adapter)

    job = await seed_job(status=JobStatus.CHECKING.value, enable_monitoring=True)

    result = await hold_worker.attempt_hold_task({}, job.id)

    assert result["status"] == "hold_failed"
    refreshed = await fetch_job(job.id)
    assert refreshed.status == JobStatus.WAITING.value
    assert refreshed.window_opens_at is None
    assert refreshed.next_check_at is not None
    assert job.id not in hold_worker.LIVE_BROWSERS
