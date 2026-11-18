"""Password reset, session revocation, AI cost quota and the atomic job claim."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import DocStatus, Document, PasswordResetToken, UsageEvent, User, utcnow
from app.services.processing import process_document
from tests.conftest import upload


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "app.routers.auth.send_email", lambda to, subject, body: sent.append((to, body))
    )
    return sent


def _token_from(body: str) -> str:
    return body.split("token=")[1].split()[0]


def test_password_reset_flow_revokes_old_sessions(client, outbox):
    r = TestClient(app).post("/api/auth/forgot-password", json={"email": "ADA@example.com"})
    assert r.status_code == 202
    assert len(outbox) == 1 and outbox[0][0] == "ada@example.com"
    token = _token_from(outbox[0][1])
    with SessionLocal() as db:  # only the hash is stored
        assert db.query(PasswordResetToken).one().token_hash != token

    anon = TestClient(app)
    assert (
        anon.post(
            "/api/auth/reset-password", json={"token": token, "password": "short"}
        ).status_code
        == 422
    )
    assert (
        anon.post(
            "/api/auth/reset-password", json={"token": token, "password": "brand-new-pass"}
        ).status_code
        == 204
    )
    # Single use.
    assert (
        anon.post(
            "/api/auth/reset-password", json={"token": token, "password": "another-pass1"}
        ).status_code
        == 400
    )
    # The session issued before the reset no longer works.
    assert client.get("/api/auth/me").status_code == 401
    login = anon.post(
        "/api/auth/login", json={"email": "ada@example.com", "password": "s3cret-pass"}
    )
    assert login.status_code == 401
    login = anon.post(
        "/api/auth/login", json={"email": "ada@example.com", "password": "brand-new-pass"}
    )
    assert login.status_code == 200


def test_forgot_password_does_not_reveal_accounts(client, outbox):
    known = TestClient(app).post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    unknown = TestClient(app).post(
        "/api/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(outbox) == 1


def test_expired_or_bogus_reset_tokens_are_rejected(client, outbox):
    TestClient(app).post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    token = _token_from(outbox[0][1])
    with SessionLocal() as db:
        db.query(PasswordResetToken).one().expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    for t in (token, "x" * 43):
        r = TestClient(app).post(
            "/api/auth/reset-password", json={"token": t, "password": "brand-new-pass"}
        )
        assert r.status_code == 400


def test_ai_quota_blocks_uploads_in_gemini_mode(client, other_client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", "test-key")
    monkeypatch.setattr(s, "ai_daily_limit_per_user", 2)
    monkeypatch.setattr(s, "ai_daily_limit_global", 3)
    # Keep the background job from calling the real API.
    monkeypatch.setattr("app.routers.documents.process_document", lambda *a, **k: None)
    with SessionLocal() as db:
        ada = db.query(User).filter_by(email="ada@example.com").one()
        db.add_all(
            [
                UsageEvent(user_id=ada.id, provider="gemini", model="m", success=True)
                for _ in range(2)
            ]
        )
        db.commit()

    r = upload(client)
    assert r.status_code == 429 and "today's AI extraction limit" in r.json()["detail"]
    assert upload(other_client).status_code == 201  # per-user limit is per user

    with SessionLocal() as db:
        db.add(UsageEvent(user_id=ada.id, provider="gemini", model="m", success=True))
        db.commit()
    r = upload(other_client)
    assert r.status_code == 429 and "daily AI budget" in r.json()["detail"]


def test_job_claim_is_atomic(client):
    doc_id = upload(client).json()["id"]  # processed inline by TestClient
    with SessionLocal() as db:
        doc = db.get(Document, doc_id)
        doc.status = DocStatus.PROCESSING
        attempts = doc.attempts
        db.commit()

    calls = []

    class Spy:
        name, model = "spy", "spy"

        def extract(self, *a):
            calls.append(a)

    process_document(doc_id, extractor=Spy())  # a second run must not re-extract
    assert calls == []
    with SessionLocal() as db:
        assert db.get(Document, doc_id).attempts == attempts


def test_sample_files_are_whitelisted(client):
    samples = client.get("/api/samples").json()
    assert {"filename": "receipt-cafe-orilla.pdf", "schema": "Receipt"} in samples
    r = client.get("/api/samples/receipt-cafe-orilla.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    for bad in ("..%2F..%2Fconfig.py", "nope.pdf"):
        assert client.get(f"/api/samples/{bad}").status_code == 404
    assert TestClient(app).get("/api/samples").status_code == 401


def test_demo_visitors_never_use_gemini(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", "test-key")
    monkeypatch.setattr(s, "ai_daily_limit_global", 0)  # even with the budget spent
    demo = TestClient(app)
    assert demo.post("/api/auth/demo").status_code == 201
    r = upload(demo, "receipt-cafe-orilla.pdf", schema="Receipt")
    assert r.status_code == 201
    doc = demo.get(f"/api/documents/{r.json()['id']}").json()
    assert doc["provider"] == "demo" and doc["status"] == "needs_review"
