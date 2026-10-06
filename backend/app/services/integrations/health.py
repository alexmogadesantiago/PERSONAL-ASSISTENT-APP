"""Access tokens on demand, and the real connection test.

`access_token()` is the single door to a provider token: it refreshes a token
that is about to expire, persists the new one and keeps the connection's health
truthful (an `invalid_grant` turns the connection EXPIRED, not "error").

`test()` runs the checks the hub shows - authentication, identity, then one
cheap read-only call per granted service - and condenses them into a health
state plus one recommended action. Nothing is inferred: a service that cannot
be probed without a resource id (Sheets, Docs) is reported as "permission
granted", which is exactly what is known about it.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx
from sqlalchemy.orm import Session

from app.models import Credential
from app.services.integrations import connections as conns
from app.services.integrations import http, oauth
from app.services.integrations.providers import Provider


class ConnectionUnavailable(Exception):
    def __init__(self, health: str, message: str, action: str = "reconnect"):
        super().__init__(message)
        self.health = health
        self.message = message
        self.action = action


async def access_token(db: Session, row: Credential, provider: Provider) -> str:
    """A valid access token for this connection, refreshed when needed."""
    secret = conns.secret_of(row)
    if provider.auth == "bot_token":
        return str(secret.get("bot_token") or "")
    if not oauth.expires_soon(secret):
        return str(secret.get("access_token") or "")
    try:
        tokens = await oauth.refresh(db, provider, str(secret.get("refresh_token") or ""), list(row.meta.get("scopes") or []))
    except oauth.OAuthError as exc:
        if exc.code in ("invalid_grant", "unauthorized_client"):
            conns.set_health(db, row, conns.EXPIRED, exc.message)
            raise ConnectionUnavailable(conns.EXPIRED, f"{provider.label} access expired. Reconnect to continue.")
        conns.set_health(db, row, conns.ERROR, exc.message)
        raise ConnectionUnavailable(conns.ERROR, exc.message, "retry")
    conns.update_secret(db, row, tokens.as_secret())
    meta = dict(row.meta or {})
    meta["last_refresh_at"] = conns.iso(conns.now())
    meta["token_expires_at"] = oauth.expiry_iso(tokens.as_secret())
    row.meta = meta
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(row, "meta")
    db.commit()
    return tokens.access_token


# --------------------------------------------------------------------------- #

PROBES: dict[str, dict[str, str]] = {
    "google": {
        "gmail": "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        "calendar": "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1",
        "drive": "https://www.googleapis.com/drive/v3/about?fields=user",
    },
    "microsoft": {
        "outlook": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id",
        "calendar": "https://graph.microsoft.com/v1.0/me/calendar?$select=id",
        "onedrive": "https://graph.microsoft.com/v1.0/me/drive?$select=id",
        "teams": "https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id",
    },
    "github": {
        "notifications": "https://api.github.com/notifications?per_page=1",
        "repos": "https://api.github.com/user/repos?per_page=1",
    },
}


@dataclass
class Check:
    key: str
    label: str
    ok: bool
    detail: str = ""

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "ok": self.ok, "detail": self.detail}


@dataclass
class TestOutcome:
    ok: bool
    health: str
    summary: str
    action: str = ""  # reconnect | manage_permissions | retry | link_chat | ""
    checks: list[Check] = field(default_factory=list)
    latency_ms: float | None = None

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "health": self.health,
            "summary": self.summary,
            "action": self.action,
            "checks": [c.as_dict() for c in self.checks],
            "latency_ms": self.latency_ms,
        }


def _explain(status: int, label: str) -> str:
    if status == 401:
        return "Signed out - the token is no longer accepted"
    if status == 403:
        return f"{label} permission missing or API disabled for this account"
    if status == 404:
        return f"{label} is not available for this account"
    if status == 429:
        return "Rate limited - try again in a minute"
    return f"Unexpected response (HTTP {status})"


async def test(db: Session, row: Credential, provider: Provider) -> TestOutcome:
    started = time.perf_counter()
    if provider.auth == "bot_token":
        from app.services.integrations import telegram

        outcome = await telegram.test(db, row)
    else:
        outcome = await _test_oauth(db, row, provider)
    outcome.latency_ms = round((time.perf_counter() - started) * 1000, 1)
    conns.set_health(
        db, row, outcome.health, outcome.summary, tested=True,
        extra={"last_test": {"ok": outcome.ok, "checks": [c.as_dict() for c in outcome.checks]}},
    )
    return outcome


async def _test_oauth(db: Session, row: Credential, provider: Provider) -> TestOutcome:
    checks: list[Check] = []
    try:
        token = await access_token(db, row, provider)
    except ConnectionUnavailable as exc:
        checks.append(Check("auth", "Authentication", False, exc.message))
        return TestOutcome(False, exc.health, exc.message, exc.action, checks)
    checks.append(Check("auth", "Authentication", True, "Token valid"))

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    ident = await oauth.identity(provider, token)
    if not ident:
        checks.append(Check("identity", "Account", False, "The account could not be read"))
        return TestOutcome(
            False, conns.AUTH_REQUIRED, f"{provider.label} needs you to sign in again.", "reconnect", checks
        )
    checks.append(Check("identity", "Account", True, ident.get("email") or ident.get("login") or ident.get("name", "")))

    granted = provider.services_granted(row.meta.get("scopes") or [])
    wanted = list(row.meta.get("services") or granted)
    failures = 0
    probes = PROBES.get(provider.key, {})
    async with http.client() as c:
        for key in wanted:
            svc = provider.service(key)
            if svc is None:
                continue
            if key not in granted:
                checks.append(Check(key, svc.label, False, "Permission not granted - reconnect and allow it"))
                failures += 1
                continue
            url = probes.get(key)
            if not url:
                checks.append(Check(key, svc.label, True, "Permission granted"))
                continue
            try:
                r = await c.get(url, headers=headers)
            except httpx.HTTPError as exc:
                checks.append(Check(key, svc.label, False, f"Could not reach {svc.label} ({type(exc).__name__})"))
                failures += 1
                continue
            if r.status_code < 300:
                checks.append(Check(key, svc.label, True, "API access OK"))
            else:
                checks.append(Check(key, svc.label, False, _explain(r.status_code, svc.label)))
                failures += 1

    if failures == 0:
        return TestOutcome(True, conns.HEALTHY, "Everything is working correctly.", "", checks)
    if failures == len([c for c in checks if c.key not in ("auth", "identity")]):
        return TestOutcome(False, conns.ERROR, f"None of the {provider.label} services answered.", "manage_permissions", checks)
    return TestOutcome(
        False, conns.DEGRADED,
        f"{failures} service(s) need attention; the rest work.", "manage_permissions", checks,
    )


async def authorized_request(
    db: Session, row: Credential, provider: Provider, method: str, url: str, **kw
) -> httpx.Response:
    """Call a provider API as the user, retrying once after a 401 refresh."""
    token = await access_token(db, row, provider)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", **kw.pop("headers", {})}
    async with http.client() as c:
        r = await c.request(method, url, headers=headers, **kw)
        if r.status_code == 401 and provider.auth == "oauth2":
            # The provider may revoke early; force one refresh.
            secret = conns.secret_of(row)
            secret["expires_at"] = 0
            conns.update_secret(db, row, secret)
            token = await access_token(db, row, provider)
            headers["Authorization"] = f"Bearer {token}"
            r = await c.request(method, url, headers=headers, **kw)
    if r.status_code == 401:
        conns.set_health(db, row, conns.AUTH_REQUIRED, "The provider rejected the token")
        raise ConnectionUnavailable(conns.AUTH_REQUIRED, f"{provider.label} needs you to sign in again.")
    conns.touch_used(db, row)
    return r

