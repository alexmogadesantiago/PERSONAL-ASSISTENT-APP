"""Panel-built automations: stored in `workflows`, deployed to n8n.

The `workflows` table already modelled "the panel's view of an n8n workflow";
it now carries the builder spec in `meta.spec`. A row is the source of truth;
n8n holds a compiled copy (`n8n_workflow_id`) that is rewritten on every save.

If n8n is unreachable the automation is still saved and reported as
"not deployed" with the reason, so editing never depends on n8n being up.
"""
from __future__ import annotations

import datetime as dt
import secrets
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import EventSeverity, Workflow, WorkflowStatus
from app.services import audit
from app.services.automations import actions, catalog, compiler
from app.services.automations import spec as specmod
from app.services.n8n import N8nError, N8nNotFound, get_n8n_service


class AutomationError(Exception):
    def __init__(self, message: str, status_code: int = 400, problems: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.problems = problems or []


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _owned(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID) -> Workflow:
    row = db.scalar(select(Workflow).where(Workflow.id == automation_id, Workflow.user_id == user_id))
    if row is None or not (row.meta or {}).get("spec"):
        raise AutomationError("automation not found", 404)
    return row


def _set_meta(row: Workflow, **changes: Any) -> None:
    meta = dict(row.meta or {})
    meta.update(changes)
    row.meta = meta
    flag_modified(row, "meta")


def view(row: Workflow) -> dict:
    meta = row.meta or {}
    spec = meta.get("spec") or {}
    trig = catalog.get((spec.get("trigger") or {}).get("block", ""))
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description,
        "status": row.status.value,
        "active": row.status == WorkflowStatus.active,
        "origin": meta.get("origin", "builder"),
        "spec": spec,
        "providers": meta.get("providers", []),
        "trigger_label": trig.label if trig else "",
        "deploy": meta.get("deploy", {"status": "pending"}),
        "n8n_workflow_id": row.n8n_workflow_id,
        "last_error": meta.get("last_error"),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_mine(db: Session, user_id: uuid.UUID) -> list[Workflow]:
    rows = db.scalars(select(Workflow).where(Workflow.user_id == user_id).order_by(Workflow.created_at.desc())).all()
    return [r for r in rows if (r.meta or {}).get("spec")]


def _normalise(raw: dict) -> dict:
    try:
        return specmod.normalise(raw)
    except specmod.SpecError as exc:
        raise AutomationError("The automation is not complete yet.", 422, exc.problems)
    except ValueError as exc:  # pydantic
        raise AutomationError(f"Invalid automation: {exc}", 422)


async def _deploy(db: Session, row: Workflow) -> None:
    meta = row.meta or {}
    spec = meta["spec"]
    body, names = compiler.compile_spec(spec, automation_id=str(row.id), webhook_path=meta["webhook_path"])
    n8n = get_n8n_service(db)
    try:
        if row.n8n_workflow_id:
            try:
                await n8n.update_workflow(row.n8n_workflow_id, body)
            except N8nNotFound:
                row.n8n_workflow_id = None
        if not row.n8n_workflow_id:
            created = await n8n.create_workflow(body)
            row.n8n_workflow_id = str(created.get("id"))
        if row.status == WorkflowStatus.active:
            await n8n.activate(row.n8n_workflow_id)
        _set_meta(row, node_names=names, deploy={"status": "deployed", "at": _now_iso(), "error": ""})
    except N8nError as exc:
        _set_meta(row, node_names=names, deploy={"status": "error", "at": _now_iso(), "error": exc.message})
    db.commit()


async def create(db: Session, user_id: uuid.UUID, raw: dict, *, origin: str = "builder") -> Workflow:
    spec = _normalise(raw)
    row = Workflow(
        user_id=user_id, name=spec["name"], description=spec["description"], slug="", category="custom",
        status=WorkflowStatus.inactive,
        meta={"spec": spec, "providers": specmod.providers_of(spec), "services": specmod.services_of(spec),
              "origin": origin, "webhook_path": "pa-" + secrets.token_hex(12), "state": {}},
    )
    db.add(row)
    db.flush()
    audit.record(db, type="automation.create", actor_id=user_id, message=f"automation created: {row.name}",
                 meta={"automation_id": str(row.id), "origin": origin}, commit=False)
    db.commit()
    await _deploy(db, row)
    return row


async def update(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID, raw: dict) -> Workflow:
    row = _owned(db, user_id, automation_id)
    spec = _normalise(raw)
    row.name, row.description = spec["name"], spec["description"]
    old_trigger = ((row.meta or {}).get("spec") or {}).get("trigger")
    state = (row.meta or {}).get("state") or {}
    if old_trigger != spec["trigger"]:
        state = {}  # a new trigger starts with fresh polling memory
    _set_meta(row, spec=spec, providers=specmod.providers_of(spec), services=specmod.services_of(spec), state=state)
    db.commit()
    audit.record(db, type="automation.update", actor_id=user_id, message=f"automation updated: {row.name}",
                 meta={"automation_id": str(row.id)})
    await _deploy(db, row)
    return row


async def redeploy(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID) -> Workflow:
    row = _owned(db, user_id, automation_id)
    await _deploy(db, row)
    return row


async def delete(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID) -> None:
    row = _owned(db, user_id, automation_id)
    if row.n8n_workflow_id:
        try:
            await get_n8n_service(db).delete_workflow(row.n8n_workflow_id)
        except N8nNotFound:
            pass
        except N8nError as exc:
            raise AutomationError(f"n8n could not delete it: {exc.message}", 502)
    name = row.name
    db.delete(row)
    audit.record(db, type="automation.delete", actor_id=user_id, severity=EventSeverity.warning,
                 message=f"automation deleted: {name}", meta={"automation_id": str(automation_id)}, commit=False)
    db.commit()


async def set_active(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID, active: bool) -> Workflow:
    row = _owned(db, user_id, automation_id)
    if not row.n8n_workflow_id or (row.meta or {}).get("deploy", {}).get("status") != "deployed":
        await _deploy(db, row)
    if not row.n8n_workflow_id:
        raise AutomationError("It is saved but not deployed to n8n yet: " +
                              str((row.meta or {}).get("deploy", {}).get("error") or "n8n unavailable"), 503)
    n8n = get_n8n_service(db)
    try:
        if active:
            await n8n.activate(row.n8n_workflow_id)
        else:
            await n8n.deactivate(row.n8n_workflow_id)
    except N8nError as exc:
        raise AutomationError(f"n8n refused: {exc.message}", 502)
    row.status = WorkflowStatus.active if active else WorkflowStatus.inactive
    db.commit()
    audit.record(db, type="automation.activate" if active else "automation.pause", actor_id=user_id,
                 message=f"automation {'activated' if active else 'paused'}: {row.name}",
                 meta={"automation_id": str(row.id)})
    return row


async def duplicate(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID) -> Workflow:
    row = _owned(db, user_id, automation_id)
    spec = dict(row.meta["spec"])
    spec["name"] = f"{spec['name']} (copy)"[:120]
    return await create(db, user_id, spec, origin=(row.meta or {}).get("origin", "builder"))


async def run_now(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID) -> dict:
    row = _owned(db, user_id, automation_id)
    if row.status != WorkflowStatus.active:
        raise AutomationError("Activate the automation to run it in the background, or use Test run.", 409)
    try:
        await get_n8n_service(db).trigger_webhook((row.meta or {})["webhook_path"], {"source": "panel"})
    except N8nError as exc:
        raise AutomationError(f"n8n could not start it: {exc.message}", 502)
    audit.record(db, type="automation.run", actor_id=user_id, message=f"automation run requested: {row.name}",
                 meta={"automation_id": str(row.id)})
    return {"started": True}


# ------------------------------------------------------------- execution ----

def _block_for(spec: dict, step_id: str) -> tuple[catalog.Block, dict]:
    if step_id == "trigger":
        t = spec["trigger"]
        return catalog.get(t["block"]), t.get("params") or {}
    for s in spec.get("steps", []):
        if s["id"] == step_id:
            return catalog.get(s["block"]), s.get("params") or {}
    raise AutomationError(f"unknown step {step_id}", 404)


async def run_step(db: Session, automation_id: uuid.UUID, step_id: str, item: dict) -> list[dict]:
    """Called by n8n (service token). Runs one block for one item."""
    row = db.get(Workflow, automation_id)
    if row is None or not (row.meta or {}).get("spec"):
        raise AutomationError("automation not found", 404)
    meta = row.meta or {}
    block, params = _block_for(meta["spec"], step_id)
    state_all = dict(meta.get("state") or {})
    ctx = actions.Ctx(db=db, user_id=row.user_id, state=dict(state_all.get(step_id) or {}))
    try:
        out = await actions.run(ctx, block.key, params, item if isinstance(item, dict) else {})
    except actions.ActionError as exc:
        _set_meta(row, last_error={"step": step_id, "at": _now_iso(), **exc.as_dict()})
        db.commit()
        raise
    from app.services import usage

    usage.bump(db, "automation_steps")
    if block.kind == "ai":
        usage.bump(db, "ai_requests")
    if block.polling:
        state_all[step_id] = ctx.state
        _set_meta(row, state=state_all)
    if meta.get("last_error"):
        _set_meta(row, last_error=None)
    db.commit()
    return out


async def test_run(db: Session, user_id: uuid.UUID, raw_spec: dict) -> dict:
    """Run the whole chain in-process, step by step, and report each step.

    Real actions are performed (a test message is really sent); polling
    triggers return their latest few items without marking them as seen.
    """
    spec = _normalise(raw_spec)
    report: list[dict] = []
    trig = catalog.get(spec["trigger"]["block"])
    ctx = actions.Ctx(db=db, user_id=user_id, state={}, test=True)

    async def timed(label: str, step_id: str, block: catalog.Block, coro_factory) -> list[dict] | None:
        started = time.perf_counter()
        try:
            out = await coro_factory()
        except actions.ActionError as exc:
            report.append({"step": step_id, "label": label, "block": block.key, "ok": False,
                           "error": exc.as_dict(), "items": 0, "duration_ms": round((time.perf_counter() - started) * 1000)})
            return None
        report.append({"step": step_id, "label": label, "block": block.key, "ok": True, "items": len(out),
                       "sample": _sample(out), "duration_ms": round((time.perf_counter() - started) * 1000)})
        return out

    items = await timed(trig.label, "trigger", trig,
                        lambda: actions.run(ctx, trig.key, spec["trigger"]["params"], {}))
    if items is None:
        return {"ok": False, "steps": report}
    for step in spec["steps"]:
        block = catalog.get(step["block"])
        if not items:
            report.append({"step": step["id"], "label": step["label"], "block": block.key, "ok": True, "items": 0,
                           "skipped": True, "duration_ms": 0})
            continue
        if block.key == "transform.combine":
            snapshot = list(items)
            items = await timed(step["label"], step["id"], block, lambda: _async(actions.combine(snapshot)))
        else:
            current = list(items)

            async def per_item(current=current, step=step, block=block):
                out: list[dict] = []
                for it in current[:5]:  # a test never fans out to dozens of real actions
                    out.extend(await actions.run(ctx, block.key, step["params"], it))
                return out

            items = await timed(step["label"], step["id"], block, per_item)
        if items is None:
            return {"ok": False, "steps": report}
    audit.record(db, type="automation.test", actor_id=user_id, message=f"test run: {spec['name']}",
                 meta={"steps": len(report)})
    return {"ok": True, "steps": report}


async def _async(value):
    return value


def _sample(items: list[dict]) -> dict | None:
    if not items:
        return None
    first = items[0]
    out = {}
    for k, v in first.items():
        if k in ("attachments", "labels", "items"):
            out[k] = f"[{len(v)}]" if isinstance(v, list) else v
            continue
        out[k] = v[:240] + "…" if isinstance(v, str) and len(v) > 240 else v
    return out


# --------------------------------------------------------------- history ----

def _status(ex: dict) -> str:
    s = str(ex.get("status") or "").lower()
    if s in ("success", "succeeded"):
        return "success"
    if s in ("error", "failed", "crashed"):
        return "error"
    if ex.get("finished") is False and not s:
        return "running"
    return s or ("success" if ex.get("finished") else "running")


def _duration_ms(ex: dict) -> int | None:
    try:
        a = dt.datetime.fromisoformat(str(ex["startedAt"]).replace("Z", "+00:00"))
        b = dt.datetime.fromisoformat(str(ex["stoppedAt"]).replace("Z", "+00:00"))
        return int((b - a).total_seconds() * 1000)
    except (KeyError, ValueError, TypeError):
        return None


def summarise_execution(ex: dict) -> dict:
    return {"id": str(ex.get("id")), "status": _status(ex), "started_at": ex.get("startedAt"),
            "finished_at": ex.get("stoppedAt"), "duration_ms": _duration_ms(ex), "mode": ex.get("mode")}


def execution_steps(ex: dict, labels: list[tuple[str, str]]) -> list[dict]:
    """Map n8n's runData (keyed by node name) onto (label, node name) pairs."""
    run_data = (((ex.get("data") or {}).get("resultData") or {}).get("runData")) or {}
    error = (((ex.get("data") or {}).get("resultData") or {}).get("error")) or {}
    out = []
    for label, node in labels:
        runs = run_data.get(node)
        if not runs:
            failed_here = (error.get("node") or {}).get("name") == node
            out.append({"label": label, "node": node, "status": "error" if failed_here else "skipped",
                        "items": 0, "duration_ms": None, "at": None,
                        "error": _human_error(error.get("message", "")) if failed_here else None})
            continue
        last = runs[-1]
        items = sum(len(b or []) for b in ((last.get("data") or {}).get("main") or []))
        err = last.get("error")
        started = last.get("startTime")
        out.append({
            "label": label, "node": node,
            "status": "error" if err else "success",
            "items": items,
            "at": dt.datetime.fromtimestamp(started / 1000, dt.timezone.utc).isoformat()
            if isinstance(started, (int, float)) else None,
            "duration_ms": last.get("executionTime"),
            "error": _human_error((err or {}).get("message", "") + " " + str((err or {}).get("description") or "")) if err else None,
        })
    return out


def _human_error(message: str) -> str:
    """n8n wraps the backend's JSON detail; surface the sentence inside it."""
    import json as _json
    import re

    text = (message or "").strip()
    m = re.search(r"\{.*\}", text)
    if m:
        try:
            body = _json.loads(m.group(0).replace('\\"', '"'))
            detail = body.get("detail", body)
            if isinstance(detail, dict):
                return str(detail.get("message") or detail)
            return str(detail)
        except ValueError:
            pass
    return text[:300]


async def runs(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID, limit: int = 20) -> list[dict]:
    row = _owned(db, user_id, automation_id)
    if not row.n8n_workflow_id:
        return []
    try:
        data = await get_n8n_service(db).list_executions(workflow_id=row.n8n_workflow_id, limit=limit)
    except N8nError as exc:
        raise AutomationError(f"Run history unavailable: {exc.message}", 502)
    return [summarise_execution(e) for e in data]


async def run_detail(db: Session, user_id: uuid.UUID, automation_id: uuid.UUID, execution_id: str) -> dict:
    row = _owned(db, user_id, automation_id)
    try:
        ex = await get_n8n_service(db).get_execution(execution_id, include_data=True)
    except N8nError as exc:
        raise AutomationError(f"Execution unavailable: {exc.message}", 502)
    if str(ex.get("workflowId")) != str(row.n8n_workflow_id):
        raise AutomationError("execution not found", 404)
    meta = row.meta or {}
    names = meta.get("node_names") or {}
    spec = meta["spec"]
    trig = catalog.get(spec["trigger"]["block"])
    labels: list[tuple[str, str]] = []
    if "trigger" in names:
        labels.append((trig.label, names["trigger"]))
    for s in spec["steps"]:
        if s["id"] in names:
            labels.append((s["label"], names[s["id"]]))
    steps = execution_steps(ex, labels)
    from app.services import observability

    failed = next((s for s in steps if s["status"] == "error"), None)
    advice = observability.retry_advice(failed["error"] or "", node=failed["label"]) if failed else None
    return {**summarise_execution(ex), "steps": steps, "diagnosis": advice and advice["diagnosis"],
            "retry_advice": advice and advice["advice"]}
