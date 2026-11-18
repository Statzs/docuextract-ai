"""Integration tests: real HTTP app, real SQLite database, offline demo extractor."""

import csv
import io
import json

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.db import SessionLocal
from app.extraction.base import ExtractionResult, TransientExtractionError
from app.main import app
from app.models import Document, UsageEvent
from app.services.processing import process_document
from tests.conftest import SAMPLES, schema_id, upload


# ---- auth ----
def test_register_login_logout_flow(client):
    assert client.get("/api/auth/me").json()["email"] == "ada@example.com"
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    bad = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope-nope"})
    assert bad.status_code == 401
    ok = client.post(
        "/api/auth/login", json={"email": "ADA@example.com", "password": "s3cret-pass"}
    )
    assert ok.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_session_cookie_is_httponly(client):
    r = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "s3cret-pass"})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_register_rejects_duplicates_and_weak_passwords(client):
    dup = {"email": "Ada@Example.com", "name": "x", "password": "another-pass"}
    assert client.post("/api/auth/register", json=dup).status_code == 409
    weak = {"email": "new@example.com", "name": "x", "password": "short"}
    assert client.post("/api/auth/register", json=weak).status_code == 422


def test_forged_token_is_rejected():
    c = TestClient(app)
    c.cookies.set("dx_session", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.")
    assert c.get("/api/documents").status_code == 401


# ---- schemas ----
def test_new_users_get_template_schemas(client):
    names = [s["name"] for s in client.get("/api/schemas").json()]
    assert names == ["Invoice", "Receipt", "Residential Lease"]


def test_schema_crud_and_validation(client):
    body = {"name": "PO", "fields": [{"key": "po_number", "label": "PO Number"}]}
    created = client.post("/api/schemas", json=body).json()
    body["fields"].append({"key": "amount", "label": "Amount", "type": "currency"})
    updated = client.put(f"/api/schemas/{created['id']}", json=body).json()
    assert [f["key"] for f in updated["fields"]] == ["po_number", "amount"]

    bad_key = {"name": "x", "fields": [{"key": "Bad Key", "label": "x"}]}
    assert client.post("/api/schemas", json=bad_key).status_code == 422
    dup = {"name": "x", "fields": [{"key": "a", "label": "A"}, {"key": "a", "label": "B"}]}
    assert client.post("/api/schemas", json=dup).status_code == 422
    assert client.post("/api/schemas", json={"name": "x", "fields": []}).status_code == 422

    assert client.delete(f"/api/schemas/{created['id']}").status_code == 204
    assert client.get(f"/api/schemas/{created['id']}").status_code == 404


# ---- documents: full lifecycle ----
def test_upload_extract_review_validate(client):
    r = upload(client)
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]

    doc = client.get(f"/api/documents/{doc_id}").json()  # background task already ran
    assert doc["status"] == "needs_review"
    data = doc["extracted_data"]
    assert data["invoice_number"]["value"] == "HR-2026-0142"
    assert data["total"]["value"] == 3834.0
    assert data["issue_date"]["value"] == "2026-10-02"
    assert data["currency"]["value"] == "USD"

    bad = client.patch(f"/api/documents/{doc_id}/review", json={"values": {"total": "lots"}})
    assert bad.status_code == 422 and "total" in bad.json()["detail"]["fields"]

    missing = client.patch(
        f"/api/documents/{doc_id}/review", json={"values": {"total": None}, "validate": True}
    )
    assert missing.status_code == 422

    ok = client.patch(
        f"/api/documents/{doc_id}/review", json={"values": {"total": "3,900.00"}, "validate": True}
    ).json()
    assert ok["status"] == "validated" and ok["reviewed_data"]["total"] == 3900.0
    assert ok["extracted_data"]["total"]["value"] == 3834.0  # original AI output preserved


def test_european_number_formats_are_extracted(client):
    doc_id = upload(client, "invoice-brightwater-7781.pdf").json()["id"]
    data = client.get(f"/api/documents/{doc_id}").json()["extracted_data"]
    assert data["total"]["value"] == 2525.78
    assert data["issue_date"]["value"] == "2026-10-14"


def test_upload_rejections(client):
    r = upload(client, data=b"<script>alert(1)</script>")
    assert r.status_code == 422 and "Unsupported" in r.json()["detail"]
    r = client.post(
        "/api/documents",
        files={"file": ("a.pdf", (SAMPLES / "receipt-cafe-orilla.pdf").read_bytes())},
        data={"schema_id": "does-not-exist"},
    )
    assert r.status_code == 404


def test_original_file_is_served_safely(client):
    doc_id = upload(client).json()["id"]
    r = client.get(f"/api/documents/{doc_id}/file")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.content.startswith(b"%PDF-")


def test_list_filters_and_search(client):
    upload(client)
    upload(client, "receipt-cafe-orilla.pdf", "Receipt")
    page = client.get("/api/documents", params={"q": "cafe"}).json()
    assert page["total"] == 1 and page["items"][0]["filename"] == "receipt-cafe-orilla.pdf"
    assert client.get("/api/documents", params={"q": "%"}).json()["total"] == 0
    assert client.get("/api/documents", params={"status": "validated"}).json()["total"] == 0


def test_delete_document(client):
    doc_id = upload(client).json()["id"]
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert client.get(f"/api/documents/{doc_id}").status_code == 404


# ---- isolation between users ----
def test_users_cannot_access_each_others_data(client, other_client):
    doc_id = upload(client).json()["id"]
    sid = schema_id(client)
    for method, url in [
        ("get", f"/api/documents/{doc_id}"),
        ("get", f"/api/documents/{doc_id}/file"),
        ("post", f"/api/documents/{doc_id}/retry"),
        ("delete", f"/api/documents/{doc_id}"),
        ("get", f"/api/schemas/{sid}"),
        ("delete", f"/api/schemas/{sid}"),
    ]:
        assert getattr(other_client, method)(url).status_code == 404, url
    r = other_client.patch(f"/api/documents/{doc_id}/review", json={"values": {}})
    assert r.status_code == 404
    assert other_client.get("/api/documents").json()["total"] == 0
    r = other_client.get("/api/documents/export", params={"ids": doc_id})
    assert r.status_code == 404
    # uploading against someone else's schema is refused
    r = other_client.post(
        "/api/documents",
        files={"file": ("a.pdf", (SAMPLES / "receipt-cafe-orilla.pdf").read_bytes())},
        data={"schema_id": sid},
    )
    assert r.status_code == 404
    assert client.get(f"/api/documents/{doc_id}").status_code == 200


# ---- exports ----
def test_exports_prefer_reviewed_values_and_block_formula_injection(client):
    doc_id = upload(client).json()["id"]
    client.patch(
        f"/api/documents/{doc_id}/review",
        json={"values": {"vendor_name": '=HYPERLINK("http://evil")'}},
    )
    r = client.get("/api/documents/export", params={"format": "csv"})
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0]["vendor_name"].startswith("'=")
    assert rows[0]["total"] == "3834.0"

    r = client.get("/api/documents/export", params={"format": "json"})
    assert json.loads(r.content)[0]["invoice_number"] == "HR-2026-0142"

    r = client.get("/api/documents/export", params={"format": "xlsx"})
    ws = load_workbook(io.BytesIO(r.content)).active
    header = [c.value for c in ws[1]]
    assert "invoice_number" in header and ws.max_row == 2


# ---- retries and usage ----
class FlakyExtractor:
    name, model = "gemini", "fake-model"

    def __init__(self, failures):
        self.failures = failures

    def extract(self, content, mime, fields):
        if self.failures:
            self.failures -= 1
            raise TransientExtractionError("503", "busy")
        return ExtractionResult(
            {f["key"]: {"value": None, "confidence": 0} for f in fields},
            model="fake-model",
            input_tokens=100,
            output_tokens=10,
        )


def _queued_doc(client) -> str:
    doc_id = upload(client).json()["id"]
    with SessionLocal() as db:
        db.get(Document, doc_id).status = "queued"
        db.commit()
    return doc_id


def _events(doc_id):
    with SessionLocal() as db:
        return db.query(UsageEvent).filter_by(document_id=doc_id).count()


def test_transient_errors_are_retried_then_succeed(client):
    doc_id = _queued_doc(client)
    before = _events(doc_id)
    process_document(doc_id, extractor=FlakyExtractor(failures=2), sleep=lambda s: None)
    doc = client.get(f"/api/documents/{doc_id}").json()
    assert doc["status"] == "needs_review" and doc["provider"] == "gemini"
    assert _events(doc_id) - before == 3  # two failed attempts + one success are all billed


def test_gives_up_after_max_attempts_and_can_be_retried(client):
    doc_id = _queued_doc(client)
    process_document(doc_id, extractor=FlakyExtractor(failures=99), sleep=lambda s: None)
    doc = client.get(f"/api/documents/{doc_id}").json()
    assert doc["status"] == "failed" and "3 attempts" in doc["error"]
    retried = client.post(f"/api/documents/{doc_id}/retry")
    assert retried.status_code == 200
    assert client.get(f"/api/documents/{doc_id}").json()["status"] == "needs_review"


def test_usage_summary(client):
    upload(client)
    u = client.get("/api/usage", params={"days": 7}).json()
    assert u["total_requests"] == 1 and u["failed_requests"] == 0
    assert u["estimated"] is True and len(u["series"]) == 7
    assert u["series"][-1]["requests"] == 1
    assert u["status_counts"] == {"needs_review": 1}


# ---- demo mode ----
def test_demo_workspace_is_seeded_and_isolated():
    a, b = TestClient(app), TestClient(app)
    assert a.post("/api/auth/demo").status_code == 201
    assert b.post("/api/auth/demo").status_code == 201
    docs = a.get("/api/documents").json()
    assert docs["total"] == 6
    statuses = {d["status"] for d in docs["items"]}
    assert statuses == {"needs_review", "validated"}
    assert a.get("/api/auth/me").json()["id"] != b.get("/api/auth/me").json()["id"]
    assert b.get(f"/api/documents/{docs['items'][0]['id']}").status_code == 404
    usage = a.get("/api/usage").json()
    assert usage["total_requests"] == 6


def test_config_reports_demo_mode():
    cfg = TestClient(app).get("/api/config").json()
    assert cfg["demo_mode"] is True and cfg["provider"] == "demo"


def test_restart_recovery_marks_interrupted_jobs_failed(client):
    from app.services.processing import recover_interrupted_jobs

    doc_id = _queued_doc(client)
    assert recover_interrupted_jobs() == 1
    doc = client.get(f"/api/documents/{doc_id}").json()
    assert doc["status"] == "failed" and "interrupted" in doc["error"]


def test_oversized_request_is_rejected_before_parsing(client):
    big = b"%PDF-" + b"0" * (12 * 1024 * 1024)
    r = client.post(
        "/api/documents",
        files={"file": ("big.pdf", big, "application/pdf")},
        data={"schema_id": schema_id(client)},
    )
    assert r.status_code == 413
