from app.core.notify import dispatch_notification_targets, format_notification_links
from app.models.notification import UserNotificationSettingsSecret

# NB: no module-level asyncio mark — the suite runs with asyncio_mode=auto
# (pytest.ini), so async tests are detected automatically and the sync
# format_notification_links tests below stay sync.


def test_format_notification_links_includes_both_links():
    # THR-130: both the booking-site link and the Hut Hunter hunt link.
    footer = format_notification_links(
        booking_url="https://reservation.pc.gc.ca/create-booking/results?x=1",
        hunt_url="https://app.example.com/#/jobs/abc123",
    )
    assert "Booking site: https://reservation.pc.gc.ca/create-booking/results?x=1" in footer
    assert "Open in Hut Hunter: https://app.example.com/#/jobs/abc123" in footer
    # Rendered as a trailing block, separated from the message body.
    assert footer.startswith("\n\n")


def test_format_notification_links_omits_missing_booking_url():
    footer = format_notification_links(
        booking_url=None,
        hunt_url="https://app.example.com/#/jobs/abc123",
    )
    assert "Booking site:" not in footer
    assert "Open in Hut Hunter: https://app.example.com/#/jobs/abc123" in footer


def test_format_notification_links_empty_when_no_links():
    assert format_notification_links(booking_url=None, hunt_url=None) == ""


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
