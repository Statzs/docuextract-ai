import hashlib
import logging
import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.demo.seed import create_default_schemas, create_demo_user, purge_old_demo_users
from app.models import PasswordResetToken, User, utcnow
from app.schemas import ForgotPasswordIn, LoginIn, RegisterIn, ResetPasswordIn, UserOut
from app.security import (
    auth_limiter,
    clear_session_cookie,
    client_ip,
    current_user,
    hash_password,
    login_email_limiter,
    reset_email_limiter,
    set_session_cookie,
    signup_limiter,
    verify_password,
)
from app.services.mailer import send_email

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("docuextract.auth")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _send_reset_email(to: str, link: str, ttl: int) -> None:
    try:
        send_email(
            to,
            "Reset your DocuExtract AI password",
            f"Someone asked to reset the password for this account.\n\n{link}\n\n"
            f"The link expires in {ttl} minutes and works once. "
            "If it wasn't you, ignore this email.",
        )
    except Exception:
        log.exception("could not send password reset email")


@router.post(
    "/register", response_model=UserOut, status_code=201, dependencies=[Depends(auth_limiter)]
)
def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    if body.website:  # honeypot field, invisible to people: only bots fill it in
        log.info("sign-up honeypot triggered")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sign-up failed. Please try again.")
    signup_limiter.hit("global")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # concurrent registration with the same email
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        ) from None
    create_default_schemas(db, user)  # new users start with useful templates
    db.commit()
    set_session_cookie(response, user)
    return user


@router.post("/login", response_model=UserOut, dependencies=[Depends(auth_limiter)])
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    login_email_limiter.hit(body.email.lower())  # brute force on one account, from any IP
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not verify_password(body.password, user.password_hash if user else None) or user.is_demo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    set_session_cookie(response, user)
    return user


@router.post("/demo", response_model=UserOut, status_code=201, dependencies=[Depends(auth_limiter)])
def start_demo(request: Request, response: Response, db: Session = Depends(get_db)):
    signup_limiter.hit("global")
    # Audit line; also how you confirm in the host's logs that real visitor IPs come through.
    log.info("demo workspace requested from %s", client_ip(request))
    purge_old_demo_users(db)
    user = create_demo_user(db)
    set_session_cookie(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response):
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.delete("/me", status_code=204)
def delete_account(response: Response, user: User = Depends(current_user), db=Depends(get_db)):
    """Delete the account and everything in it (documents, files, templates, usage)."""
    db.delete(db.merge(user))  # FK cascades remove the rest
    db.commit()
    clear_session_cookie(response)


@router.post("/forgot-password", status_code=202, dependencies=[Depends(auth_limiter)])
def forgot_password(
    body: ForgotPasswordIn, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Always 202 with the same body, so the endpoint does not reveal which emails exist."""
    s = get_settings()
    if not s.password_reset_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Password reset is not available.")
    reset_email_limiter.hit(body.email.lower())  # also stops mail-bombing one inbox
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user and not user.is_demo:
        token = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=_hash_token(token),
                expires_at=utcnow() + timedelta(minutes=s.password_reset_ttl_minutes),
            )
        )
        db.commit()
        link = f"{s.app_url.rstrip('/')}/reset-password?token={token}"
        background.add_task(_send_reset_email, user.email, link, s.password_reset_ttl_minutes)
    return {"message": "If an account exists for that email, a reset link is on its way."}


@router.post("/reset-password", status_code=204, dependencies=[Depends(auth_limiter)])
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    invalid = HTTPException(
        status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired."
    )
    token_hash = _hash_token(body.token)
    # Atomic single use: only one request can flip used_at from NULL.
    used = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > utcnow(),
        )
        .values(used_at=utcnow())
    ).rowcount
    if not used:
        raise invalid
    reset = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash))
    user = db.get(User, reset.user_id)
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # signs out every existing session
    # Any other outstanding links for this user die too.
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    db.commit()
