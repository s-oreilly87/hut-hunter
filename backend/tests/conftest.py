import json
import os
import sys
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://hut_hunter:hut_hunter@localhost/hut_hunter_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault(
    "ENCRYPTION_KEY",
    "Y8b6j0bJm0Kh3k6oQ1dQ3pbyQYQ5G3g8Jx9Vb0O8kKo=",
)

from app.api import routes
from app.core.crypto import encrypt
from app.models.job import JobStatus, WatchJob, utcnow
from app.models.session import CartSession
from app.models.user import AppUser
from app.main import app
import app.core.database as database


class FakeRedis:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.return_values: list[Any] = []

    async def enqueue_job(self, job_name: str, *args: Any, **kwargs: Any) -> Any:
        self.calls.append(
            {
                "job_name": job_name,
                "args": list(args),
                "kwargs": kwargs,
            }
        )
        if self.return_values:
            return self.return_values.pop(0)
        return {"job_name": job_name}


@dataclass
class TestContext:
    app: Any
    redis: FakeRedis
    session_factory: async_sessionmaker[AsyncSession]


@pytest_asyncio.fixture
async def test_context(tmp_path, monkeypatch) -> TestContext:
    db_path = tmp_path / "test.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        future=True,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    fake_redis = FakeRedis()

    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)

    async def override_get_redis() -> FakeRedis:
        return fake_redis

    app.dependency_overrides[routes.get_redis] = override_get_redis

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    try:
        yield TestContext(app=app, redis=fake_redis, session_factory=session_factory)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest_asyncio.fixture
async def anonymous_client(test_context: TestContext) -> AsyncClient:
    async with LifespanManager(test_context.app):
        transport = ASGITransport(app=test_context.app)
        async with AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as async_client:
            yield async_client


@pytest_asyncio.fixture
async def client(anonymous_client: AsyncClient) -> AsyncClient:
    response = await anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@example.com",
            "password": "password123",
        },
    )
    assert response.status_code == 201
    return anonymous_client


@pytest.fixture
def fake_redis(test_context: TestContext) -> FakeRedis:
    return test_context.redis


@pytest.fixture
def session_factory(
    test_context: TestContext,
) -> async_sessionmaker[AsyncSession]:
    return test_context.session_factory


@pytest_asyncio.fixture
async def auth_user(session_factory, client) -> AppUser:
    async with session_factory() as session:
        result = await session.execute(
            select(AppUser).where(AppUser.email == "owner@example.com")
        )
        return result.scalars().one()


@pytest.fixture
def make_job_params():
    def _make_job_params(**overrides: Any) -> dict[str, Any]:
        params = {
            "track": "Routeburn Track",
            "date": "01/01/2099",
            "nights": 1,
            "people": "2",
            "occupants": [
                {
                    "first_name": "Alex",
                    "last_name": "Walker",
                    "category": "NZ Adult (18+)",
                    "country": "New Zealand",
                    "age": 32,
                    "gender": "Male",
                }
            ],
            "direction": "Routeburn Shelter – The Divide",
            "sites": "",
        }
        params.update(overrides)
        return params

    return _make_job_params


@pytest.fixture
def make_job_payload(make_job_params):
    def _make_job_payload(**overrides: Any) -> dict[str, Any]:
        payload = {
            "name": "Routeburn Watch",
            "adapter_id": "doc_great_walk",
            "params": make_job_params(),
            "auto_book": False,
            "enable_monitoring": True,
            "interval_minutes": 15,
        }
        payload.update(overrides)
        return payload

    return _make_job_payload


@pytest.fixture
def seed_job(session_factory, make_job_params, auth_user):
    async def _seed_job(
        *,
        user_id: str | None = None,
        name: str = "Seeded Job",
        adapter_id: str = "doc_great_walk",
        params: dict[str, Any] | None = None,
        status: str = JobStatus.PAUSED.value,
        auto_book: bool = False,
        enable_monitoring: bool = False,
        interval_minutes: int = 15,
        next_check_at=None,
        last_checked_at=None,
        last_result: list[dict[str, Any]] | dict[str, Any] | None = None,
        last_artifact: str | None = None,
        artifact_history: list[dict[str, Any]] | None = None,
    ) -> WatchJob:
        job = WatchJob(
            user_id=user_id or auth_user.id,
            name=name,
            adapter_id=adapter_id,
            params=json.dumps(params or make_job_params()),
            status=status,
            auto_book=auto_book,
            enable_monitoring=enable_monitoring,
            interval_minutes=interval_minutes,
            next_check_at=next_check_at,
            last_checked_at=last_checked_at,
            last_result=json.dumps(last_result) if last_result is not None else None,
            last_artifact=last_artifact,
            artifact_history=(
                json.dumps(artifact_history) if artifact_history is not None else None
            ),
        )
        async with session_factory() as session:
            session.add(job)
            await session.commit()
            await session.refresh(job)
            return job

    return _seed_job


@pytest.fixture
def seed_cart(session_factory):
    async def _seed_cart(
        job_id: str,
        *,
        cart_url: str = "https://bookings.doc.govt.nz/cart/123",
        cookies: list[dict[str, Any]] | None = None,
        expires_at=None,
        completed_at=None,
    ) -> CartSession:
        cookie_state = cookies or [
            {
                "name": "doc_session",
                "value": "abc123",
                "domain": "bookings.doc.govt.nz",
                "path": "/",
            }
        ]
        cart = CartSession(
            job_id=job_id,
            encrypted_cookies=encrypt(json.dumps(cookie_state)),
            cart_url=cart_url,
            expires_at=expires_at or (utcnow() + timedelta(minutes=25)),
            completed_at=completed_at,
        )
        async with session_factory() as session:
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            return cart

    return _seed_cart


@pytest.fixture
def fetch_job(session_factory):
    async def _fetch_job(job_id: str) -> WatchJob | None:
        async with session_factory() as session:
            return await session.get(WatchJob, job_id)

    return _fetch_job


@pytest.fixture
def fetch_latest_cart(session_factory):
    async def _fetch_latest_cart(job_id: str) -> CartSession | None:
        async with session_factory() as session:
            result = await session.execute(
                select(CartSession)
                .where(CartSession.job_id == job_id)
                .order_by(CartSession.created_at.desc())
            )
            return result.scalars().first()

    return _fetch_latest_cart


@pytest.fixture
def list_carts(session_factory):
    async def _list_carts(job_id: str) -> list[CartSession]:
        async with session_factory() as session:
            result = await session.execute(
                select(CartSession).where(CartSession.job_id == job_id)
            )
            return list(result.scalars().all())

    return _list_carts
