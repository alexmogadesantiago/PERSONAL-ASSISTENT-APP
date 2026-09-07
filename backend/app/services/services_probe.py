"""Liveness and configuration state of every service in the stack.

Every check is real. The database check reuses the application engine (the
connection the app actually depends on), the HTTP services are probed with a
real request, the profile check reads real rows, and the AI check calls the
configured provider for real. Nothing here returns a hard-coded "ONLINE", and no
status is inferred from the mere presence of a table, a row or an environment
variable.

States
------
``online``          reachable and answering (HTTP / TCP services)
``configured``      set up and verified, but not a service you can ping
                    (profile data in Postgres)
``degraded``        reachable but only partly usable - e.g. n8n answers
                    ``/healthz`` yet rejects the API key, or the primary AI
                    provider is down and the fallback is serving
``invalid``         configured with credentials the provider refuses
``offline``         configured, but not responding
``not_configured``  nothing configured for this environment. NOT an error, and
                    deliberately distinct from ``offline``
``unknown``         the probe itself could not run

Where configuration comes from is decided by ``services.service_config``:
the ``service_configs`` table first (written from the web panel), the
environment second. That is why pasting an n8n URL and API key into the panel
turns n8n ``online`` on the next tick with no redeploy.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from dataclasses import dataclass, field

import httpx
from sqlalchemy import text

from app.services import service_config

log = logging.getLogger("services_probe")

ONLINE = "online"
CONFIGURED = "configured"
DEGRADED = "degraded"
INVALID = "invalid"
OFFLINE = "offline"
NOT_CONFIGURED = "not_configured"
UNKNOWN = "unknown"

#: statuses that mean "this service is doing its job"
HEALTHY = frozenset({ONLINE, CONFIGURED})
#: statuses that mean "configured, but something is wrong"
FAULTY = frozenset({OFFLINE, INVALID, DEGRADED})

# Services whose failure means the platform itself is not operational. n8n,
# Playwright, the profile and the AI provider are integrations - their absence
# must not make the whole system look broken.
CRITICAL_SERVICES = frozenset({"postgres"})

SERVICE_ORDER = ("postgres", "n8n", "playwright", "profile", "ai")

_HTTP_TIMEOUT = 5.0


@dataclass
class ServiceState:
    name: str
    kind: str  # db | http | data | provider
    target: str  # host, URL or description - never contains a secret
    status: str
    online: bool | None  # derived from status; kept for API/back-compat
    configured: bool
    detail: str
    latency_ms: float | None
    checked_at: str = ""
    meta: dict = field(default_factory=dict)


def _session_factory():
    """The sessionmaker the probes use.

    Indirected through a function so a probe never captures the engine at import
    time and so tests can point the DB-backed checks (profile, service config)
    at their own database.
    """
    from app.db import SessionLocal

    return SessionLocal


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _state(
    name: str,
    kind: str,
    target: str,
    status: str,
    detail: str,
    latency: float | None,
    *,
    configured: bool | None = None,
    meta: dict | None = None,
) -> ServiceState:
    if status in HEALTHY:
        online: bool | None = True
    elif status in (OFFLINE, INVALID):
        online = False
    else:
        online = None
    if configured is None:
        configured = status not in (NOT_CONFIGURED, UNKNOWN)
    return ServiceState(
        name=name,
        kind=kind,
        target=target,
        status=status,
        online=online,
        configured=bool(configured),
        detail=detail,
        latency_ms=latency,
        checked_at=_now_iso(),
        meta=meta or {},
    )


# --------------------------------------------------------------------- http --


async def _probe_http(
    url: str, *, headers: dict | None = None, timeout: float = _HTTP_TIMEOUT
) -> tuple[int | None, float | None, str]:
    """One real GET. Returns (status_code, latency_ms, detail)."""
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url, headers=headers or {})
        latency = round((time.perf_counter() - started) * 1000, 1)
        return r.status_code, latency, f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        return None, None, f"{type(exc).__name__}: {exc}"


# ----------------------------------------------------------------- postgres --


def _check_database_sync() -> tuple[bool, float | None, str]:
    """Use the application engine - the connection the app really uses."""
    from app.db import engine

    start = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, round((time.perf_counter() - start) * 1000, 1), "SELECT 1 ok"
    except Exception as exc:  # noqa: BLE001 - report, do not crash the probe
        return False, None, f"{type(exc).__name__}: {exc}"


async def _check_database() -> ServiceState:
    ok, latency, detail = await asyncio.to_thread(_check_database_sync)
    return _state(
        "postgres",
        "db",
        "application database",
        ONLINE if ok else OFFLINE,
        detail,
        latency,
        configured=True,
    )


# ---------------------------------------------------------------------- n8n --


async def _check_n8n(resolved: service_config.Resolved) -> ServiceState:
    """Reachability *and* usability.

    ``/healthz`` answering only proves a web server is there. The integration is
    usable when the stored API key is also accepted, so a reachable n8n that
    rejects the key is reported ``degraded``, not ``online`` - the automations
    would fail and a green light would be a lie.
    """
    if not resolved.configured:
        return _state(
            "n8n",
            "http",
            resolved.base_url,
            NOT_CONFIGURED,
            "not configured: " + ", ".join(resolved.missing),
            None,
            configured=False,
            meta={"source": resolved.source, "missing": resolved.missing},
        )

    base = resolved.base_url.rstrip("/")
    code, latency, detail = await _probe_http(f"{base}{resolved.spec.health_path}")
    if code is None or code >= 500:
        return _state(
            "n8n", "http", base, OFFLINE, detail, latency, meta={"source": resolved.source}
        )

    # reachable - now confirm the API key is accepted
    api_code, api_latency, api_detail = await _probe_http(
        f"{base}/api/v1/workflows?limit=1", headers={"X-N8N-API-KEY": resolved.secret}
    )
    if api_code in (401, 403):
        return _state(
            "n8n",
            "http",
            base,
            DEGRADED,
            f"reachable but the API key was rejected (HTTP {api_code})",
            latency,
            meta={"source": resolved.source, "api_key_valid": False},
        )
    if api_code is None:
        return _state(
            "n8n",
            "http",
            base,
            DEGRADED,
            f"/healthz ok but the REST API did not answer ({api_detail})",
            latency,
            meta={"source": resolved.source, "api_key_valid": None},
        )
    if api_code >= 400:
        return _state(
            "n8n",
            "http",
            base,
            DEGRADED,
            f"reachable, REST API returned HTTP {api_code}",
            latency,
            meta={"source": resolved.source, "api_key_valid": None},
        )
    return _state(
        "n8n",
        "http",
        base,
        ONLINE,
        f"{detail}, API key accepted",
        api_latency or latency,
        meta={"source": resolved.source, "api_key_valid": True},
    )


# --------------------------------------------------------------- playwright --


async def _check_playwright(resolved: service_config.Resolved) -> ServiceState:
    if not resolved.configured:
        return _state(
            "playwright",
            "http",
            resolved.base_url,
            NOT_CONFIGURED,
            "not configured: " + ", ".join(resolved.missing),
            None,
            configured=False,
            meta={"source": resolved.source, "missing": resolved.missing},
        )
    base = resolved.base_url.rstrip("/")
    url = f"{base}{resolved.spec.health_path}"
    code, latency, detail = await _probe_http(url)
    if code is not None and 200 <= code < 400:
        return _state("playwright", "http", url, ONLINE, detail, latency, meta={"source": resolved.source})
    return _state("playwright", "http", url, OFFLINE, detail, latency, meta={"source": resolved.source})


# ------------------------------------------------------------------ profile --


def _check_profile_sync() -> tuple[str, str, dict]:
    """Is there a *usable* profile in Postgres?

    A row existing is not enough - `any_complete_profile` requires the minimum
    fields the automations read. Returns aggregate counts only, never content.
    """
    from app.services import profiles as profiles_service

    try:
        with _session_factory()() as db:
            report = profiles_service.any_complete_profile(db)
    except Exception as exc:  # noqa: BLE001 - a probe must never take the app down
        return UNKNOWN, f"profile check failed: {type(exc).__name__}", {}

    status = CONFIGURED if report["configured"] else NOT_CONFIGURED
    meta = {
        "profile_count": report.get("profile_count", 0),
        "complete_profiles": report.get("complete_profiles", 0),
    }
    return status, report["detail"], meta


async def _check_profile() -> ServiceState:
    started = time.perf_counter()
    status, detail, meta = await asyncio.to_thread(_check_profile_sync)
    latency = round((time.perf_counter() - started) * 1000, 1)
    return _state(
        "profile",
        "data",
        "profiles table (postgres)",
        status,
        detail,
        latency if status != UNKNOWN else None,
        configured=status == CONFIGURED,
        meta=meta,
    )


# ----------------------------------------------------------------------- ai --


def _ai_config_sync():
    """Resolve the AI configuration and read the fallback trail in one session.

    A Postgres outage must degrade exactly one tile, not blank the dashboard,
    so a failed session falls back to what the environment alone says (and to
    no fallback history, which is honest: we could not look).
    """
    from app.services.ai import config as ai_config
    from app.services.ai.service import recent_fallback

    try:
        with _session_factory()() as db:
            return ai_config.resolve(db), recent_fallback(db)
    except Exception as exc:  # noqa: BLE001 - a probe must never take the app down
        log.warning(
            "ai config unavailable, falling back to environment: %s", type(exc).__name__
        )
        return ai_config.resolve(None), None


async def _check_ai(*, force: bool = False) -> ServiceState:
    """One tile for the whole AI layer: provider, model and real reachability.

    A stored API key is never treated as proof of anything - the configured
    provider is actually called (a cheap authenticated model listing, which
    costs no tokens) and the verdict is cached for `AC_AI_VERIFY_TTL_SECONDS`
    so the 5-second monitor loop cannot burn provider quota.

    ``degraded`` here has a precise meaning: the primary provider is down but
    the configured fallback answers, so the automations still run.
    """
    from app.services.ai import registry
    from app.services.ai.service import AIService

    config, last_fallback = await asyncio.to_thread(_ai_config_sync)
    service = AIService(config)
    try:
        health = await service.health(force=force)
    except Exception as exc:  # noqa: BLE001
        return _state(
            "ai",
            "provider",
            "ai provider",
            UNKNOWN,
            f"ai probe failed: {type(exc).__name__}",
            None,
            configured=False,
        )

    status = {
        "online": ONLINE,
        "degraded": DEGRADED,
        "invalid": INVALID,
        "offline": OFFLINE,
        "not_configured": NOT_CONFIGURED,
    }.get(health.status, UNKNOWN)

    label = registry.meta(health.provider).label if health.provider else ""
    fallback_label = (
        registry.meta(health.fallback_provider).label if health.fallback_provider else ""
    )
    return _state(
        "ai",
        "provider",
        label or "no provider configured",
        status,
        health.detail,
        health.latency_ms,
        configured=status != NOT_CONFIGURED,
        meta={
            "source": config.source,
            "provider": health.provider,
            "provider_label": label,
            "model": health.model,
            "fallback_provider": health.fallback_provider,
            "fallback_label": fallback_label,
            "fallback_status": health.fallback_status,
            "error": health.error,
            "cached": health.cached,
            # A generation that actually fell back. Deliberately does NOT change
            # `status`: health answers "is the primary reachable now", and a 429
            # ten minutes ago does not make it unreachable now. It is reported
            # alongside so an operator can see it happened at all.
            "last_fallback": last_fallback,
        },
    )


def reset_ai_cache() -> None:
    """Test/force-check helper: forget every memoised provider verdict."""
    from app.services.ai.service import reset_caches

    reset_caches()


# ------------------------------------------------------------------ compose --


def _resolve_all_sync() -> dict[str, service_config.Resolved]:
    """Read the configuration table once per probe run.

    Falls back to environment-only resolution if the database is unreachable,
    so a Postgres outage degrades exactly one service instead of blanking the
    whole dashboard.
    """
    try:
        with _session_factory()() as db:
            return service_config.resolve_all(db)
    except Exception as exc:  # noqa: BLE001
        log.warning("service config unavailable, falling back to environment: %s", type(exc).__name__)
        return service_config.env_only_snapshot()


async def probe_one(resolved: service_config.Resolved, *, force: bool = False) -> ServiceState:
    """Probe a single configurable service.

    Shared by the monitor and by the panel's per-service Test button, so a green
    test and a green dashboard can never disagree.
    """
    checks = {
        "n8n": _check_n8n,
        "playwright": _check_playwright,
    }
    if resolved.spec.category == "ai":
        # Every AI provider row resolves to the one AI tile: what matters is
        # whether the *configured* provider answers, not whether some other
        # provider happens to hold a key.
        return await _check_ai(force=force)
    check = checks.get(resolved.service)
    if check is None:
        raise ValueError(f"service '{resolved.service}' has no standalone probe")
    return await check(resolved)


async def probe_services(*, force: bool = False) -> list[ServiceState]:
    """Probe every service once, concurrently.

    ``force=True`` bypasses cached verdicts - this is what the panel's
    CHECK SERVICES button triggers.
    """
    if force:
        reset_ai_cache()
    resolved = await asyncio.to_thread(_resolve_all_sync)

    results = await asyncio.gather(
        _check_database(),
        _check_n8n(resolved["n8n"]),
        _check_playwright(resolved["playwright"]),
        _check_profile(),
        _check_ai(force=force),
        return_exceptions=True,
    )

    out: list[ServiceState] = []
    for name, result in zip(SERVICE_ORDER, results):
        if isinstance(result, ServiceState):
            out.append(result)
        else:  # a probe raised - surface it, do not crash the endpoint
            log.warning("probe for %s raised %s", name, type(result).__name__)
            out.append(
                _state(name, "http", "", UNKNOWN, f"probe error: {type(result).__name__}", None)
            )
    return out


async def system_status(*, force: bool = False) -> dict:
    services = await probe_services(force=force)

    critical_ok = all(s.status in HEALTHY for s in services if s.name in CRITICAL_SERVICES)
    faulty = [s.name for s in services if s.status in FAULTY]
    operational = critical_ok and not faulty

    return {
        "operational": operational,
        "state": "operational" if operational else "degraded",
        "degraded_services": faulty,
        "not_configured_services": [s.name for s in services if s.status == NOT_CONFIGURED],
        "services": [s.__dict__ for s in services],
        "checked_at": _now_iso(),
    }
