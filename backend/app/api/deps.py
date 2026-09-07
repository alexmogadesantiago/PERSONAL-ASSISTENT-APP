
import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db import get_db
from app.models import User, UserRole, UserStatus

_bearer = HTTPBearer(auto_error=False, description="Access token from /api/auth/login")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or not creds.credentials:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(creds.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise _UNAUTHORIZED
    user = db.get(User, user_id)
    if user is None or user.status != UserStatus.active:
        raise _UNAUTHORIZED
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Admin-only guard, and an active control.

    It gates every write that changes what the backend connects to: the AI
    provider selection and its credentials, the automation service token, and
    the n8n / Playwright endpoints and keys. Reads stay open to any signed-in
    user, so the Settings page renders for everyone and only saving is refused.

    The role is read from the database on every request (`get_current_user`),
    not from the JWT's `role` claim, so promoting or demoting an account takes
    effect on the token that account already holds. Roles are changed with
    `python -m app.manage promote-admin <user>`; no endpoint writes one.
    """
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")
    return user
