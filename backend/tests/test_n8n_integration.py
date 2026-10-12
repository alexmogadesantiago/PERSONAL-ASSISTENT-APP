"""Live integration test against the real n8n in the stack.

Opt-in: needs a real n8n API key. Run with
    AC_N8N_BASE_URL=http://localhost:5678 AC_N8N_API_KEY=<key> \
      pytest -m integration tests/test_n8n_integration.py
It only reads (list workflows, list executions); it never modifies a workflow.
"""
from __future__ import annotations

import os

import pytest

from app.services.n8n import N8nService

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def svc() -> N8nService:
    # conftest.py keeps these aside (PA_LIVE_*) before it scrubs AC_N8N_* for
    # the hermetic unit suite.
    key = os.getenv("PA_LIVE_N8N_API_KEY")
    if not key:
        pytest.skip("no n8n API key (set AC_N8N_API_KEY) — live n8n test skipped")
    base = os.getenv("PA_LIVE_N8N_BASE_URL") or "http://localhost:5678"
    return N8nService(base_url=base, api_key=key)


async def test_health_live(svc):
    out = await svc.health()
    assert out["reachable"] is True
    assert out["api_key_valid"] is True


async def test_can_read_the_four_existing_workflows(svc):
    workflows = await svc.list_workflows(limit=100)
    names = {w["name"] for w in workflows}
    expected = {
        "Asistente - Noticias",
        "Asistente - Laboral",
        "Asistente - Marca Personal",
        "Asistente - Email",
    }
    missing = expected - names
    assert not missing, f"n8n API cannot see: {missing}. present: {names}"


async def test_executions_endpoint_is_readable(svc):
    # may be empty; we only assert the call succeeds and returns a list
    assert isinstance(await svc.list_executions(limit=5), list)
