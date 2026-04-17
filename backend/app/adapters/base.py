from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from playwright.async_api import Page

import os
from datetime import datetime

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
class ParamField:
    key: str
    label: str
    type: str          # "text" | "date" | "number" | "select"
    options: list[str] | None = None
    default: Any = None
    required: bool = True


class BaseAdapter(ABC):
    adapter_id: str
    name: str
    base_url: str

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

    async def get_storage_state(self, db_session) -> dict | None:
        """Load decrypted storageState from DB for this adapter."""
        from sqlmodel import select
        from app.models.session import AdapterSession
        from app.core.crypto import decrypt
        import json

        result = await db_session.execute(
            select(AdapterSession).where(AdapterSession.adapter_id == self.adapter_id)
        )
        adapter_session = result.scalar_one_or_none()
        if not adapter_session:
            return None
        return json.loads(decrypt(adapter_session.encrypted_state))

    async def snapshot(self, page: Page, label: str) -> str:
        """Save screenshot + HTML for debugging."""
        out_dir = "artifacts"
        os.makedirs(out_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = f"{out_dir}/{ts}_{self.adapter_id}_{label}"
        await page.screenshot(path=f"{base}.png", full_page=True)
        with open(f"{base}.html", "w") as f:
            f.write(await page.content())
        return base