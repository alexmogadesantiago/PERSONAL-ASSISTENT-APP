
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.core.ratelimit import auth_rate_limit
from app.db import get_db
from app.models import User
from app.schemas.auth import (
    LoginIn,
    LogoutIn,
    PasswordChangeIn,
    RefreshIn,
    RegisterIn,
    SessionOut,
    TokenOut,
    UserOut,
)
from app.services import auth as auth_service
from app.services.auth import AuthError

# Rate limiting is a router-level dependency so it can't disturb handler
# signature introspection.
router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(auth_rate_limit)])


def _client(request: Request) -> tuple[str, str]:
    ua = request.headers.get("user-agent", "")
    ip = request.client.host if request.client else ""
    return ua, ip


def _cid(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(request: Request, body: RegisterIn, db: Session = Depends(get_db)) -> TokenOut:
    settings = get_settings()
    if not settings.allow_open_registration and auth_service.user_count(db) > 0:
        raise HTTPException(status_code=403, detail="registration is closed")
    try:
        user = auth_service.register_user(
            db,
            email=body.email,
            username=body.username,
            password=body.password,
            correlation_id=_cid(request),
        )
        ua, ip = _client(request)
        result = auth_service.login(
            db, identifier=user.username, password=body.password, user_agent=ua, client_ip=ip
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return TokenOut(**result)


@router.post("/login", response_model=TokenOut)
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    ua, ip = _client(request)
    try:
        result = auth_service.login(
            db,
            identifier=body.identifier,
            password=body.password,
            user_agent=ua,
            client_ip=ip,
            correlation_id=_cid(request),
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return TokenOut(**result)


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, body: RefreshIn, db: Session = Depends(get_db)) -> TokenOut:
    ua, ip = _client(request)
    try:
        result = auth_service.refresh(
            db,
            raw_refresh=body.refresh_token,
            user_agent=ua,
            client_ip=ip,
            correlation_id=_cid(request),
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return TokenOut(**result)


@router.post("/logout")
def logout(request: Request, body: LogoutIn, db: Session = Depends(get_db)) -> dict:
    auth_service.logout(db, raw_refresh=body.refresh_token, correlation_id=_cid(request))
    return {"revoked": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/password")
def change_password(
    request: Request,
    body: PasswordChangeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    try:
        ended = auth_service.change_password(
            db, user, current=body.current_password, new=body.new_password, correlation_id=_cid(request)
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return {"changed": True, "sessions_revoked": ended}


@router.get("/sessions", response_model=list[SessionOut])
def sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[SessionOut]:
    return [
        SessionOut(
            id=str(r.id),
            created_at=r.created_at.isoformat() if r.created_at else None,
            expires_at=r.expires_at.isoformat() if r.expires_at else None,
            user_agent=r.user_agent[:120],
            client_ip=r.client_ip,
        )
        for r in auth_service.active_sessions(db, user)
    ]
