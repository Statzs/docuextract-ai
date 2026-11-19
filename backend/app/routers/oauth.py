"""Sign in with Google or GitHub (OAuth 2.0 authorization code flow with PKCE).

Security notes:
- `state` and the PKCE verifier live in a short-lived, signed, HttpOnly cookie, so a
  callback that this browser did not start is refused (login CSRF).
- The profile is fetched server-to-server with the access token we just obtained; nothing
  the browser sends is trusted as identity.
- An existing account is linked only through an email the provider says is verified. If
  that account was created with a password (never verified), the password is removed and
  its sessions are revoked: whoever registered the address first cannot keep a way in.
"""

import base64
import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.demo.seed import create_default_schemas
from app.models import OAuthIdentity, User
from app.security import auth_limiter, set_session_cookie, signup_limiter

router = APIRouter(prefix="/api/auth/oauth", tags=["auth"])
log = logging.getLogger("docuextract.oauth")

STATE_COOKIE = "dx_oauth"
STATE_TTL = timedelta(minutes=10)
PROVIDERS = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
    },
    "github": {
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "scope": "read:user user:email",
    },
}


class OAuthFailed(Exception):
    """Shown to the user as a generic 'could not sign in' message; details only in logs."""


@dataclass
class Profile:
    subject: str
    email: str
    email_verified: bool
    name: str


def _credentials(provider: str) -> tuple[str, str]:
    s = get_settings()
    if provider == "google" and s.google_enabled:
        return s.google_client_id, s.google_client_secret
    if provider == "github" and s.github_enabled:
        return s.github_client_id, s.github_client_secret
    raise HTTPException(404, "This sign-in method is not available.")


def _redirect_uri(provider: str) -> str:
    return f"{get_settings().app_url.rstrip('/')}/api/auth/oauth/{provider}/callback"


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@router.get("/{provider}/start", dependencies=[Depends(auth_limiter)])
def start(provider: str):
    client_id, _ = _credentials(provider)
    s = get_settings()
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    params = {
        "client_id": client_id,
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "scope": PROVIDERS[provider]["scope"],
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
    }
    if provider == "google":
        params["prompt"] = "select_account"
    resp = RedirectResponse(f"{PROVIDERS[provider]['authorize']}?{urlencode(params)}", 302)
    exp = datetime.now(UTC) + STATE_TTL
    token = jwt.encode(
        {"p": provider, "s": state, "v": verifier, "exp": exp}, s.jwt_secret, algorithm="HS256"
    )
    resp.set_cookie(
        STATE_COOKIE,
        token,
        max_age=int(STATE_TTL.total_seconds()),
        httponly=True,
        secure=s.is_production,
        samesite="lax",  # sent on the provider's top-level redirect back to us
        path="/api/auth/oauth",
    )
    return resp


def fetch_profile(provider: str, code: str, verifier: str) -> Profile:
    """Exchange the code and read the user's identity from the provider."""
    client_id, secret = _credentials(provider)
    data = {
        "client_id": client_id,
        "client_secret": secret,
        "code": code,
        "redirect_uri": _redirect_uri(provider),
        "grant_type": "authorization_code",
        "code_verifier": verifier,
    }
    with httpx.Client(timeout=10, headers={"Accept": "application/json"}) as http:
        tok = http.post(PROVIDERS[provider]["token"], data=data)
        access = tok.json().get("access_token") if tok.is_success else None
        if not access:
            raise OAuthFailed(f"{provider} token exchange failed: {tok.status_code}")
        auth = {"Authorization": f"Bearer {access}"}
        if provider == "google":
            info = http.get("https://openidconnect.googleapis.com/v1/userinfo", headers=auth)
            if not info.is_success:
                raise OAuthFailed(f"google userinfo failed: {info.status_code}")
            u = info.json()
            return Profile(
                subject=str(u["sub"]),
                email=str(u.get("email") or ""),
                email_verified=u.get("email_verified") is True,
                name=str(u.get("name") or ""),
            )
        user = http.get("https://api.github.com/user", headers=auth)
        emails = http.get("https://api.github.com/user/emails", headers=auth)
        if not (user.is_success and emails.is_success):
            raise OAuthFailed(f"github profile failed: {user.status_code}/{emails.status_code}")
        u = user.json()
        primary = next((e for e in emails.json() if e.get("primary")), None) or {}
        return Profile(
            subject=str(u["id"]),
            email=str(primary.get("email") or ""),
            email_verified=primary.get("verified") is True,
            name=str(u.get("name") or u.get("login") or ""),
        )


def resolve_user(db: Session, provider: str, p: Profile) -> User:
    """Find or create the account for this identity. See the module docstring for linking."""
    ident = db.scalar(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider, OAuthIdentity.subject == p.subject
        )
    )
    if ident:
        return db.get(User, ident.user_id)
    if not p.email or not p.email_verified:
        raise OAuthFailed(f"{provider} account has no verified email")
    email = p.email.lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if user and user.is_demo:
        raise OAuthFailed("demo address")  # unreachable in practice: demo emails are .local
    if user:
        if not user.email_verified:
            # Proven owner arrives: an unverified password set by whoever registered first
            # must not survive, and neither must that person's sessions.
            if user.password_hash is not None:
                user.password_hash = None
                user.token_version += 1
            user.email_verified = True
    else:
        signup_limiter.hit("global")
        user = User(email=email, name=(p.name or email.split("@")[0])[:120], password_hash=None)
        user.email_verified = True
        db.add(user)
        db.flush()
        create_default_schemas(db, user)
    db.add(OAuthIdentity(user_id=user.id, provider=provider, subject=p.subject))
    db.commit()
    return user


@router.get("/{provider}/callback", dependencies=[Depends(auth_limiter)])
def callback(provider: str, request: Request, db: Session = Depends(get_db)):
    _credentials(provider)
    s = get_settings()
    app_url = s.app_url.rstrip("/")
    fail = RedirectResponse(f"{app_url}/login?error=oauth", 302)
    fail.delete_cookie(STATE_COOKIE, path="/api/auth/oauth")
    q = request.query_params
    try:
        claims = jwt.decode(
            request.cookies.get(STATE_COOKIE, ""), s.jwt_secret, algorithms=["HS256"]
        )
    except jwt.PyJWTError:
        log.info("oauth callback without a valid state cookie")
        return fail
    sent_state = q.get("state", "")
    if claims.get("p") != provider or not hmac.compare_digest(
        sent_state.encode(), str(claims.get("s", "")).encode()
    ):
        log.info("oauth state mismatch")
        return fail
    if q.get("error") or not q.get("code"):
        return fail  # the user cancelled on the provider's page
    try:
        profile = fetch_profile(provider, q["code"], claims["v"])
        user = resolve_user(db, provider, profile)
    except (OAuthFailed, HTTPException, httpx.HTTPError, KeyError, ValueError) as e:
        db.rollback()
        log.warning("oauth sign-in failed: %s", e)
        return fail
    except IntegrityError:  # the same identity linked by a concurrent callback
        db.rollback()
        return fail
    ok = RedirectResponse(f"{app_url}/app", 302)
    ok.delete_cookie(STATE_COOKIE, path="/api/auth/oauth")
    set_session_cookie(ok, user)
    return ok
