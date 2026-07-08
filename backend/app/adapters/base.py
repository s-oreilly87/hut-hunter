import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, time
from enum import Enum
from pathlib import Path
from typing import Any

from playwright.async_api import Page

from app.core.artifacts import DEBUG_SNAPSHOT_TERMS
from app.core.config import settings
from app.models.credential import AdapterCredentialSecret

class AvailabilityStatus(str, Enum):
    AVAILABLE = "available"
    PARTIALLY_AVAILABLE = "partially_available"
    # THR-133: sites exist but the requested stay pattern is blocked by a
    # Camis arrival/departure changeover or min/max-stay rule — distinct from
    # UNAVAILABLE (sold out) since adjusting dates/nights could still work.
    RESTRICTED = "restricted"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


class UnexpectedHoldFailure(Exception):
    """Raised by an adapter's ``attempt_hold`` when it hits a condition it has
    no specific handling for — an unrecognized blocking dialog (e.g. BC Parks
    Alice Lake site 21's "Double Site" confirmation), a locator timeout mid-
    funnel, or any other unanticipated state.

    THR-122: this is distinct from the "known clean negative" outcomes (no
    availability, missing credentials, login rejected) that adapters already
    report by *returning* ``BookingResult(held=False, ...)`` — those keep
    going through the existing Hold Failed path unchanged. An
    ``UnexpectedHoldFailure`` (or, equivalently, any exception an adapter
    doesn't catch itself) tells the hold worker the browser is in an unknown
    state that a human should look at, so it parks the session for takeover
    instead of tearing the browser down. Adapters aren't required to raise
    this explicitly — letting an exception escape ``attempt_hold`` uncaught
    has the same effect, since every currently-known clean-negative case is
    already handled locally and returns rather than raises.
    """


class CredentialsRejectedError(RuntimeError):
    """Raised by an adapter's login path when a hold-time sign-in attempt is
    CONFIRMED rejected — the form was filled and submitted, there was no
    post-login redirect, and the page still doesn't show a signed-in state.

    This is exactly the same FAILED-vs-INCONCLUSIVE signal
    ``verify_credentials`` already uses (THR-123) to distinguish "the site
    said no" from "the check itself couldn't run" (queue-it, a consent gate,
    a timeout before the form was ever submitted) — see
    ``BaseCamisAdapter.verify_credentials`` / ``BaseDOCAdapter.verify_credentials``.

    THR-127: unlike ``UnexpectedHoldFailure``, this is a CLEAN negative, not
    an unknown state. The hold worker must NOT park it for manual takeover
    (THR-122) — instead it demotes the stored credential to FAILED (which
    blocks further auto-book via the verified-only gate, see
    ``_job_has_required_credentials``), notifies that the sign-in needs
    updating, and reports a normal Hold Failed, exactly like any other known
    clean-negative outcome. Subclasses ``RuntimeError`` so existing
    ``except RuntimeError`` handling in ``verify_credentials`` keeps working
    unchanged; callers that need to single it out (the hold worker) must
    catch it BEFORE a broader ``except Exception``/``except RuntimeError``
    clause, same as any other exception-ordering concern.

    Any OTHER exception from a login path (a stuck consent banner, a
    queue-it timeout, a locator timeout before the form was ever submitted)
    is still infra-flavored and must keep raising ``UnexpectedHoldFailure``
    or letting the underlying exception propagate for takeover — this
    exception must only ever be raised for a confirmed rejection, never as a
    catch-all.
    """


@dataclass
class AvailabilityResult:
    site: str
    status: AvailabilityStatus
    evidence: str
    total_available: int | None = None
    icon: str | None = None


@dataclass
class BookingResult:
    success: bool
    held: bool = False
    reservation_url: str | None = None
    message: str = ""


class VerificationStatus(str, Enum):
    """Outcome of BaseAdapter.verify_credentials (THR-123).

    VERIFIED/FAILED both mean the login check actually ran to completion —
    the credential is either usable or known-bad. INCONCLUSIVE means the
    check itself couldn't complete (queue-it, consent gate, network) and
    says nothing about whether the credential works — callers must not
    treat it as a failure.
    """
    VERIFIED = "verified"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"


@dataclass
class CredentialVerificationResult:
    status: VerificationStatus
    message: str = ""


@dataclass
class ArtifactSnapshot:
    label: str
    base: str


@dataclass
class BookingWindowInfo:
    """Result of checking whether a job's requested date is inside the
    adapter's current booking window (THR-124).

    ``is_open=True`` covers two cases: the adapter has no rolling-window
    concept at all (the default — every DOC adapter), or it does but the
    requested date is already released. ``is_open=False`` means the poll
    worker should park the job in ``JobStatus.AWAITING_WINDOW`` instead of
    checking availability.

    A job is only ever parked in AWAITING_WINDOW when ``opens_at`` is set —
    if an adapter can tell a date isn't released yet but can't compute *when*
    it will be, it should fail open (return ``is_open=True``) rather than
    park a job with no way to ever auto-arm. ``opens_at_precise`` says
    whether ``opens_at`` is a confirmed go-live timestamp or a best-effort
    fallback (e.g. local midnight on the first day the season calendar
    considers reservable) — surfaced so the UI can hedge ("opens {date}" vs
    "opens sometime on {date}").
    """
    is_open: bool
    opens_at: datetime | None = None
    opens_at_precise: bool = True
    evidence: str = ""


@dataclass
class StayPatternInfo:
    """Result of validating a requested arrival/nights combo against an
    adapter's own stay-pattern rules (THR-133) — e.g. Camis's arrival/
    departure changeover day-of-week restriction and min/max-stay bands.

    Distinct from ``BookingWindowInfo``: a booking window is about WHEN a
    date becomes reservable; this is about whether the requested date/
    nights combo is bookable AT ALL, independent of timing — a date can be
    inside an open booking window and still be unbookable because the stay
    pattern itself violates the site's rules (the Golden Ears Thu-arrival/
    Sat-departure repro this ticket fixes: the window had opened and fired
    correctly, but the changeover rule made the hold fail anyway).
    """
    is_compliant: bool
    evidence: str = ""


class BookingWindowClosedDuringHold(Exception):
    """Raised by an adapter's ``attempt_hold`` when the booking site itself
    rejects the Reserve action with a "not yet allowed" / booking-window
    message deep in the funnel (THR-127) — the live repro this fixes: a BC
    Golden Ears hunt polled AVAILABLE (a beyond-window date can still return
    availability code 0 — see ``BaseCamisAdapter``'s module comment) and the
    hold died on a "Cannot Reserve ... not yet allowed" modal after clicking
    Reserve.

    This is a CLEAN, extremely specific negative — distinct from both a
    generic Hold Failed (the site didn't say anything about a booking
    window) and an ``UnexpectedHoldFailure`` (this isn't an unknown state,
    it's the site plainly saying "not released yet"). The hold worker maps
    it straight to ``JobStatus.AWAITING_WINDOW`` using the attached
    ``window`` — recomputed via ``check_booking_window`` rather than parsed
    out of the modal's own (locale-formatted, brittle) date text — instead
    of reporting Hold Failed or parking for manual takeover.
    """

    def __init__(self, window: BookingWindowInfo, message: str | None = None):
        self.window = window
        super().__init__(
            message or "Reserving this date is not yet allowed by the booking site"
        )


@dataclass
class ParamField:
    key: str
    label: str
    type: str          # "text" | "date" | "number" | "select"
    options: list[str] | None = None
    default: Any = None
    required: bool = True
    # When set, the frontend should use options_by[<value of filter_by field>]
    # as the select's options instead of `options`. Used e.g. to show only
    # the directions valid for the currently-selected track.
    filter_by: str | None = None
    options_by: dict[str, list[str]] | None = None
    # When set, the frontend renders a grouped <SelectGroup> dropdown where
    # each entry is {"group": str, "items": [str, …]}. When options_tree is
    # present, `options` should be the flattened item list so that older
    # API clients that don't understand options_tree still work correctly.
    options_tree: list[dict] | None = None
    # For number fields: inclusive lower/upper bounds surfaced to the frontend
    # so it can set min/max on the <input type="number"> and validate accordingly.
    min: int | None = None
    max: int | None = None


@dataclass
class OccupantField:
    key: str
    label: str
    type: str
    options: list[str] | None = None
    default: Any = None
    required: bool = True


class BaseAdapter(ABC):
    adapter_id: str
    name: str
    base_url: str

    # Booking window / expiry config.
    #
    # booking_timezone: IANA timezone name (e.g. "Pacific/Auckland").
    #   None means "use the server's local timezone".
    # booking_cutoff_hour / booking_cutoff_minute: time of day (local to
    #   booking_timezone) after which the start date is considered expired
    #   and no new reservations can be attempted.
    #   Defaults to 23:59 — end of the start date in local time.
    booking_timezone: str | None = None   # None → server local TZ
    booking_cutoff_time: time = time(23, 59)
    # Optional hold-page activity config. Adapters that park a live checkout
    # page can override these to keep the session warm before the site-level
    # inactivity timeout expires.
    cart_hold_minutes: int | None = None
    cart_inactive_after_minutes: int | None = None
    cart_keepalive_interval_minutes: int | None = None
    requires_credentials: bool = False
    # Whether Hut Hunter can drive this site's booking flow at all. False for
    # sites whose sign-in is third-party SSO only (e.g. Parks Canada:
    # Google/Facebook/GCKey) — Playwright can't automate those IdPs and we
    # never store IdP passwords, so such adapters are watch/notify only until
    # session-linking ships (THR-119). Gates auto_book and manual booking in
    # both the API and the UI.
    supports_automated_booking: bool = True
    # THR-124: True for adapters with a rolling booking window (Camis — dates
    # release on a per-park/per-province schedule rather than always being
    # bookable). Gates whether the API/wizard bother calling
    # check_booking_window at all; False adapters keep the pre-THR-124
    # behavior exactly (every job is immediately checkable).
    has_booking_windows: bool = False
    # THR-126: adapters sharing the same underlying account (e.g. the two DOC
    # adapters — Standard Hut and Great Walk are both bookings.doc.govt.nz
    # logins) declare the same non-None credential_realm so the credential
    # store treats them as one saved sign-in instead of asking the user to
    # enter (and verify) the same login twice. None (the default) means "this
    # adapter's credentials are keyed by its own adapter_id" — the Camis sites
    # each have their own distinct account and stay per-site. See
    # app.core.adapter_credentials for the resolution.
    credential_realm: str | None = None
    # THR-129 item 3: True when a booking on this site is made under a
    # single named "permit holder" rather than each occupant being booked
    # individually (Camis: the account holder's name is the permit holder
    # shown on the Review Reservation Details page — DOC books each named
    # occupant directly and has no such concept). Tells the frontend wizard
    # whether to show a holder picker when a job has more than one camper.
    uses_single_permit_holder: bool = False

    def __init__(self) -> None:
        self._artifact_log: list[ArtifactSnapshot] = []
        self._login_credentials: AdapterCredentialSecret | None = None

    @classmethod
    @abstractmethod
    def param_fields(cls) -> list[ParamField]:
        """Define the params schema — used by the frontend to render the config form."""
        ...

    @classmethod
    def occupant_fields(cls) -> list[OccupantField]:
        """Define any adapter-specific occupant fields used during booking."""
        return []

    @abstractmethod
    async def fill_form(self, page: Page, params: dict) -> None:
        """Navigate to the booking page and fill the search form."""
        ...

    @abstractmethod
    async def detect_availability(self, page: Page, params: dict) -> list[AvailabilityResult]:
        """Read the page after form submission and return availability results."""
        ...

    async def attempt_hold(self, page: Page, params: dict) -> BookingResult:
        """
        Click reserve to grab the 25-minute hold, return the reservation URL.
        Override in adapters that support it.
        """
        raise NotImplementedError(f"{self.__class__.__name__} does not support holds yet")

    async def verify_credentials(self, page: Page) -> CredentialVerificationResult:
        """
        Run just the sign-in steps (no booking funnel) and report whether the
        bound credentials work. Override in adapters with requires_credentials
        = True; never called otherwise (THR-123).
        """
        raise NotImplementedError(f"{self.__class__.__name__} does not support credential verification")

    async def check_booking_window(self, params: dict) -> BookingWindowInfo:
        """Whether ``params``'s requested date is inside a rolling booking
        window (THR-124).

        Default: no such concept — always open. ``BaseCamisAdapter``
        overrides this using the ``/api/dateschedule`` season calendar; DOC
        adapters (and any future adapter without a rolling window) keep this
        default, so job creation/monitoring behaves exactly as it did before
        THR-124.
        """
        return BookingWindowInfo(is_open=True)

    async def check_stay_pattern(self, params: dict) -> StayPatternInfo:
        """Whether the requested arrival/nights combo satisfies this
        adapter's own stay-pattern rules (THR-133) — e.g. Camis's arrival/
        departure changeover day-of-week restriction and min/max-stay
        bands.

        Default: no such concept — always compliant. ``BaseCamisAdapter``
        overrides this using the ``/api/dateschedule`` season calendar; DOC
        adapters (and any future adapter without stay-pattern rules) keep
        this default.
        """
        return StayPatternInfo(is_compliant=True)

    def results_url(self, params: dict) -> str | None:
        """THR-129: a deep-link to this adapter's booking-site results page
        for the given job params, if the adapter can build one.

        Default: None — most adapters don't have a stable, fully
        URL-driven results page (or the frontend already builds an
        equivalent link client-side from ``parseFacilityOption``, e.g. the
        DOC adapters). ``BaseCamisAdapter`` overrides this to wrap
        ``_results_deep_link`` (built for the THR-129 Finding E snapshot
        fix) so the ShowJob info bar can hyperlink the selected park.
        """
        return None

    def is_expired(self, params: dict) -> bool:
        """Return True if the job's start date has passed this adapter's
        booking cutoff in its local timezone.

        Default: expires at 23:59 on the start date in the server's local
        timezone. Adapters override booking_timezone / booking_cutoff_hour /
        booking_cutoff_minute to change this."""
        date_str = params.get("date")
        if not date_str:
            return False
        try:
            from datetime import timezone as _tz
            if self.booking_timezone is None:
                # Use the server's local timezone — astimezone() on a naive
                # datetime gives a local-aware datetime without needing zoneinfo.
                now = datetime.now().astimezone()
                tz = now.tzinfo
            else:
                from zoneinfo import ZoneInfo
                tz = ZoneInfo(self.booking_timezone)
            dd, mm, yyyy = date_str.split("/")
            cutoff = datetime(
                int(yyyy), int(mm), int(dd),
                self.booking_cutoff_time.hour, self.booking_cutoff_time.minute,
                tzinfo=tz,
            )
            return datetime.now(_tz.utc) > cutoff
        except Exception:
            return False

    @staticmethod
    def _snapshot_should_include_html(label: str) -> bool:
        return any(term in label.lower() for term in DEBUG_SNAPSHOT_TERMS)

    async def _hide_snapshot_overlays(self, page: Page) -> None:
        """Temporarily hide fixed bottom action bars that obscure full-page screenshots."""
        await page.evaluate(
            """() => {
              const controls = Array.from(document.querySelectorAll('button, a, input, [role="button"]'));
              const reserveControls = controls.filter((el) => {
                const text = (el.innerText || el.textContent || el.value || '').trim();
                return /^reserve$/i.test(text);
              });

              for (const control of reserveControls) {
                let node = control;
                for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                  const style = window.getComputedStyle(node);
                  const rect = node.getBoundingClientRect();
                  const fixedLike = style.position === 'fixed' || style.position === 'sticky';
                  const nearViewportBottom = rect.bottom >= window.innerHeight - 160;
                  const overlaySized = rect.height <= Math.max(180, window.innerHeight * 0.35);
                  if (fixedLike && nearViewportBottom && overlaySized) {
                    if (!node.dataset.hutHunterSnapshotHidden) {
                      node.dataset.hutHunterSnapshotHidden = 'true';
                      node.dataset.hutHunterSnapshotVisibility = node.style.visibility || '';
                      node.style.visibility = 'hidden';
                    }
                    break;
                  }
                }
              }
            }"""
        )

    async def _restore_snapshot_overlays(self, page: Page) -> None:
        await page.evaluate(
            """() => {
              for (const node of document.querySelectorAll('[data-hut-hunter-snapshot-hidden="true"]')) {
                node.style.visibility = node.dataset.hutHunterSnapshotVisibility || '';
                delete node.dataset.hutHunterSnapshotHidden;
                delete node.dataset.hutHunterSnapshotVisibility;
              }
            }"""
        )

    async def snapshot(self, page: Page, label: str, *, include_html: bool | None = None) -> str:
        """Save a compressed screenshot and optional HTML for debugging."""
        out_dir = settings.artifacts_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{ts}_{self.adapter_id}_{label}"
        absolute_base = out_dir / filename
        relative_base = Path("artifacts") / filename
        try:
            await self._hide_snapshot_overlays(page)
            await page.screenshot(
                path=str(absolute_base.with_suffix(".jpg")),
                type="jpeg",
                quality=65,
                full_page=True,
            )
        finally:
            try:
                await self._restore_snapshot_overlays(page)
            except Exception:
                pass
        should_include_html = (
            include_html
            if include_html is not None
            else self._snapshot_should_include_html(label)
        )
        if should_include_html:
            with open(absolute_base.with_suffix(".html"), "w") as f:
                f.write(await page.content())
        base = str(relative_base)
        self._artifact_log.append(ArtifactSnapshot(label=label, base=base))
        return base

    def consume_artifacts(self) -> list[ArtifactSnapshot]:
        artifacts = self._artifact_log[:]
        self._artifact_log.clear()
        return artifacts

    def set_login_credentials(
        self,
        credentials: AdapterCredentialSecret | None,
    ) -> None:
        self._login_credentials = credentials
