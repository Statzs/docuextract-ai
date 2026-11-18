import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User

COOKIE_NAME = "dx_session"
# Hash used when the email is unknown so login timing does not reveal account existence.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt()).decode()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    ok = bcrypt.checkpw(password.encode(), (password_hash or _DUMMY_HASH).encode())
    return ok and password_hash is not None


def create_token(user: User) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=s.jwt_ttl_minutes)
    payload = {"sub": user.id, "ver": user.token_version, "iat": now, "exp": exp}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def set_session_cookie(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        create_token(user),
        max_age=s.jwt_ttl_minutes * 60,
        httponly=True,
        secure=s.is_production,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise unauthorized
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise unauthorized from None
    user = db.get(User, payload.get("sub"))
    if not user or payload.get("ver", 0) != user.token_version:
        raise unauthorized
    return user


def client_ip(request: Request) -> str:
    """The visitor's IP. Proxy headers are trusted only when the origin lock is on.

    Without ORIGIN_SECRET, X-Forwarded-For and friends are attacker-controlled (a client can
    call the API host directly), so only the TCP peer address is used.
    """
    s = get_settings()
    if s.client_ip_header and s.origin_secret:
        value = request.headers.get(s.client_ip_header, "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Sliding-window limiter. As a dependency it keys on the client IP; `hit(key)` takes any
    key (an email, a user id, "global") for limits that a spoofed IP cannot escape.

    shortcut: in-memory and per-process; use Redis or the edge proxy when running >1 instance.
    """

    def __init__(self, limit: int, window_seconds: int, message: str | None = None):
        self.limit, self.window = limit, window_seconds
        self.message = message or "Too many requests, please slow down."
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        self.hit(client_ip(request))

    def hit(self, key: str) -> None:
        if get_settings().environment == "test":
            return
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and q[0] <= now - self.window:
                q.popleft()
            if len(q) >= self.limit:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    self.message,
                    headers={"Retry-After": str(self.window)},
                )
            q.append(now)


# Per IP (meaningful once the origin lock is on).
auth_limiter = RateLimiter(limit=10, window_seconds=60)
# Keys a forged IP cannot change:
login_email_limiter = RateLimiter(
    10, 15 * 60, "Too many sign-in attempts for this account. Try again in 15 minutes."
)
reset_email_limiter = RateLimiter(3, 60 * 60, "Too many reset requests. Try again later.")
signup_limiter = RateLimiter(  # global cap on new accounts and demo workspaces
    200, 60 * 60, "Too many new workspaces right now. Please try again in a few minutes."
)
upload_limiter = RateLimiter(30, 60, "Too many uploads. Please wait a minute.")  # per user
