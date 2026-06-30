"""Test configuration: in-memory SQLite, test client, auth fixtures."""

# ruff: noqa: E402

import os
import sys
from pathlib import Path

import pytest

# Set test environment BEFORE any app imports
os.environ.setdefault("DATABASE_PATH", ":memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("FRONTEND_DIR", "/tmp/nonexistent-frontend")

sys.path.insert(0, str(Path(__file__).parent.parent))


import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import Base, async_session, engine
from app.main import app


def pytest_ignore_collect(collection_path, config):
    run_e2e = os.getenv("RUN_E2E", "").lower() in {"1", "true", "yes", "on"}
    if run_e2e:
        return False
    path = Path(str(collection_path))
    return "e2e" in path.parts or path.name.endswith("_e2e.py")


def pytest_collection_modifyitems(items):
    run_e2e = os.getenv("RUN_E2E", "").lower() in {"1", "true", "yes", "on"}
    if run_e2e:
        return
    skip_e2e = pytest.mark.skip(reason="E2E tests require a running app; set RUN_E2E=1 to run")
    for item in items:
        path = Path(str(getattr(item, "path", getattr(item, "fspath", ""))))
        if "e2e" in path.parts or path.name.endswith("_e2e.py"):
            item.add_marker(skip_e2e)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test, drop after."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db():
    """Provide a clean DB session."""
    async with async_session() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    """Provide async test client (lifespan not triggered)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------
from app.auth import create_access_token, hash_password
from app.models import IntentLevel, Student, StudentStage, StudentStatus, User


@pytest_asyncio.fixture
async def admin_user(db):
    user = User(
        username="testadmin",
        hashed_password=hash_password("admin123"),
        role="admin",
        name="测试管理员",
        is_active=True,
        is_super_admin=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def normal_admin_user(db):
    user = User(
        username="normaladmin",
        hashed_password=hash_password("admin123"),
        role="admin",
        name="普通管理员",
        is_active=True,
        is_super_admin=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def agent_user(db):
    user = User(
        username="testagent",
        hashed_password=hash_password("agent123"),
        role="agent",
        name="测试坐席",
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_token(admin_user):
    return create_access_token(
        {
            "sub": str(admin_user.id),
            "role": admin_user.role,
            "tv": admin_user.token_version,
        }
    )


@pytest_asyncio.fixture
async def normal_admin_token(normal_admin_user):
    return create_access_token(
        {
            "sub": str(normal_admin_user.id),
            "role": normal_admin_user.role,
            "tv": normal_admin_user.token_version,
        }
    )


@pytest_asyncio.fixture
async def agent_token(agent_user):
    return create_access_token(
        {
            "sub": str(agent_user.id),
            "role": agent_user.role,
            "tv": agent_user.token_version,
        }
    )


@pytest_asyncio.fixture
async def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest_asyncio.fixture
async def normal_admin_headers(normal_admin_token):
    return {"Authorization": f"Bearer {normal_admin_token}"}


@pytest_asyncio.fixture
async def agent_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}"}


@pytest_asyncio.fixture
async def sample_student(db):
    student = Student(
        name="张三",
        region="思明区",
        stage=StudentStage.initial_contact,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.none,
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return student
