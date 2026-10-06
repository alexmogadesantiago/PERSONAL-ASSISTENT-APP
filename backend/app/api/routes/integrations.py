"""Integrations Hub API.

    GET    /api/integrations                     every provider + the user's connection
    GET    /api/integrations/{p}                 one provider
    POST   /api/integrations/{p}/connect         -> {authorization_url}   (OAuth)
    GET    /api/integrations/{p}/callback        provider redirect target (public)
    POST   /api/integrations/{p}/test            real connection test
    DELETE /api/integrations/{p}                 disconnect (+ revoke at the provider)
    POST   /api/integrations/telegram/token      save + validate a bot token
    POST   /api/integrations/telegram/link       has the user pressed Start yet?
    POST   /api/integrations/telegram/link/reset new link code
    POST   /api/integrations/telegram/test-message
    GET/PUT /api/integrations/{p}/app            OAuth app (admin: Advanced setup)

No response contains a token, a client secret or a refresh token.
"""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.config import get_settings
from app.core import crypto
from app.db import get_db
from app.models import EventSeverity, User
from app.services import audit, service_config
from app.services.integrations import connections as conns
from app.services.integrations import health, hub, oauth, providers, telegram

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _provider(key: str) -> providers.Provider:
    p = providers.get(key)
    if p is None:
        raise HTTPException(404, detail=f"unknown integration '{key}'")
    return p


def _cid(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


def _require_store():
    if not crypto.is_configured():
        raise HTTPException(503, detail="The credential store is not configured (AC_CREDENTIAL_ENCRYPTION_KEY).")


@router.get("")
def list_integrations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"data": hub.overview(db, user.id), "store_configured": crypto.is_configured()}


@router.get("/{key}")
def get_integration(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return hub.provider_view(db, user.id, _provider(key))


class ConnectIn(BaseModel):
    services: list[str] = Field(default_factory=list, max_length=10)
    return_to: str = Field(default="", max_length=200)


@router.post("/{key}/connect")
def connect(key: str, body: ConnectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _provider(key)
    if p.auth != "oauth2":
        raise HTTPException(400, detail=f"{p.label} connects with a token, not a sign-in.")
    _require_store()
    try:
        url = oauth.authorize_url(db, p, user.id, body.services, body.return_to)
    except oauth.OAuthError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code, "message": exc.message})
    return {"authorization_url": url, "redirect_uri": oauth.redirect_uri(p)}


@router.get("/{key}/callback", include_in_schema=False)
async def callback(
    key: str,
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    """Where the provider sends the browser back. Never renders a page: it
    always redirects to the panel with `connected=1` or an error code."""
    p = _provider(key)
    app_base = get_settings().public_app_base

    def back(params: str, return_to: str = "") -> RedirectResponse:
        target = return_to if return_to.startswith("/") else f"/integrations/{p.key}"
        sep = "&" if "?" in target else "?"
        return RedirectResponse(f"{app_base}{target}{sep}{params}", status_code=302)

    if error:
        return back(f"error={quote(error)}")
    if not code or not state:
        return back("error=missing_code")
    try:
        flow = oauth.open_state(p, state)
        tokens = await oauth.exchange_code(db, p, code, flow)
        ident = await oauth.identity(p, tokens.access_token)
        user = db.get(User, flow.user_id)
        if user is None:
            raise oauth.OAuthError("invalid_state", "The account that started this sign-in no longer exists.")
        granted = p.services_granted(tokens.scopes)
        conns.save(
            db, user.id, p, secret=tokens.as_secret(),
            meta={
                "account": ident,
                "scopes": tokens.scopes,
                "services": flow.services,
                "has_refresh_token": bool(tokens.refresh_token),
                "token_expires_at": oauth.expiry_iso(tokens.as_secret()),
                "last_refresh_at": conns.iso(conns.now()),
                "health_detail": "",
            },
            health=conns.HEALTHY if set(flow.services) <= set(granted) else conns.DEGRADED,
            correlation_id=_cid(request),
        )
    except oauth.OAuthError as exc:
        audit.record(db, type="integration.connect_failed", severity=EventSeverity.warning,
                     message=f"{p.label} sign-in failed: {exc.message}", meta={"provider": p.key, "code": exc.code})
        return back(f"error={quote(exc.code)}&message={quote(exc.message)}")
    return back("connected=1", flow.return_to)


@router.post("/{key}/test")
async def test(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _provider(key)
    row = conns.get(db, user.id, p.key)
    if row is None:
        raise HTTPException(404, detail=f"{p.label} is not connected")
    outcome = await health.test(db, row, p)
    audit.record(db, type="integration.test", actor_id=user.id,
                 severity=EventSeverity.info if outcome.ok else EventSeverity.warning,
                 message=f"{p.label} connection test: {outcome.health}",
                 meta={"provider": p.key, "health": outcome.health})
    return outcome.as_dict()


@router.get("/{key}/dependencies")
def dependencies(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return hub.dependencies(db, user.id, _provider(key))


@router.delete("/{key}")
async def disconnect(key: str, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _provider(key)
    row = conns.get(db, user.id, p.key)
    if row is None:
        raise HTTPException(404, detail=f"{p.label} is not connected")
    if p.auth == "oauth2":
        try:
            secret = conns.secret_of(row)
            await oauth.revoke(p, str(secret.get("refresh_token") or secret.get("access_token") or ""))
        except crypto.DecryptionError:
            pass
    conns.disconnect(db, user.id, p, correlation_id=_cid(request))
    return {"disconnected": True}


# ------------------------------------------------------------- Telegram ----

class BotTokenIn(BaseModel):
    bot_token: str = Field(min_length=10, max_length=200)


@router.post("/telegram/token")
async def telegram_token(body: BotTokenIn, request: Request, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    _require_store()
    try:
        row = await telegram.connect(db, user.id, body.bot_token, correlation_id=_cid(request))
    except telegram.TelegramError as exc:
        raise HTTPException(exc.status_code if exc.status_code < 500 else 502, detail=exc.message)
    return hub.provider_view(db, user.id, providers.TELEGRAM) | {"link_url": telegram.link_url(row)}


def _telegram_row(db: Session, user: User):
    row = conns.get(db, user.id, "telegram")
    if row is None:
        raise HTTPException(404, detail="Telegram is not connected")
    return row


@router.post("/telegram/link")
async def telegram_link(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _telegram_row(db, user)
    try:
        linked = await telegram.check_link(db, row)
    except telegram.TelegramError as exc:
        raise HTTPException(exc.status_code if exc.status_code < 500 else 502, detail=exc.message)
    return {"linked": linked, "chat": (row.meta or {}).get("chat"), "link_url": telegram.link_url(row)}


@router.post("/telegram/link/reset")
def telegram_link_reset(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _telegram_row(db, user)
    telegram.new_link_code(db, row)
    return {"link_url": telegram.link_url(row)}


@router.post("/telegram/test-message")
async def telegram_test_message(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _telegram_row(db, user)
    try:
        await telegram.send(db, row, "👋 <b>Test from Personal Assistant</b>\nYour notifications channel works.")
    except telegram.TelegramError as exc:
        raise HTTPException(exc.status_code if exc.status_code < 500 else 502, detail=exc.message)
    return {"sent": True}


# ---------------------------------------------------- OAuth app (admin) ----

def _app_view(db: Session, p: providers.Provider) -> dict:
    resolved = service_config.resolve(db, p.oauth_app)
    app = oauth.app_for(db, p)
    return {
        "provider": p.key,
        "client_id": app.client_id,
        "client_secret_configured": bool(app.client_secret),
        "client_secret_hint": resolved.secret_hint,
        "source": app.source,
        "configured": app.configured,
        "redirect_uri": oauth.redirect_uri(p),
        "console_url": p.console_url,
        "docs_url": p.docs_url,
        "scopes": p.scopes_for([s.key for s in p.services]),
    }


@router.get("/{key}/app")
def get_app(key: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _provider(key)
    if p.auth != "oauth2":
        raise HTTPException(400, detail=f"{p.label} has no OAuth app")
    return _app_view(db, p)


class AppIn(BaseModel):
    client_id: str = Field(min_length=4, max_length=300)
    client_secret: str | None = Field(default=None, max_length=500)


@router.put("/{key}/app")
def put_app(key: str, body: AppIn, request: Request, admin: User = Depends(require_admin),
            db: Session = Depends(get_db)):
    p = _provider(key)
    if p.auth != "oauth2":
        raise HTTPException(400, detail=f"{p.label} has no OAuth app")
    current = service_config.resolve(db, p.oauth_app)
    try:
        service_config.upsert(
            db, p.oauth_app,
            secret=body.client_secret if body.client_secret else None,
            meta={**current.meta, "client_id": body.client_id.strip()},
            actor_id=admin.id,
        )
    except service_config.ServiceConfigError as exc:
        raise HTTPException(exc.status_code, detail=exc.message)
    audit.record(db, type="integration.app_update", actor_id=admin.id, correlation_id=_cid(request),
                 message=f"{p.label} OAuth app updated", meta={"provider": p.key,
                                                             "secret_rotated": bool(body.client_secret)})
    return _app_view(db, p)
