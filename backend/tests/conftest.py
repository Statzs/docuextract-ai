import os
import tempfile
from pathlib import Path

# Must be set before the app (and its settings/engine) is imported.
_tmp = tempfile.mkdtemp()
os.environ.update(
    ENVIRONMENT="test",
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{Path(_tmp) / 'test.db'}",
    EXTRACTION_BACKOFF_SECONDS="0",
    GEMINI_API_KEY="",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

SAMPLES = Path(__file__).resolve().parent.parent / "app" / "demo" / "samples"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


def make_client(email="ada@example.com", name="Ada") -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/register", json={"email": email, "name": name, "password": "s3cret-pass"})
    assert r.status_code == 201, r.text
    return c


@pytest.fixture
def client() -> TestClient:
    return make_client()


@pytest.fixture
def other_client() -> TestClient:
    return make_client("mallory@example.com", "Mallory")


def schema_id(c: TestClient, name="Invoice") -> str:
    return next(s["id"] for s in c.get("/api/schemas").json() if s["name"] == name)


def upload(c: TestClient, filename="invoice-halden-roe-0142.pdf", schema="Invoice", data=None):
    data = data if data is not None else (SAMPLES / filename).read_bytes()
    return c.post(
        "/api/documents",
        files={"file": (filename, data, "application/pdf")},
        data={"schema_id": schema_id(c, schema)},
    )
