"""Product upgrade: templates, two-step flow, dedupe, OAuth, admin, rules and OCR."""

import io
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.db import SessionLocal
from app.demo.data import INVOICE_FIELDS, PAYMENT_FIELDS, RECEIPT_FIELDS
from app.demo.data import SAMPLES as SAMPLE_ROWS
from app.extraction.classify import suggest_kind
from app.extraction.rules import StandardExtractor, match_fields
from app.extraction.text import ocr_available
from app.main import app
from app.models import Document, OAuthIdentity, User, utcnow
from app.routers import oauth
from app.services.files import UploadRejected, validate_upload
from tests.conftest import SAMPLES, make_client, schema_id

PDF = "application/pdf"


def _post(c, name, data=None, **form):
    data = data if data is not None else (SAMPLES / name).read_bytes()
    return c.post(
        "/api/documents", files={"file": (name, data, "application/octet-stream")}, data=form
    )


# ---- two-step flow: upload, choose type, extract ----
def test_upload_without_type_waits_and_suggests_one(client):
    r = _post(client, "invoice-halden-roe-0142.pdf")
    assert r.status_code == 201
    doc = r.json()
    assert doc["status"] == "uploaded" and doc["suggested_schema_id"] == schema_id(client)
    assert client.get(f"/api/documents/{doc['id']}").json()["suggested_schema_id"]

    r = client.post(f"/api/documents/{doc['id']}/extract", json={"schema_id": schema_id(client)})
    assert r.status_code == 200
    done = client.get(f"/api/documents/{doc['id']}").json()
    assert done["status"] == "needs_review" and done["schema_name"] == "Invoice"
    assert done["extracted_data"]["invoice_number"]["value"] == "HR-2026-0142"

    # Change the type afterwards: re-extract with another template.
    r = client.post(
        f"/api/documents/{doc['id']}/extract", json={"schema_id": schema_id(client, "Receipt")}
    )
    assert client.get(f"/api/documents/{doc['id']}").json()["schema_name"] == "Receipt"


def test_extract_needs_own_document_and_template(client, other_client):
    doc = _post(client, "invoice-halden-roe-0142.pdf").json()
    theirs = schema_id(other_client)
    assert (
        other_client.post(f"/api/documents/{doc['id']}/extract", json={"schema_id": theirs})
    ).status_code == 404
    r = client.post(f"/api/documents/{doc['id']}/extract", json={"schema_id": theirs})
    assert r.status_code == 404  # someone else's template
    assert client.post(f"/api/documents/{doc['id']}/retry").status_code == 409  # no type yet


def test_same_file_is_not_stored_or_extracted_twice(client, other_client):
    first = _post(client, "receipt-cafe-orilla.pdf", schema_id=schema_id(client, "Receipt"))
    again = _post(client, "renamed.pdf", (SAMPLES / "receipt-cafe-orilla.pdf").read_bytes())
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["duplicate"] is True and again.json()["id"] == first.json()["id"]
    assert client.get("/api/documents").json()["total"] == 1
    # Another user uploading the same bytes gets their own copy.
    assert _post(other_client, "receipt-cafe-orilla.pdf").status_code == 201


def test_daily_document_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "daily_documents_per_user", 1)
    assert _post(client, "receipt-cafe-orilla.pdf").status_code == 201
    r = _post(client, "receipt-metro-hardware.pdf")
    assert r.status_code == 429 and "per day" in r.json()["detail"]


def test_built_in_templates_cannot_be_deleted(client):
    assert client.delete(f"/api/schemas/{schema_id(client)}").status_code == 409


def test_retention_deletes_old_documents(client, monkeypatch):
    doc_id = _post(client, "receipt-cafe-orilla.pdf").json()["id"]
    with SessionLocal() as db:
        db.get(Document, doc_id).created_at = utcnow() - timedelta(days=31)
        db.commit()
    _post(client, "receipt-metro-hardware.pdf")  # uploads run the purge
    assert client.get(f"/api/documents/{doc_id}").status_code == 404


def test_delete_account_removes_everything(client):
    _post(client, "receipt-cafe-orilla.pdf")
    assert client.delete("/api/auth/me").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    with SessionLocal() as db:
        assert db.query(Document).count() == 0 and db.query(User).count() == 0


def test_signup_honeypot_rejects_bots():
    body = {"email": "bot@example.com", "name": "B", "password": "s3cret-pass", "website": "x"}
    assert TestClient(app).post("/api/auth/register", json=body).status_code == 400


# ---- file safety ----
def test_hostile_images_are_rejected():
    big = io.BytesIO()
    Image.new("1", (9000, 9000)).save(big, "PNG")  # 81 MP, tiny file: decompression bomb
    with pytest.raises(UploadRejected, match="too large"):
        validate_upload(big.getvalue(), "bomb.png")
    with pytest.raises(UploadRejected, match="corrupted"):
        validate_upload(b"\x89PNG\r\n\x1a\n" + b"garbage" * 20, "bad.png")


# ---- standard extraction (no AI) ----
def test_rules_read_every_sample_pdf_exactly():
    """Ground truth comes from the fictional sample definitions."""
    from app.demo.data import SCHEMAS

    fields_by_schema = {s["name"]: s["fields"] for s in SCHEMAS}
    for filename, schema, _t, lines, *_ in SAMPLE_ROWS:
        if not filename.endswith(".pdf"):
            continue
        fields = fields_by_schema[schema]
        result = StandardExtractor().extract((SAMPLES / filename).read_bytes(), PDF, fields)
        labelled = {ln.split(":")[0].strip().lower() for ln in lines if ":" in ln}
        for f in fields:
            if f["label"].lower() in labelled:
                assert result.fields[f["key"]]["value"] is not None, (filename, f["key"])
        assert result.provider == "text"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("INVOICE\nInvoice No. A-77\nTotal Due      1.234,50 EUR", {"invoice_number": "A-77"}),
        ("Amount due: $86.48\nTax (8%): 6.40", {"total": "86.48", "tax": "6.40"}),
        ("Total\n312.00", {"total": "312.00"}),
        ("From the start of the project we worked hard.", {"vendor_name": None}),
        ("Issued: Nov. 3 2026\nDue date: 03/12/2026", {"issue_date": "Nov. 3 2026"}),
    ],
)
def test_rules_layouts(text, expected):
    out = match_fields(text, INVOICE_FIELDS)
    for key, value in expected.items():
        assert out[key]["value"] == value, (key, out[key])


def test_rules_never_invent_values():
    out = match_fields("Nothing useful here at all.", PAYMENT_FIELDS)
    assert all(v["value"] is None and v["confidence"] == 0 for v in out.values())


def test_classifier_suggests_only_with_clear_evidence():
    assert suggest_kind("INVOICE\nInvoice Number: 1\nDue Date: x") == "invoice"
    assert suggest_kind("Payment confirmation\nTransaction ID: 9\nAmount paid: 3") == (
        "payment_record"
    )
    assert suggest_kind("", "purchase-order-5520.pdf") is None  # one clue is not enough
    assert suggest_kind("Hello world") is None


@pytest.mark.skipif(not ocr_available(), reason="Tesseract is not installed here (CI has it)")
def test_ocr_reads_the_scanned_receipt():
    data = (SAMPLES / "receipt-scan-harbor-books.png").read_bytes()
    result = StandardExtractor().extract(data, "image/png", RECEIPT_FIELDS)
    assert result.provider == "ocr"
    assert result.fields["merchant"]["value"] == "Harbor Books"
    assert result.fields["total"]["value"] == 21.49
    assert result.fields["date"]["value"] == "2026-11-15"


def test_image_without_ocr_fails_clearly(client, monkeypatch):
    monkeypatch.setattr("app.extraction.text.ocr_available", lambda: False)
    r = _post(client, "receipt-scan-harbor-books.png", schema_id=schema_id(client, "Receipt"))
    doc = client.get(f"/api/documents/{r.json()['id']}").json()
    assert doc["status"] == "failed" and "OCR" in doc["error"]


# ---- OAuth ----
@pytest.fixture
def google(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "cid")
    monkeypatch.setattr(s, "google_client_secret", "csecret")
    profile = oauth.Profile("g-123", "ada@example.com", True, "Ada L")
    monkeypatch.setattr(oauth, "fetch_profile", lambda *a: profile)
    return profile


def _oauth_login(c: TestClient, state: str | None = None):
    start = c.get("/api/auth/oauth/google/start", follow_redirects=False)
    assert start.status_code == 302
    q = parse_qs(urlparse(start.headers["location"]).query)
    assert q["code_challenge_method"] == ["S256"] and "csecret" not in start.headers["location"]
    return c.get(
        "/api/auth/oauth/google/callback",
        params={"code": "abc", "state": state or q["state"][0]},
        follow_redirects=False,
    )


def test_oauth_creates_account_and_signs_in(google):
    google.email = "new@example.com"
    c = TestClient(app)
    r = _oauth_login(c)
    assert r.status_code == 302 and r.headers["location"].endswith("/app")
    me = c.get("/api/auth/me").json()
    assert me["email"] == "new@example.com" and me["has_password"] is False
    assert len(c.get("/api/schemas").json()) == 6
    # Signing in again finds the same account through the identity, not a new one.
    assert _oauth_login(TestClient(app)).status_code == 302
    with SessionLocal() as db:
        assert db.query(User).count() == 1 and db.query(OAuthIdentity).count() == 1


def test_oauth_rejects_forged_state(google):
    c = TestClient(app)
    r = _oauth_login(c, state="attacker-state")
    assert r.headers["location"].endswith("/login?error=oauth")
    assert c.get("/api/auth/me").status_code == 401
    # A callback this browser never started (no state cookie) is refused too.
    r = TestClient(app).get(
        "/api/auth/oauth/google/callback",
        params={"code": "abc", "state": "x"},
        follow_redirects=False,
    )
    assert r.headers["location"].endswith("/login?error=oauth")


def test_oauth_takeover_of_unverified_account_is_neutralised(google):
    squatter = make_client()  # registered ada@example.com with a password, never verified
    r = _oauth_login(TestClient(app))
    assert r.status_code == 302 and r.headers["location"].endswith("/app")
    assert squatter.get("/api/auth/me").status_code == 401  # their session is revoked
    login = {"email": "ada@example.com", "password": "s3cret-pass"}
    assert TestClient(app).post("/api/auth/login", json=login).status_code == 401


def test_oauth_refuses_unverified_provider_email(google):
    google.email_verified = False
    r = _oauth_login(TestClient(app))
    assert r.headers["location"].endswith("/login?error=oauth")


def test_oauth_disabled_provider_is_404():
    r = TestClient(app).get("/api/auth/oauth/github/start", follow_redirects=False)
    assert r.status_code == 404


# ---- admin ----
def test_admin_needs_listed_and_verified_email(google, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_emails", "ada@example.com")
    password_user = make_client()  # listed email, but never proven
    assert password_user.get("/api/admin/overview").status_code == 404
    assert password_user.get("/api/auth/me").json()["is_admin"] is False

    admin = TestClient(app)
    _oauth_login(admin)
    assert admin.get("/api/auth/me").json()["is_admin"] is True
    data = admin.get("/api/admin/overview").json()
    assert data["users"]["registered"] == 1 and "gemini" in data and "recent_failures" in data

    r = admin.put("/api/admin/limits", json={"ai_daily_limit_per_user": 5, "ai_enabled": False})
    assert r.status_code == 200 and r.json()["ai_daily_limit_per_user"] == 5
    assert admin.put("/api/admin/limits", json={"max_pdf_pages": 0}).status_code == 422
    assert admin.post("/api/admin/gemini-check").json()["ok"] is False  # no key in tests

    other = make_client("mallory@example.com", "Mallory")
    assert other.put("/api/admin/limits", json={"ai_enabled": True}).status_code == 404


def test_admin_switch_turns_ai_off(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    from app.services.limits import set_limits

    with SessionLocal() as db:
        set_limits(db, {"ai_enabled": False})
    status = client.get("/api/ai-status").json()
    assert status["available"] is False and "paused" in status["reason"]
