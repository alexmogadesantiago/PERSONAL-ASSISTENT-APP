"""Authentication service: registration, login, refresh-token rotation, logout.

Kept out of the routers so the logic is testable in isolation and reusable
(the installer creates the first admin through `register_user`).
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import (
    create_access_token,
    dummy_verify,
    hash_password,
    hash_token,
    needs_rehash,
    new_refresh_token,
    verify_password,
)
from app.models import EventSeverity, RefreshToken, User, UserRole, UserStatus
from app.services import audit


class AuthError(Exception):
    """Auth failed. `code` is a stable machine string; `message` is generic on
    purpose for the paths where leaking detail would enable enumeration.
    """

    def __init__(self, code: str, message: str, status_code: int = 401):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def user_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User)) or 0


def register_user(
    db: Session,
    *,
    email: str,
    username: str,
    password: str,
    role: UserRole | None = None,
    correlation_id: str | None = None,
) -> User:
    email = email.strip().lower()
    username = username.strip()

    # email is stored lower-cased (below), so a plain match stays index-friendly;
    # username keeps its display casing, so collision-check it case-insensitively.
    exists = db.scalar(
        select(User).where(
            (User.email == email) | (func.lower(User.username) == username.lower())
        )
    )
    if exists is not None:
        # Same response whether it was the email or the username that collided.
        raise AuthError("already_exists", "email or username already in use", 409)

    # Every account is an administrator.
    #
    # This is a single-operator product: it installs on one machine, its data
    # lives in that user's profile and every service listens on 127.0.0.1. The
    # accounts in it are the same person on different devices, not a tenant
    # with staff, so the old rule - first account admin, the rest ordinary
    # users needing `manage.py promote-admin` from a terminal - only produced
    # an account that could not reach Settings and no way to fix it without a
    # console, which is exactly what this product removed.
    #
    # The authorisation checks stay where they are: Settings still demands the
    # admin role, `require_admin` is untouched, and a caller without it is
    # still refused. What changes is who gets granted the role, not whether it
    # is enforced. An explicit `role=` still wins, so the CLI and the tests can
    # still create a non-admin user on purpose.
    effective_role = role or UserRole.admin

    user = User(
        email=email,
        username=username,
        password_hash=hash_password(password),
        role=effective_role,
        status=UserStatus.active,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        type="auth.register",
        message=f"user registered: {username}",
        actor_id=user.id,
        correlation_id=correlation_id,
        meta={"role": effective_role.value},
        commit=False,
    )
    db.commit()
    db.refresh(user)
    return user


def _issue_tokens(
    db: Session,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    user_agent: str = "",
    client_ip: str = "",
) -> dict:
    settings = get_settings()
    access, ttl = create_access_token(str(user.id), extra={"role": user.role.value})
    raw_refresh = new_refresh_token()
    row = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        family_id=family_id or uuid.uuid4(),
        expires_at=_now() + dt.timedelta(days=settings.refresh_token_ttl_days),
        user_agent=user_agent[:256],
        client_ip=client_ip[:64],
    )
    db.add(row)
    db.flush()
    return {
        "access_token": access,
        "refresh_token": raw_refresh,
        "token_type": "bearer",
        "expires_in": ttl,
        "_row": row,
    }


def login(
    db: Session,
    *,
    identifier: str,
    password: str,
    user_agent: str = "",
    client_ip: str = "",
    correlation_id: str | None = None,
) -> dict:
    ident = identifier.strip().lower()
    user = db.scalar(
        select(User).where(
            (User.email == ident) | (func.lower(User.username) == ident)
        )
    )
    if user is None:
        dummy_verify(password)  # constant-time-ish: no enumeration
        raise AuthError("invalid_credentials", "invalid credentials")
    if not verify_password(password, user.password_hash):
        audit.record(
            db,
            type="auth.login_failed",
            message=f"failed login for {user.username}",
            severity=EventSeverity.warning,
            actor_id=user.id,
            correlation_id=correlation_id,
            meta={"client_ip": client_ip},
        )
        raise AuthError("invalid_credentials", "invalid credentials")
    if user.status != UserStatus.active:
        raise AuthError("account_disabled", "account is not active", 403)

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    user.last_login_at = _now()
    tokens = _issue_tokens(db, user, user_agent=user_agent, client_ip=client_ip)
    audit.record(
        db,
        type="auth.login",
        message=f"login: {user.username}",
        actor_id=user.id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    tokens.pop("_row", None)
    return {"user": user, **tokens}


def refresh(
    db: Session,
    *,
    raw_refresh: str,
    user_agent: str = "",
    client_ip: str = "",
    correlation_id: str | None = None,
) -> dict:
    token_hash = hash_token(raw_refresh)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if row is None:
        raise AuthError("invalid_refresh", "invalid refresh token")

    if row.revoked_at is not None:
        # Re-use of a rotated token => the family is compromised. Kill it all.
        _revoke_family(db, row.family_id, reason="reuse_detected")
        audit.record(
            db,
            type="auth.refresh_reuse",
            message="refresh token reuse detected; family revoked",
            severity=EventSeverity.error,
            actor_id=row.user_id,
            correlation_id=correlation_id,
        )
        raise AuthError("refresh_reuse", "refresh token reuse detected", 401)

    if not row.is_active:
        raise AuthError("expired_refresh", "refresh token expired")

    user = db.get(User, row.user_id)
    if user is None or user.status != UserStatus.active:
        raise AuthError("account_disabled", "account is not active", 403)

    new_tokens = _issue_tokens(
        db, user, family_id=row.family_id, user_agent=user_agent, client_ip=client_ip
    )
    row.revoked_at = _now()
    row.replaced_by = new_tokens["_row"].id
    audit.record(
        db,
        type="auth.refresh",
        message=f"refresh rotated for {user.username}",
        actor_id=user.id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    new_tokens.pop("_row", None)
    return {"user": user, **new_tokens}


def logout(db: Session, *, raw_refresh: str, correlation_id: str | None = None) -> None:
    row = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_refresh))
    )
    if row is None:
        return  # idempotent
    _revoke_family(db, row.family_id, reason="logout")
    audit.record(
        db,
        type="auth.logout",
        message="logout; refresh family revoked",
        actor_id=row.user_id,
        correlation_id=correlation_id,
    )


def _revoke_family(db: Session, family_id: uuid.UUID, *, reason: str) -> None:
    rows = db.scalars(
        select(RefreshToken).where(
            RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    now = _now()
    for r in rows:
        r.revoked_at = now
    db.flush()
