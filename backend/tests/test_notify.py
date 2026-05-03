import pytest

from app.core.notify import dispatch_notification_targets
from app.models.notification import UserNotificationSettingsSecret


pytestmark = pytest.mark.asyncio


async def test_dispatch_notification_targets_fans_out_enabled_channels(monkeypatch):
    deliveries: list[tuple[str, str]] = []

    async def fake_send_email(recipient: str, title: str, message: str) -> None:
        deliveries.append(("email", recipient))

    async def fake_notify_gotify(
        gotify_url: str,
        gotify_token: str,
        title: str,
        message: str,
        priority: int = 5,
    ) -> None:
        deliveries.append(("gotify", gotify_url))

    monkeypatch.setattr("app.core.notify.send_email", fake_send_email)
    monkeypatch.setattr("app.core.notify.notify_gotify", fake_notify_gotify)

    await dispatch_notification_targets(
        UserNotificationSettingsSecret(
            email_enabled=True,
            email_address="alerts@example.com",
            gotify_enabled=True,
            gotify_url="https://gotify.example.com",
            gotify_token="secret-token",
        ),
        title="Test",
        message="Body",
        priority=9,
    )

    assert deliveries == [
        ("email", "alerts@example.com"),
        ("gotify", "https://gotify.example.com"),
    ]


async def test_dispatch_notification_targets_skips_disabled_channels(monkeypatch):
    deliveries: list[str] = []

    async def fake_send_email(recipient: str, title: str, message: str) -> None:
        deliveries.append("email")

    async def fake_notify_gotify(
        gotify_url: str,
        gotify_token: str,
        title: str,
        message: str,
        priority: int = 5,
    ) -> None:
        deliveries.append("gotify")

    monkeypatch.setattr("app.core.notify.send_email", fake_send_email)
    monkeypatch.setattr("app.core.notify.notify_gotify", fake_notify_gotify)

    await dispatch_notification_targets(
        UserNotificationSettingsSecret(
            email_enabled=False,
            email_address="alerts@example.com",
            gotify_enabled=True,
            gotify_url="https://gotify.example.com",
            gotify_token=None,
        ),
        title="Test",
        message="Body",
    )

    assert deliveries == []
