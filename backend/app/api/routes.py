"""API router — combines sub-routers into the two routers main.py mounts.

Route modules:
  _route_jobs.py          — job CRUD, trigger, book
  _route_hold.py          — hold completion, pay page, cart resume
  _route_occupants.py     — occupant CRUD
  _route_credentials.py   — booking credentials
  _route_notifications.py — notification settings
  _route_deps.py          — shared deps, helpers, validation
"""

from fastapi import APIRouter

from app.adapters import list_adapters
from app.api._route_deps import MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, get_redis
from app.api._route_jobs import router as _jobs
from app.api._route_hold import router as _hold, public_router as _hold_public
from app.api._route_occupants import router as _occupants
from app.api._route_credentials import router as _credentials
from app.api._route_notifications import router as _notifications

router = APIRouter(prefix="/api/v1", tags=["api"])
public_router = APIRouter(tags=["public"])

router.include_router(_jobs)
router.include_router(_hold)
router.include_router(_occupants)
router.include_router(_credentials)
router.include_router(_notifications)

public_router.include_router(_hold_public)


@router.get("/adapters")
async def get_adapters():
    return list_adapters()
