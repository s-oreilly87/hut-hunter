from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from playwright.async_api import Page

import os
from datetime import datetime, time

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

    def __init__(self) -> None:
        self._artifact_log: list[ArtifactSnapshot] = []

    @classmethod
    @abstractmethod
    def param_fields(cls) -> list[ParamField]:
        """Define the params schema — used by the frontend to render the config form."""
        ...

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

    async def snapshot(self, page: Page, label: str) -> str:
        """Save screenshot + HTML for debugging."""
        out_dir = settings.artifacts_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{ts}_{self.adapter_id}_{label}"
        absolute_base = out_dir / filename
        relative_base = Path("artifacts") / filename
        await page.screenshot(path=str(absolute_base.with_suffix(".png")), full_page=True)
        with open(absolute_base.with_suffix(".html"), "w") as f:
            f.write(await page.content())
        base = str(relative_base)
        self._artifact_log.append(ArtifactSnapshot(label=label, base=base))
        return base

    def consume_artifacts(self) -> list[ArtifactSnapshot]:
        artifacts = self._artifact_log[:]
        self._artifact_log.clear()
        return artifacts
