"""N8nService — the only place that talks to the n8n REST API.

Routers call this; they never build n8n requests themselves. Configuration comes
from settings (`AC_N8N_BASE_URL` / `AC_N8N_API_KEY`, also read from the plain
`N8N_API_URL` / `N8N_API_KEY` names). Every failure mode is mapped to a typed
exception so callers can turn it into the right HTTP status.

n8n 1.x public API has no "execute workflow" endpoint. `run_workflow` says so
explicitly (501) rather than pretending; where a workflow has a webhook trigger,
`webhook_paths` surfaces it so the caller can fire that instead.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.services import service_config

log = logging.getLogger("n8n")


class N8nError(Exception):
    def __init__(self, message: str, *, status_code: int = 502, code: str = "n8n_error"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class N8nNotConfigured(N8nError):
    def __init__(self) -> None:
        super().__init__(
            "n8n API key is not configured (set N8N_API_KEY / AC_N8N_API_KEY)",
            status_code=503,
            code="n8n_not_configured",
        )


class N8nUnavailable(N8nError):
    def __init__(self, detail: str) -> None:
        super().__init__(f"n8n is unreachable: {detail}", status_code=502, code="n8n_unavailable")


class N8nAuthError(N8nError):
    def __init__(self, code_: int) -> None:
        super().__init__(
            f"n8n rejected the API key (HTTP {code_})", status_code=502, code="n8n_auth"
        )


class N8nNotFound(N8nError):
    def __init__(self, what: str) -> None:
        super().__init__(f"n8n: {what} not found", status_code=404, code="n8n_not_found")


class N8nUnsupported(N8nError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=501, code="n8n_unsupported")


class N8nService:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        *,
        timeout: float = 12.0,
        transport: httpx.BaseTransport | None = None,
    ):
        s = get_settings()
        self.base_url = (base_url or s.n8n_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else s.n8n_api_key
        self.timeout = httpx.Timeout(timeout)
        self._transport = transport  # tests inject an httpx.MockTransport here

    # -- low level --------------------------------------------------------------

    def _client(self, *, auth: bool = True) -> httpx.AsyncClient:
        headers = {"accept": "application/json"}
        if auth:
            if not self.api_key:
                raise N8nNotConfigured()
            headers["X-N8N-API-KEY"] = self.api_key
        kw: dict[str, Any] = {"base_url": self.base_url, "headers": headers, "timeout": self.timeout}
        if self._transport is not None:
            kw["transport"] = self._transport
        return httpx.AsyncClient(**kw)

    async def _request(self, method: str, path: str, *, auth: bool = True, **kw) -> Any:
        try:
            async with self._client(auth=auth) as c:
                r = await c.request(method, path, **kw)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise N8nUnavailable(f"{type(exc).__name__}") from exc
        except httpx.ReadTimeout as exc:
            raise N8nUnavailable("read timeout") from exc
        except httpx.HTTPError as exc:
            raise N8nUnavailable(str(exc)) from exc

        if r.status_code in (401, 403):
            raise N8nAuthError(r.status_code)
        if r.status_code == 404:
            raise N8nNotFound(f"{method} {path}")
        if r.status_code == 405:
            raise N8nUnsupported(f"n8n does not support {method} {path}")
        if r.status_code >= 500:
            raise N8nError(f"n8n internal error (HTTP {r.status_code})", status_code=502)
        if r.status_code >= 400:
            raise N8nError(f"n8n rejected the request (HTTP {r.status_code}): {r.text[:200]}", status_code=400)
        if not r.content:
            return None
        try:
            return r.json()
        except ValueError:
            return r.text

    # -- public API ----------------------------------------------------------------

    async def health(self) -> dict:
        """`GET {base}/healthz` — no API key needed. Also reports whether a key
        is configured and accepted.

        `status` uses the same vocabulary as the service monitor
        (`services_probe`): not_configured / online / offline. Without an API
        key the integration is not wired up for this environment, so we do not
        probe at all — hitting a Compose hostname that does not resolve would
        report a misleading outage.
        """
        out: dict[str, Any] = {"base_url": self.base_url, "api_key_configured": bool(self.api_key)}
        if not self.api_key:
            out["status"] = "not_configured"
            out["reachable"] = False
            out["detail"] = "n8n API key is not configured (set AC_N8N_API_KEY)"
            return out
        try:
            await self._request("GET", "/healthz", auth=False)
            out["reachable"] = True
            out["status"] = "online"
        except N8nError as exc:
            out["reachable"] = False
            out["status"] = "offline"
            out["detail"] = exc.message
            return out
        try:
            await self._request("GET", "/api/v1/workflows", params={"limit": 1})
            out["api_key_valid"] = True
        except N8nAuthError:
            out["api_key_valid"] = False
        except N8nError as exc:
            out["api_key_valid"] = False
            out["detail"] = exc.message
        return out

    async def list_workflows(self, *, active: bool | None = None, limit: int = 100) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if active is not None:
            params["active"] = str(active).lower()
        data = await self._request("GET", "/api/v1/workflows", params=params)
        return data.get("data", []) if isinstance(data, dict) else (data or [])

    async def get_workflow(self, workflow_id: str) -> dict:
        return await self._request("GET", f"/api/v1/workflows/{workflow_id}")

    async def activate(self, workflow_id: str) -> dict:
        return await self._request("POST", f"/api/v1/workflows/{workflow_id}/activate")

    async def deactivate(self, workflow_id: str) -> dict:
        return await self._request("POST", f"/api/v1/workflows/{workflow_id}/deactivate")

    async def run_workflow(self, workflow_id: str) -> dict:
        """n8n's public API has no execute endpoint. Confirm the workflow exists,
        then explain how to trigger it (webhook or the n8n editor).
        """
        wf = await self.get_workflow(workflow_id)  # raises N8nNotFound if missing
        hooks = self.webhook_paths(wf)
        raise N8nUnsupported(
            "n8n's public API cannot execute a workflow on demand. "
            + (
                f"Trigger it via its webhook: {', '.join(hooks)}"
                if hooks
                else "This workflow has no webhook trigger; run it from the n8n editor "
                "or add a Webhook node."
            )
        )

    async def create_workflow(self, body: dict) -> dict:
        return await self._request("POST", "/api/v1/workflows", json=body)

    async def update_workflow(self, workflow_id: str, body: dict) -> dict:
        return await self._request("PUT", f"/api/v1/workflows/{workflow_id}", json=body)

    async def delete_workflow(self, workflow_id: str) -> dict:
        return await self._request("DELETE", f"/api/v1/workflows/{workflow_id}")

    async def trigger_webhook(self, path: str, payload: dict | None = None) -> dict:
        """POST to a production webhook (the workflow must be active). Used for
        "Run now" on panel-built automations, which compile a secret webhook."""
        data = await self._request("POST", f"/webhook/{path}", auth=False, json=payload or {})
        return data if isinstance(data, dict) else {"message": str(data or "")}

    async def list_executions(
        self, *, workflow_id: str | None = None, status: str | None = None, limit: int = 50
    ) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if workflow_id:
            params["workflowId"] = workflow_id
        if status:
            params["status"] = status  # success | error | waiting
        data = await self._request("GET", "/api/v1/executions", params=params)
        return data.get("data", []) if isinstance(data, dict) else (data or [])

    async def get_execution(self, execution_id: str, *, include_data: bool = False) -> dict:
        return await self._request(
            "GET",
            f"/api/v1/executions/{execution_id}",
            params={"includeData": str(include_data).lower()},
        )

    # -- helpers -----------------------------------------------------------------

    @staticmethod
    def webhook_paths(workflow: dict) -> list[str]:
        out: list[str] = []
        for node in workflow.get("nodes", []) or []:
            if (node.get("type") or "").endswith("webhook"):
                p = (node.get("parameters") or {}).get("path")
                if p:
                    out.append(f"/webhook/{p}")
        return out


def get_n8n_service(db: Session = Depends(get_db)) -> N8nService:
    """FastAPI dependency.

    Resolves the endpoint and API key through `service_config`, so the panel's
    settings drive the Automations pages exactly as they drive the health
    monitor. Without this the two would disagree: the dashboard would show a
    panel-configured n8n as online while these routes still called the address
    baked into the environment.
    """
    resolved = service_config.resolve(db, "n8n")
    return N8nService(base_url=resolved.base_url, api_key=resolved.secret)
