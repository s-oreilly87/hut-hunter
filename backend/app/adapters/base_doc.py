"""Shared DOC booking logic used by both DOC adapter families.

``BaseDOCAdapter`` sits between ``BaseAdapter`` and the concrete adapters
(``DocGreatWalkAdapter``, ``DocStandardHutAdapter``).  It owns all Playwright
helpers that are identical — or near-identical — across the two DOC booking
sites: login handling, occupant-form filling, shopping-cart checkout, and
cart-session persistence.  Site-specific scraping, form navigation, and
availability detection stay in the concrete subclasses.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, time, timedelta

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from app.adapters.base import (
    BaseAdapter,
    BookingResult,
    CredentialVerificationResult,
    VerificationStatus,
)
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.job import utcnow


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module-level constants shared by both DOC adapters
# ---------------------------------------------------------------------------

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

PEOPLE_OPTIONS = [str(i) for i in range(1, 26)]  # "1" … "25"


class BaseDOCAdapter(BaseAdapter):
    """Intermediate base for all DOC booking site adapters.

    Provides:
    - NZ timezone / cutoff defaults
    - ``_click_with_fallback`` — reliable click with force fallback
    - ``_select_dropdown_option`` — click a DOC listbox button then pick option
    - ``_login_if_prompted`` — detect and dismiss the DOC credentials modal
    - ``_fill_occupants`` — fill the shared #FirstName_N / #LastName_N form
    - ``_check_terms`` — tick the T&Cs checkbox on the Shopping Cart page
    - ``_proceed_to_checkout`` — click Checkout and wait for CreditCardPayment
    - ``_persist_cart_session`` — encrypt cookies and store CartSession in DB
    """

    booking_timezone: str = "Pacific/Auckland"
    booking_cutoff_time: time = time(20, 0)  # 8 pm NZ time
    cart_hold_minutes: int = 25
    cart_inactive_after_minutes: int = 15
    cart_keepalive_interval_minutes: int = 5
    requires_credentials: bool = True

    # ------------------------------------------------------------------
    # Low-level Playwright helpers
    # ------------------------------------------------------------------

    async def _click_with_fallback(self, locator) -> None:
        """Click ``locator`` with a short timeout; retry with force if needed."""
        try:
            await locator.click(timeout=1500)
        except PlaywrightTimeoutError:
            await locator.click(timeout=8000, force=True)

    async def _select_dropdown_option(
        self, page: Page, btn_selector: str, option_text: str
    ) -> None:
        """Open a DOC custom listbox and pick the matching option."""
        await page.locator(btn_selector).click()
        await page.get_by_role("option").filter(has_text=option_text).first.click()

    # ------------------------------------------------------------------
    # DOC login modal
    # ------------------------------------------------------------------

    async def _login_if_prompted(
        self, page: Page, timeout_ms: int = 10_000
    ) -> bool:
        """If the DOC login modal appears, fill bound credentials and sign in.

        Returns ``True`` if a login was performed, ``False`` if no modal was
        visible.  Raises ``RuntimeError`` if credentials are missing or login
        fails.
        """
        try:
            # Prefer the explicit id; fall back to any aria-modal that
            # contains the email field (covers both booking sites).
            modal = page.locator("#loginPopup").first
            if await modal.count() == 0:
                modal = page.locator("[aria-modal='true']").filter(
                    has=page.locator('input[placeholder="Insert Your email"]')
                ).first
            await modal.wait_for(state="visible", timeout=timeout_ms)
        except PlaywrightTimeoutError:
            return False

        logger.info("DOC login modal detected — filling stored user credentials")

        credentials = self._login_credentials
        if credentials is None:
            raise RuntimeError(
                "DOC login modal appeared but no stored credentials are configured for this adapter"
            )

        await page.locator('input[placeholder="Insert Your email"]').fill(
            credentials.username
        )
        await page.locator('input[placeholder="Insert Your password"]').fill(
            credentials.password
        )
        await page.get_by_role("button", name="Sign In").click()

        try:
            await modal.wait_for(state="hidden", timeout=15_000)
            logger.info("DOC login successful")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "login_failed")
            raise RuntimeError(
                "DOC login modal did not close — check the stored username/password"
            )

        # Give the page time to process the authentication and settle before
        # the next selector lookup — the first hold attempt after a cold
        # session would fail without this grace period.
        await page.wait_for_load_state("networkidle", timeout=15_000)

        return True

    def _login_check_url(self) -> str:
        """URL to navigate to for verify_credentials.

        Defaults to base_url, which works for adapters like
        DocGreatWalkAdapter where it's a plain URL. Adapters whose base_url
        is a per-site template (e.g. DocStandardHutAdapter's
        {park_id}/{facility_id}) override this with a park-agnostic landing
        page — the top-nav login button is global, not park-specific.
        """
        return self.base_url

    async def verify_credentials(self, page: Page) -> CredentialVerificationResult:
        """Drive just the sign-in steps to check the bound credentials.

        THR-123: unlike Camis, the DOC login modal doesn't sit behind a
        standalone /login page — it's normally reached mid-funnel after
        selecting real nights and clicking Reserve. But the top-nav
        "#login-btn" opens the same modal directly, so this drives that
        instead of faking a booking attempt (which would carry live-site
        side effects and depend on availability existing).
        """
        credentials = self._login_credentials
        if credentials is None:
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, "No stored credentials to verify"
            )

        try:
            await page.goto(self._login_check_url(), wait_until="domcontentloaded", timeout=60_000)
            await page.locator("#login-btn").click()
        except Exception as e:
            await self.snapshot(page, "doc_verify_inconclusive")
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, f"Could not open the login form: {e}"
            )

        try:
            logged_in = await self._login_if_prompted(page)
        except RuntimeError as e:
            await self.snapshot(page, "doc_verify_failed")
            return CredentialVerificationResult(VerificationStatus.FAILED, str(e))
        except Exception as e:
            await self.snapshot(page, "doc_verify_inconclusive")
            return CredentialVerificationResult(
                VerificationStatus.INCONCLUSIVE, f"Verification could not complete: {e}"
            )

        if logged_in:
            return CredentialVerificationResult(VerificationStatus.VERIFIED, "Signed in successfully")
        return CredentialVerificationResult(
            VerificationStatus.INCONCLUSIVE, "Login modal did not appear after clicking Log In"
        )

    # ------------------------------------------------------------------
    # Occupant details form (shared selector pattern across both sites)
    # ------------------------------------------------------------------

    async def _fill_occupants(self, page: Page, occupants: list[dict]) -> None:
        """Fill the Occupant Details form (#FirstName_N, #LastName_N, etc.).

        Handles the shared DOC ``#great-walk-occupant-*`` dropdown set used
        by both the Great Walk and Standard Hut booking flows.  Per-field
        values are skipped when absent so the caller doesn't need to scrub
        the occupant dicts beforehand.
        """
        for i, occ in enumerate(occupants):
            await page.locator(f"#FirstName_{i}").fill(occ.get("first_name", ""))
            await page.locator(f"#LastName_{i}").fill(occ.get("last_name", ""))
            await page.locator(f"#Age_{i}").fill(str(occ.get("age", "")))

            for field_key, btn_id in (
                ("category", f"#great-walk-occupant-category_{i}-dropdown-button"),
                ("country",  f"#great-walk-occupant-country_{i}-dropdown-button"),
                ("gender",   f"#great-walk-occupant-gender_{i}-dropdown-button"),
            ):
                value = occ.get(field_key)
                if not value:
                    continue
                await self._select_dropdown_option(page, btn_id, value)
                await page.wait_for_timeout(300)

            logger.info(
                "Filled occupant %d: %s %s",
                i, occ.get("first_name"), occ.get("last_name"),
            )

    # ------------------------------------------------------------------
    # Shopping Cart → CreditCardPayment
    # ------------------------------------------------------------------

    async def _check_terms(self, page: Page) -> None:
        """Tick the T&Cs checkbox on the Shopping Cart page."""
        await page.locator("#mainContent_chkAgree").check()
        logger.info("Checked T&Cs agreement")
        await page.wait_for_timeout(300)

    async def _proceed_to_checkout(self, page: Page) -> str | None:
        """Click Checkout and wait for the CreditCardPayment page.

        Returns the payment page URL on success, or ``None`` on failure (after
        taking a snapshot).
        """
        try:
            checkout_btn = page.locator("#mainContent_bCheckOut")
            await checkout_btn.wait_for(state="visible", timeout=10_000)
            await self.snapshot(page, "shopping_cart")
            await checkout_btn.click()
            logger.info("Clicked To Checkout")
        except PlaywrightTimeoutError:
            await self.snapshot(page, "checkout_timeout")
            return None

        try:
            await page.wait_for_url("**/CreditCardPayment**", timeout=15_000)
            cart_url = page.url
            logger.info(f"Reached payment page: {cart_url}")
            return cart_url
        except PlaywrightTimeoutError:
            await self.snapshot(page, "payment_page_timeout")
            return None

    # ------------------------------------------------------------------
    # Cart session persistence
    # ------------------------------------------------------------------

    async def _persist_cart_session(
        self, page: Page, job_id: str, cart_url: str
    ) -> str:
        """Encrypt the current browser cookies and store a CartSession row.

        Deletes any prior cart for ``job_id`` first (keeping only the newest).
        Returns the ``/pay/{job_id}`` URL to surface to the user.
        """
        from app.core.crypto import encrypt
        from app.models.session import CartSession
        from sqlalchemy import delete

        hold_duration_minutes = self.cart_hold_minutes or 25
        hold_expires_at = utcnow() + timedelta(minutes=hold_duration_minutes)
        cookies = await page.context.cookies()
        cart_session = CartSession(
            job_id=job_id,
            encrypted_cookies=encrypt(json.dumps(cookies)),
            cart_url=cart_url,
            expires_at=hold_expires_at,
        )
        async with AsyncSessionLocal() as db_session:
            # Remove any prior carts for this job — the new one supersedes them
            # and keeping only one keeps resume_cart's lookup unambiguous.
            await db_session.execute(
                delete(CartSession).where(CartSession.job_id == job_id)
            )
            db_session.add(cart_session)
            await db_session.commit()

        return f"{settings.app_url}/pay/{job_id}"

    # ------------------------------------------------------------------
    # Date helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_date_string(date_str: str) -> tuple[int, int, int]:
        """Parse ``"DD/MM/YYYY"`` → ``(day, month, year)`` as integers."""
        dd, mm, yyyy = date_str.split("/")
        return int(dd), int(mm), int(yyyy)

    @staticmethod
    def _generate_night_dates(date_str: str, nights: int) -> list[str]:
        """Return a list of ``"DD/MM/YYYY"`` strings for each night of a stay."""
        start = datetime.strptime(date_str, "%d/%m/%Y")
        return [
            (start + timedelta(days=i)).strftime("%d/%m/%Y")
            for i in range(nights)
        ]

    # ------------------------------------------------------------------
    # Reservation Details snapshot
    # ------------------------------------------------------------------

    async def _snapshot_reservation_details(self, page: Page) -> None:
        """Open the View Occupants modal for a richer Reservation Details snapshot,
        then close it. Best-effort — failures are non-fatal and fall back to a
        plain page snapshot."""
        try:
            view_occ_btn = page.locator("#aViewOccupant")
            if await view_occ_btn.count() > 0:
                await view_occ_btn.click()
                logger.info("Opened View Occupants modal on Reservation Details page")
                await page.locator("#myModal_occu").wait_for(state="visible", timeout=6_000)
                await page.wait_for_timeout(300)
                await self.snapshot(page, "reservation_details")
                await page.locator("#myModal_occu .close").first.click()
                await page.locator("#myModal_occu").wait_for(state="hidden", timeout=8_000)
            else:
                await self.snapshot(page, "reservation_details")
        except Exception as modal_err:
            logger.warning(f"View Occupants modal snapshot failed (non-fatal): {modal_err}")
            try:
                await self.snapshot(page, "reservation_details")
            except Exception:
                pass
