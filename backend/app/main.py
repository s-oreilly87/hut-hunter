import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import init_db
from app.models import job, session, occupant  # noqa — imported for SQLModel table registration
from app.api.routes import router, public_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Runs on startup and shutdown."""
    await init_db()
    yield
    # anything after yield runs on shutdown

app = FastAPI(
    title="Hut Hunter",
    description="Automated availability tracker for NZ DOC bookings",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router)
app.include_router(public_router)

# Serve debug snapshots + booking receipts captured by workers. The dir matches
# the one used by BaseAdapter.snapshot (cwd-relative "artifacts/"). We create
# it on boot so StaticFiles.check_dir doesn't choke on a fresh checkout.
_ARTIFACTS_DIR = os.path.abspath("artifacts")
os.makedirs(_ARTIFACTS_DIR, exist_ok=True)
app.mount(
    "/artifacts",
    StaticFiles(directory=_ARTIFACTS_DIR),
    name="artifacts",
)

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "environment": settings.environment,
    }