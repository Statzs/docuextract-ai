"""Password reset, session revocation, AI cost quota and the atomic job claim."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.extraction.base import ExtractionResult, TransientExtractionError
from app.main import app
from app.models import DocStatus, Document, PasswordResetToken, UsageEvent, User, utcnow
from app.services.processing import process_document
from tests.conftest import SAMPLES, schema_id, upload


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


class FakeGemini:
    name, model = "gemini", "fake-gemini"

    def extract(self, content, mime, fields):
        return ExtractionResult(
            {f["key"]: {"value": None, "confidence": 0} for f in fields}, model=self.model
        )


def test_ai_quota_falls_back_to_standard_reading(client, other_client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", "test-key")
    monkeypatch.setattr(s, "ai_daily_limit_per_user", 2)
    monkeypatch.setattr(s, "ai_daily_limit_global", 3)
    monkeypatch.setattr("app.services.processing.get_ai_extractor", FakeGemini)
    with SessionLocal() as db:
        ada = db.query(User).filter_by(email="ada@example.com").one()
        db.add_all(
            [
                UsageEvent(user_id=ada.id, provider="gemini", model="m", success=True)
                for _ in range(2)
            ]
        )
        db.commit()

    # Ada is over her limit: the upload still works, read without AI, and says why.
    doc = client.get(f"/api/documents/{upload(client).json()['id']}").json()
    assert doc["status"] == "needs_review" and doc["provider"] == "text"
    assert "today's 2 AI extractions" in doc["notes"]
    assert doc["extracted_data"]["total"]["value"] == 3834.0  # real values, not AI ones

    # Mallory still has AI (the per-user limit is per user)...
    doc = other_client.get(f"/api/documents/{upload(other_client).json()['id']}").json()
    assert doc["provider"] == "gemini"
    # ...until the shared daily budget (3) is spent.
    r = upload(other_client, "receipt-cafe-orilla.pdf", schema="Receipt")
    doc = other_client.get(f"/api/documents/{r.json()['id']}").json()
    assert doc["provider"] == "text" and "shared AI budget" in doc["notes"]


def test_private_mode_never_uses_ai(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    called = []
    monkeypatch.setattr("app.services.processing.get_ai_extractor", lambda: called.append(1))
    data = (SAMPLES / "invoice-halden-roe-0142.pdf").read_bytes()
    r = client.post(
        "/api/documents",
        files={"file": ("x.pdf", data, "application/pdf")},
        data={"schema_id": schema_id(client), "mode": "private"},
    )
    doc = client.get(f"/api/documents/{r.json()['id']}").json()
    assert called == [] and doc["mode"] == "private" and doc["provider"] == "text"
    assert "not sent to any AI" in doc["notes"]


def test_ai_failure_falls_back_and_says_so(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")

    class Broken:
        name, model = "gemini", "broken"

        def extract(self, *a):
            raise TransientExtractionError("429 quota", "The AI provider is busy.")

    monkeypatch.setattr("app.services.processing.get_ai_extractor", Broken)
    doc = client.get(f"/api/documents/{upload(client).json()['id']}").json()
    assert doc["status"] == "needs_review" and doc["provider"] == "text"
    assert "AI could not process" in doc["notes"]
    with SessionLocal() as db:  # every AI attempt is still counted against the budget
        assert db.query(UsageEvent).filter_by(provider="gemini", success=False).count() == 3


def test_ai_values_missing_from_the_text_are_flagged(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")

    class Inventive:
        name, model = "gemini", "inventive"

        def extract(self, content, mime, fields):
            raw = {f["key"]: {"value": None, "confidence": 0} for f in fields}
            raw["invoice_number"] = {"value": "HR-2026-0142", "confidence": 0.99}  # real
            raw["vendor_name"] = {"value": "Totally Made Up Ltd", "confidence": 0.99}  # invented
            return ExtractionResult(raw, model=self.model)

    monkeypatch.setattr("app.services.processing.get_ai_extractor", Inventive)
    doc = client.get(f"/api/documents/{upload(client).json()['id']}").json()
    assert doc["extracted_data"]["invoice_number"]["confidence"] == 0.99
    assert doc["extracted_data"]["vendor_name"]["confidence"] == 0.4
    assert "do not appear word for word" in doc["notes"]


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
    data = (SAMPLES / "receipt-cafe-orilla.pdf").read_bytes() + b" %%"  # not a duplicate
    r = upload(demo, "receipt-cafe-orilla.pdf", schema="Receipt", data=data)
    assert r.status_code == 201
    doc = demo.get(f"/api/documents/{r.json()['id']}").json()
    assert doc["provider"] == "text" and doc["status"] == "needs_review"
