"""Rate limits must hold even when the client lies about its IP."""

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import security
from app.config import get_settings
from app.main import app
from tests.conftest import upload

SECRET = "s" * 40


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "development")
    for name in (
        "auth_limiter",
        "login_email_limiter",
        "reset_email_limiter",
        "signup_limiter",
        "upload_limiter",
    ):
        getattr(security, name).hits.clear()


def _request(headers: dict[str, str], peer="10.0.0.1") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (peer, 1234)})


def test_forwarded_headers_are_ignored_without_origin_lock(monkeypatch):
    monkeypatch.setattr(get_settings(), "client_ip_header", "x-real-ip")
    req = _request({"x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8"})
    assert security.client_ip(req) == "10.0.0.1"  # origin_secret empty: header not trusted


def test_client_ip_header_is_used_behind_origin_lock(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "client_ip_header", "x-real-ip")
    monkeypatch.setattr(s, "origin_secret", SECRET)
    assert security.client_ip(_request({"x-real-ip": "5.6.7.8"})) == "5.6.7.8"
    assert security.client_ip(_request({})) == "10.0.0.1"


def test_origin_lock_rejects_requests_that_bypass_the_proxy(monkeypatch):
    monkeypatch.setattr(get_settings(), "origin_secret", SECRET)
    c = TestClient(app)
    assert c.get("/api/health").status_code == 200  # platform health probe
    assert c.get("/api/config").status_code == 403
    assert c.get("/api/config", headers={"x-origin-secret": "wrong"}).status_code == 403
    assert c.get("/api/config", headers={"x-origin-secret": SECRET}).status_code == 200


def test_login_limit_is_per_account_not_per_ip(client, limits_on):
    anon = TestClient(app)
    body = {"email": "ada@example.com", "password": "wrong-password"}
    for i in range(10):
        hdrs = {"x-forwarded-for": f"9.9.9.{i}", "x-real-ip": f"8.8.8.{i}"}
        security.auth_limiter.hits.clear()  # pretend each try comes from a fresh IP
        assert anon.post("/api/auth/login", json=body, headers=hdrs).status_code == 401
    security.auth_limiter.hits.clear()
    r = anon.post("/api/auth/login", json={**body, "password": "s3cret-pass"})
    assert r.status_code == 429 and "this account" in r.json()["detail"]


def test_reset_requests_are_limited_per_email(limits_on, monkeypatch):
    monkeypatch.setattr("app.routers.auth.send_email", lambda *a: None)
    anon = TestClient(app)
    codes = []
    for _ in range(4):
        security.auth_limiter.hits.clear()
        codes.append(
            anon.post("/api/auth/forgot-password", json={"email": "x@example.com"}).status_code
        )
    assert codes == [202, 202, 202, 429]


def test_uploads_are_limited_per_user(client, limits_on, monkeypatch):
    monkeypatch.setattr(security.upload_limiter, "limit", 2)
    assert [upload(client).status_code for _ in range(3)] == [201, 201, 429]


def test_new_workspaces_have_a_global_cap(limits_on, monkeypatch):
    monkeypatch.setattr(security.signup_limiter, "limit", 2)
    codes = []
    for _ in range(3):
        security.auth_limiter.hits.clear()
        codes.append(TestClient(app).post("/api/auth/demo").status_code)
    assert codes == [201, 201, 429]
