"""The n8n workflow files must not carry secrets or personal identifiers.

These files are committed, so anything embedded in them is in the repository
history forever. A Telegram chat id was hardcoded in `03-news.json` for several
commits before it was noticed; this suite is what stops that class of mistake
coming back.

Everything a workflow needs at runtime comes from the n8n environment
(`$env.TELEGRAM_CHAT_ID`, `$env.AC_SERVICE_TOKEN`, ...) or from an n8n-stored
credential - never from a literal in the JSON.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

WORKFLOW_DIR = pathlib.Path(__file__).resolve().parents[2] / "workflows"
WORKFLOWS = sorted(WORKFLOW_DIR.glob("*.json"))


def _load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _nodes(path: pathlib.Path):
    return _load(path).get("nodes", [])


def _params_blob(node: dict) -> str:
    return json.dumps(node.get("parameters", {}), ensure_ascii=False)


def test_the_workflow_directory_is_where_we_think_it_is():
    assert WORKFLOWS, f"no workflow JSON found under {WORKFLOW_DIR}"


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_workflow_is_valid_json_with_nodes(path):
    workflow = _load(path)
    assert workflow.get("nodes"), f"{path.name} has no nodes"


# ------------------------------------------------------- personal data ------

#: a Telegram chat id is a bare run of digits; a real one is 6+ long
_CHAT_ID_KEYS = ("chatId", "chat_id")
_BARE_DIGITS = re.compile(r"^\d{6,}$")


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_no_hardcoded_telegram_chat_id(path):
    """The chat id identifies a real person's conversation - it is not config.

    Both node styles are covered: the native Telegram node's `chatId` parameter
    and the HTTP node's `chat_id` inside a JSON body.
    """
    offenders = []
    for node in _nodes(path):
        params = node.get("parameters", {})
        for key in _CHAT_ID_KEYS:
            value = params.get(key)
            if isinstance(value, str) and _BARE_DIGITS.match(value.strip()):
                offenders.append(f"{node['name']}.{key}")
        # the HTTP nodes build the payload as an expression string
        for match in re.finditer(r'chat_?[Ii]d["\']?\s*[:=]\s*["\']?(\d{6,})', _params_blob(node)):
            offenders.append(f"{node['name']} (literal {len(match.group(1))}-digit id)")

    assert not offenders, (
        f"{path.name} hardcodes a Telegram chat id in: {', '.join(offenders)}. "
        "Use $env.TELEGRAM_CHAT_ID instead."
    )


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_chat_id_comes_from_the_environment(path):
    """Whatever supplies the chat id must be an $env reference."""
    for node in _nodes(path):
        blob = _params_blob(node)
        if "chatId" not in blob and "chat_id" not in blob:
            continue
        assert "$env.TELEGRAM_CHAT_ID" in blob, (
            f"{path.name}: node {node['name']!r} sets a chat id without "
            "$env.TELEGRAM_CHAT_ID"
        )


# ---------------------------------------------------------- credentials -----

#: shapes that must never appear as a literal in a committed workflow
_SECRET_SHAPES = {
    "Telegram bot token": r"\d{8,10}:AA[A-Za-z0-9_\-]{20,}",
    "Google AI key": r"AIza[A-Za-z0-9_\-]{20,}",
    "Google AQ token": r"AQ\.[A-Za-z0-9_\-]{20,}",
    "NVIDIA NIM key": r"nvapi-[A-Za-z0-9_\-]{20,}",
    "OpenRouter key": r"sk-or-[A-Za-z0-9_\-]{20,}",
    "automation service token": r"acs_[A-Za-z0-9_\-]{20,}",
}


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_no_credential_literal(path):
    blob = path.read_text(encoding="utf-8")
    for label, pattern in _SECRET_SHAPES.items():
        assert not re.search(pattern, blob), f"{path.name} contains a literal {label}"


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_ai_calls_go_through_the_platform_not_straight_to_a_provider(path):
    """The AI provider is a platform setting, so no workflow may pin one."""
    blob = path.read_text(encoding="utf-8")
    assert "generativelanguage.googleapis.com" not in blob
    assert "GEMINI_API_KEY" not in blob
    for node in _nodes(path):
        url = node.get("parameters", {}).get("url", "")
        if "/api/ai/generate" in url:
            headers = json.dumps(node["parameters"].get("headerParameters", {}))
            assert "X-AC-Service-Token" in headers, (
                f"{path.name}: {node['name']!r} calls the AI API without a service token"
            )


# ------------------------------------------------------------ structure -----


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_connections_point_at_nodes_that_exist(path):
    """A rename that misses `connections` silently detaches half the workflow."""
    workflow = _load(path)
    names = {n["name"] for n in workflow["nodes"]}
    assert len(names) == len(workflow["nodes"]), f"{path.name} has duplicate node names"

    for source, outputs in (workflow.get("connections") or {}).items():
        assert source in names, f"{path.name}: connection from unknown node {source!r}"
        for branch in outputs.get("main", []):
            for link in branch or []:
                assert link["node"] in names, (
                    f"{path.name}: connection to unknown node {link['node']!r}"
                )


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_node_references_resolve(path):
    """`$('Some node')` breaks at runtime if that node was renamed."""
    names = {n["name"] for n in _nodes(path)}
    for node in _nodes(path):
        for referenced in re.findall(r"\$\('([^']+)'\)", _params_blob(node)):
            assert referenced in names, (
                f"{path.name}: {node['name']!r} references missing node {referenced!r}"
            )


# --------------------------------------------------- error handling ---------

ERROR_WORKFLOW_ID = "pa00errorhandler"
ASSISTANTS = [p for p in WORKFLOWS if not p.name.startswith("00-")]
COMPOSE = WORKFLOW_DIR.parent / "docker-compose.yml"


def test_the_error_handler_workflow_exists():
    handler = _load(WORKFLOW_DIR / "00-error-handler.json")
    assert handler["id"] == ERROR_WORKFLOW_ID
    types = {n["type"] for n in handler["nodes"]}
    assert "n8n-nodes-base.errorTrigger" in types
    # it must not name itself as its own error workflow (n8n would loop)
    assert handler["settings"].get("errorWorkflow") in (None, "")
    blob = json.dumps(handler, ensure_ascii=False)
    assert "/api/automations/events" in blob, "failures must reach the panel's activity trail"


@pytest.mark.parametrize("path", ASSISTANTS, ids=lambda p: p.name)
def test_every_assistant_reports_failures_to_the_error_handler(path):
    settings = _load(path).get("settings", {})
    assert settings.get("errorWorkflow") == ERROR_WORKFLOW_ID, (
        f"{path.name}: a failure would only be visible inside n8n"
    )


@pytest.mark.parametrize("path", ASSISTANTS, ids=lambda p: p.name)
def test_every_assistant_validates_its_configuration_first(path):
    """The config check must sit right after every trigger, before any call."""
    wf = _load(path)
    triggers = [n["name"] for n in wf["nodes"] if "trigger" in n["type"].lower()]
    assert triggers
    for t in triggers:
        targets = [l["node"] for b in wf["connections"][t]["main"] for l in b or []]
        firsts = set(targets)
        # the manual Gmail test path goes trigger -> Gmail fetch -> check
        for name in list(firsts):
            node_type = next(n["type"] for n in wf["nodes"] if n["name"] == name)
            if node_type == "n8n-nodes-base.gmail":
                firsts |= {l["node"] for b in wf["connections"][name]["main"] for l in b or []}
        assert "Comprobar configuracion" in firsts, f"{path.name}: {t!r} skips the config check"


#: n8n credentials are per-instance: a reference in committed JSON only works
#: where the user creates that credential. The only ones the product asks the
#: user to create are the Google OAuth pair (see the panel's Credentials page).
_ALLOWED_N8N_CREDENTIALS = {"gmailOAuth2", "googleCalendarOAuth2Api"}


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_only_the_google_oauth_credentials_are_n8n_credentials(path):
    for node in _nodes(path):
        for ctype in (node.get("credentials") or {}):
            assert ctype in _ALLOWED_N8N_CREDENTIALS, (
                f"{path.name}: {node['name']!r} needs n8n credential {ctype!r}; "
                "Telegram and the platform API go through $env so a fresh install works"
            )


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_retry_is_never_combined_with_continue_on_error(path):
    """n8n's retry only fires when the node throws; continue-on-error stops it
    throwing, so the pair silently means 'no retry'."""
    for node in _nodes(path):
        assert not (node.get("retryOnFail") and node.get("onError")), (
            f"{path.name}: {node['name']!r} sets retryOnFail and onError"
        )


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_every_env_var_a_workflow_reads_reaches_n8n(path):
    """`$env.X` with no `X:` in n8n's compose environment is always empty."""
    if not COMPOSE.exists():
        # The backend image's test stage only copies backend/ and workflows/.
        pytest.skip("docker-compose.yml is not in this build context")
    compose = COMPOSE.read_text(encoding="utf-8")
    n8n_block = compose.split("\n  n8n:\n", 1)[1].split("\n  playwright:\n", 1)[0]
    used = set(re.findall(r"\$env\.([A-Z0-9_]+)", path.read_text(encoding="utf-8")))
    # the config check reads its list dynamically ($env[k]); take the keys
    for node in _nodes(path):
        if node["name"] == "Comprobar configuracion":
            block = node["parameters"]["jsCode"].split("const requeridas = {", 1)[1].split("};", 1)[0]
            declared = set(re.findall(r"^\s+([A-Z0-9_]+):", block, re.M))
            assert declared, "config check declares no variables"
            used |= declared
    for var in sorted(used):
        assert re.search(rf"^\s+{var}:", n8n_block, re.M), (
            f"{path.name} reads $env.{var} but docker-compose does not pass it to n8n"
        )
