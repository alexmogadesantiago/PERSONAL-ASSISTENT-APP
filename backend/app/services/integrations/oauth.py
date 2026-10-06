"""OAuth 2.0 authorization-code flow with PKCE, for Google, Microsoft and GitHub.

    panel  --POST /connect-->  backend: build authorize URL (+ sealed state)
    browser --> provider consent screen --> /api/integrations/<p>/callback
    backend: open state, exchange code (+ verifier), read identity, store tokens
    backend --302--> panel /integrations/<p>?connected=1

The `state` is a Fernet token (see `crypto.seal`): it binds the flow to the
user who started it, carries the PKCE verifier without exposing it, and expires
after ten minutes. A state is accepted once.

The OAuth *app* (client id + secret) is admin configuration: `service_configs`
row `<provider>_oauth` (panel, wins) or `AC_<PROVIDER>_OAUTH_CLIENT_*` (env).
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import crypto
from app.services import service_config
from app.services.integrations import http
from app.services.integrations.providers import Provider

STATE_TTL_SECONDS = 600
#: states already redeemed (single process: the backend runs one worker)
_used_states: dict[str, float] = {}


class OAuthError(Exception):
    """A failure the user can act on. `code` is stable, `message` is human."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class OAuthApp:
    client_id: str
    client_secret: str
    source: str  # database | environment | none

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)


def app_for(db: Session | None, provider: Provider) -> OAuthApp:
    if not provider.oauth_app:
        return OAuthApp("", "", "none")
    resolved = service_config.resolve(db, provider.oauth_app)
    settings = get_settings()
    env_id = str(getattr(settings, f"{provider.key}_oauth_client_id", "") or "").strip()
    client_id = str(resolved.meta.get("client_id") or "").strip() or env_id
    source = resolved.source
    if source == service_config.NONE and client_id:
        source = service_config.ENVIRONMENT
    return OAuthApp(client_id=client_id, client_secret=resolved.secret, source=source)


def redirect_uri(provider: Provider) -> str:
    return f"{get_settings().public_api_base}/api/integrations/{provider.key}/callback"


def _endpoint(url: str) -> str:
    return url.replace("{tenant}", get_settings().microsoft_oauth_tenant or "common")


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def authorize_url(
    db: Session, provider: Provider, user_id: uuid.UUID, services: list[str], return_to: str = ""
) -> str:
    app = app_for(db, provider)
    if not app.configured:
        raise OAuthError(
            "app_not_configured",
            f"{provider.label} sign-in is not set up yet. An administrator has to add the "
            "OAuth app once (Integrations → Advanced setup).",
            409,
        )
    unknown = [s for s in services if provider.service(s) is None]
    if unknown:
        raise OAuthError("unknown_service", f"unknown service: {', '.join(unknown)}")
    if not services:
        services = list(provider.default_services)
    verifier, challenge = _pkce_pair()
    state = crypto.seal({
        "u": str(user_id),
        "p": provider.key,
        "s": services,
        "v": verifier,
        "n": secrets.token_hex(8),
        "r": return_to[:200] if return_to.startswith("/") else "",
    })
    params = {
        "client_id": app.client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri(provider),
        "scope": provider.scope_separator.join(provider.scopes_for(services)),
        "state": state,
        **provider.extra_authorize_params,
    }
    if provider.pkce:
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    return f"{_endpoint(provider.authorize_url)}?{urlencode(params)}"


@dataclass
class PendingFlow:
    user_id: uuid.UUID
    services: list[str]
    verifier: str
    return_to: str


def open_state(provider: Provider, state: str) -> PendingFlow:
    try:
        data = crypto.open_sealed(state, ttl_seconds=STATE_TTL_SECONDS)
    except (crypto.DecryptionError, crypto.CipherNotConfigured):
        raise OAuthError("invalid_state", "This sign-in link expired or was already used. Start again.")
    if data.get("p") != provider.key:
        raise OAuthError("invalid_state", "This sign-in link belongs to another service.")
    nonce = str(data.get("n", ""))
    now = time.time()
    for k, at in list(_used_states.items()):
        if now - at > STATE_TTL_SECONDS:
            _used_states.pop(k, None)
    if nonce in _used_states:
        raise OAuthError("invalid_state", "This sign-in link was already used. Start again.")
    _used_states[nonce] = now
    return PendingFlow(uuid.UUID(data["u"]), list(data.get("s") or []), data["v"], data.get("r") or "")


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str
    expires_at: float | None
    scopes: list[str]
    token_type: str = "Bearer"

    def as_secret(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "token_type": self.token_type,
        }


def _token_set(body: dict, provider: Provider, requested: list[str], previous_refresh: str = "") -> TokenSet:
    if "error" in body:
        code = str(body.get("error"))
        raise OAuthError(
            code,
            {
                "invalid_grant": f"{provider.label} rejected the authorization (expired or revoked). Reconnect.",
                "access_denied": "Access was not granted.",
                "bad_verification_code": "The sign-in code expired. Start again.",
                "incorrect_client_credentials": f"The {provider.label} OAuth app credentials are wrong (Advanced setup).",
                "invalid_client": f"The {provider.label} OAuth app credentials are wrong (Advanced setup).",
            }.get(code, f"{provider.label} returned an error: {body.get('error_description') or code}"),
        )
    access = str(body.get("access_token") or "")
    if not access:
        raise OAuthError("no_token", f"{provider.label} did not return an access token.")
    expires_in = body.get("expires_in")
    raw_scope = body.get("scope")
    if isinstance(raw_scope, str) and raw_scope.strip():
        sep = "," if provider.key == "github" else " "
        scopes = [s.strip() for s in raw_scope.split(sep) if s.strip()]
    else:
        scopes = list(requested)
    return TokenSet(
        access_token=access,
        refresh_token=str(body.get("refresh_token") or previous_refresh or ""),
        expires_at=(time.time() + float(expires_in)) if expires_in else None,
        scopes=scopes,
        token_type=str(body.get("token_type") or "Bearer"),
    )


async def _post_token(provider: Provider, data: dict) -> dict:
    try:
        async with http.client() as c:
            r = await c.post(_endpoint(provider.token_url), data=data, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise OAuthError("network", f"Could not reach {provider.label}: {type(exc).__name__}", 502)
    try:
        body = r.json()
    except ValueError:
        raise OAuthError("bad_response", f"{provider.label} sent an unreadable token response (HTTP {r.status_code}).", 502)
    if r.status_code >= 400 and "error" not in body:
        body = {"error": f"http_{r.status_code}"}
    return body


async def exchange_code(db: Session, provider: Provider, code: str, flow: PendingFlow) -> TokenSet:
    app = app_for(db, provider)
    if not app.configured:
        raise OAuthError("app_not_configured", f"{provider.label} sign-in is not set up.", 409)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri(provider),
        "client_id": app.client_id,
        "client_secret": app.client_secret,
    }
    if provider.pkce:
        data["code_verifier"] = flow.verifier
    body = await _post_token(provider, data)
    return _token_set(body, provider, provider.scopes_for(flow.services))


async def refresh(db: Session, provider: Provider, refresh_token: str, scopes: list[str]) -> TokenSet:
    app = app_for(db, provider)
    if not refresh_token:
        raise OAuthError("invalid_grant", f"{provider.label} needs you to sign in again.", 401)
    body = await _post_token(provider, {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": app.client_id,
        "client_secret": app.client_secret,
    })
    return _token_set(body, provider, scopes, previous_refresh=refresh_token)


async def revoke(provider: Provider, token: str) -> None:
    """Best effort: a failed revoke never blocks disconnecting locally."""
    if not provider.revoke_url or not token:
        return
    try:
        async with http.client() as c:
            await c.post(provider.revoke_url, data={"token": token})
    except httpx.HTTPError:
        pass


IDENTITY_URLS = {
    "google": "https://openidconnect.googleapis.com/v1/userinfo",
    "microsoft": "https://graph.microsoft.com/v1.0/me",
    "github": "https://api.github.com/user",
}


async def identity(provider: Provider, access_token: str) -> dict:
    """Who the token belongs to, reduced to what the hub shows."""
    url = IDENTITY_URLS.get(provider.key)
    if not url:
        return {}
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    try:
        async with http.client() as c:
            r = await c.get(url, headers=headers)
    except httpx.HTTPError:
        return {}
    if r.status_code != 200:
        return {}
    b = r.json()
    if provider.key == "google":
        return {"email": b.get("email", ""), "name": b.get("name", ""), "avatar": b.get("picture", "")}
    if provider.key == "microsoft":
        return {"email": b.get("mail") or b.get("userPrincipalName", ""), "name": b.get("displayName", ""), "avatar": ""}
    return {"email": b.get("email") or "", "name": b.get("name") or b.get("login", ""),
            "login": b.get("login", ""), "avatar": b.get("avatar_url", "")}


def expires_soon(secret: dict, margin_seconds: int = 90) -> bool:
    exp = secret.get("expires_at")
    return bool(exp) and float(exp) - time.time() < margin_seconds


def expiry_iso(secret: dict) -> str | None:
    exp = secret.get("expires_at")
    if not exp:
        return None
    return dt.datetime.fromtimestamp(float(exp), dt.timezone.utc).isoformat()
