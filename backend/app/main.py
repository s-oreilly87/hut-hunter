from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.core.config import settings
from app.core.database import init_db
from app.models import job, session  # noqa — imported for SQLModel table registration
from app.api.routes import router


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

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "environment": settings.environment,
    }