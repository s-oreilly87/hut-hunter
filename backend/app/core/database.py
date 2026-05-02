from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings

# The engine is the connection pool to Postgres
engine = create_async_engine(
    settings.database_url,
    echo=settings.environment == "development",  # logs SQL in dev
    future=True,
)

# Session factory — each request gets its own session
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def verify_db_connection() -> None:
    """Verify the database is reachable after migrations have run."""
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields a DB session per request."""
    async with AsyncSessionLocal() as session:
        yield session
