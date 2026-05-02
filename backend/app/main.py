import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import verify_db_connection
from app.models import job, session, occupant  # noqa — imported for SQLModel table registration
from app.api.routes import router, public_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Runs on startup and shutdown."""
    await verify_db_connection()
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

_ARTIFACTS_DIR = settings.artifacts_dir
os.makedirs(_ARTIFACTS_DIR, exist_ok=True)
app.mount(
    "/artifacts",
    StaticFiles(directory=str(_ARTIFACTS_DIR)),
    name="artifacts",
)

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "environment": settings.environment,
    }
