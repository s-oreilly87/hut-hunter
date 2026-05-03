import asyncio
import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.core.config import settings
from app.models.notification import UserNotificationSettingsSecret

logger = logging.getLogger(__name__)


def _smtp_from_header() -> str:
    if settings.smtp_from_name:
        return f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    return settings.smtp_from_email


def _send_email_sync(message: EmailMessage) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP host is not configured.")

    smtp_cls = smtplib.SMTP_SSL if settings.smtp_use_ssl else smtplib.SMTP
    with smtp_cls(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.ehlo()
        if settings.smtp_use_starttls:
            smtp.starttls()
            smtp.ehlo()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


async def send_email(recipient: str, title: str, message: str) -> None:
    if not settings.smtp_host:
        logger.warning(
            "SMTP not configured, skipping email notification to %s",
            recipient,
        )
        return

    try:
        email = EmailMessage()
        email["Subject"] = title
        email["From"] = _smtp_from_header()
        email["To"] = recipient
        email.set_content(message)
        await asyncio.to_thread(_send_email_sync, email)
        logger.info("Email notification sent: %s", title)
    except Exception as exc:
        logger.error("Email notification failed: %s", exc, exc_info=True)


async def notify_gotify(
    gotify_url: str,
    gotify_token: str,
    title: str,
    message: str,
    priority: int = 5,
) -> None:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{gotify_url.rstrip('/')}/message",
                params={"token": gotify_token},
                json={"title": title, "message": message, "priority": priority},
                timeout=10.0,
            )
            response.raise_for_status()
            logger.info("Gotify notification sent: %s", title)
    except httpx.HTTPError as exc:
        logger.error("Gotify notification failed: %s", exc, exc_info=True)


async def dispatch_notification_targets(
    settings_secret: UserNotificationSettingsSecret,
    *,
    title: str,
    message: str,
    priority: int = 5,
) -> None:
    deliveries = []

    if settings_secret.email_enabled and settings_secret.email_address:
        deliveries.append(
            send_email(
                settings_secret.email_address,
                title,
                message,
            )
        )

    if (
        settings_secret.gotify_enabled
        and settings_secret.gotify_url
        and settings_secret.gotify_token
    ):
        deliveries.append(
            notify_gotify(
                settings_secret.gotify_url,
                settings_secret.gotify_token,
                title,
                message,
                priority=priority,
            )
        )

    if not deliveries:
        logger.info("No enabled notification channels; skipping notification")
        return

    await asyncio.gather(*deliveries)
