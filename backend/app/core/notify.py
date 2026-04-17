import logging
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


async def notify_gotify(title: str, message: str, priority: int = 5) -> None:
    if not settings.gotify_url or not settings.gotify_token:
        logger.debug("Gotify not configured, skipping notification")
        return

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.gotify_url}/message",
                params={"token": settings.gotify_token},
                json={"title": title, "message": message, "priority": priority},
                timeout=10.0,
            )
            response.raise_for_status()
            logger.info(f"Gotify notification sent: {title}")
    except httpx.HTTPError as e:
        logger.error(f"Gotify notification failed: {e}")