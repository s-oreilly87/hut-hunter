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
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


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


@dataclass
class ArtifactSnapshot:
    label: str
    base: str


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
