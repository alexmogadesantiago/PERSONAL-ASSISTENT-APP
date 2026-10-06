"""The automation spec: what the builder edits and the compiler reads.

    {
      "name": "Invoice processing",
      "description": "...",
      "trigger": {"block": "gmail.new_email", "params": {"query": "has:attachment invoice"}},
      "steps": [
        {"id": "s1", "block": "ai.extract", "params": {"fields": "amount, vendor"}},
        {"id": "s2", "block": "drive.save_text", "params": {...}},
        {"id": "s3", "block": "telegram.send", "params": {"message": "Invoice from {{from}}"}}
      ]
    }

Validation is strict and explains itself: unknown blocks, a step used as a
trigger, missing required params and out-of-range options are all reported
with the step they belong to. Params are coerced to their declared type and
anything the catalogue does not declare is dropped, so nothing unexpected ever
reaches n8n or a provider API.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from app.services.automations import catalog

MAX_STEPS = 12
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


class TriggerIn(BaseModel):
    block: str
    params: dict[str, Any] = Field(default_factory=dict)


class StepIn(BaseModel):
    id: str = Field(default="", max_length=16)
    block: str
    params: dict[str, Any] = Field(default_factory=dict)
    label: str = Field(default="", max_length=80)


class SpecIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    trigger: TriggerIn
    steps: list[StepIn] = Field(default_factory=list, max_length=MAX_STEPS)


class SpecError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _coerce(param: catalog.Param, value: Any) -> Any:
    if value is None or value == "":
        return param.default
    if param.type == "number":
        try:
            return int(value) if float(value).is_integer() else float(value)
        except (TypeError, ValueError):
            return param.default
    if param.type == "bool":
        return value in (True, "true", "1", 1, "yes")
    text = str(value)
    limit = 4000 if param.type == "textarea" else 500
    return text[:limit]


def _clean_params(block: catalog.Block, params: dict, where: str, problems: list[str]) -> dict:
    out: dict = {}
    for p in block.params:
        value = _coerce(p, params.get(p.key))
        if p.required and (value is None or str(value).strip() == ""):
            problems.append(f"{where}: «{p.label}» is required")
        if p.options and value not in (None, "") and str(value) not in {v for v, _ in p.options}:
            problems.append(f"{where}: «{p.label}» must be one of {', '.join(v for v, _ in p.options)}")
        if p.type == "time" and value and not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", str(value)):
            problems.append(f"{where}: «{p.label}» must look like 08:30")
        out[p.key] = value
    return out


def normalise(raw: dict | SpecIn) -> dict:
    spec = raw if isinstance(raw, SpecIn) else SpecIn.model_validate(raw)
    problems: list[str] = []

    trig = catalog.get(spec.trigger.block)
    if trig is None or trig.kind != "trigger":
        problems.append(f"trigger: «{spec.trigger.block}» is not a trigger")
        trigger = {"block": spec.trigger.block, "params": {}}
    else:
        trigger = {"block": trig.key, "params": _clean_params(trig, spec.trigger.params, "trigger", problems)}

    steps = []
    seen_ids: set[str] = set()
    for i, s in enumerate(spec.steps, start=1):
        block = catalog.get(s.block)
        sid = re.sub(r"[^a-z0-9]", "", (s.id or "").lower())[:12] or f"s{i}"
        while sid in seen_ids:
            sid = f"{sid}{i}"
        seen_ids.add(sid)
        where = f"step {i}"
        if block is None or block.kind == "trigger":
            problems.append(f"{where}: «{s.block}» is not a step")
            continue
        steps.append({
            "id": sid,
            "block": block.key,
            "label": s.label.strip() or block.label,
            "params": _clean_params(block, s.params, where, problems),
        })
    if not steps:
        problems.append("add at least one step after the trigger")
    if problems:
        raise SpecError(problems)
    return {"name": spec.name.strip(), "description": spec.description.strip(), "trigger": trigger, "steps": steps}


def providers_of(spec: dict) -> list[str]:
    keys = [spec["trigger"]["block"]] + [s["block"] for s in spec.get("steps", [])]
    out: list[str] = []
    for k in keys:
        b = catalog.get(k)
        if b and b.provider and b.provider not in out:
            out.append(b.provider)
    return out


def services_of(spec: dict) -> dict[str, list[str]]:
    """{provider: [service, ...]} - what the connections must have granted."""
    out: dict[str, list[str]] = {}
    for k in [spec["trigger"]["block"]] + [s["block"] for s in spec.get("steps", [])]:
        b = catalog.get(k)
        if b and b.provider and b.service:
            out.setdefault(b.provider, [])
            if b.service not in out[b.provider]:
                out[b.provider].append(b.service)
    return out


# ---------------------------------------------------------------- templates --

def lookup(item: dict, path: str) -> Any:
    cur: Any = item
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            return "\n".join(
                "• " + str(v.get("subject") or v.get("title") or v.get("summary") or v.get("text") or "")
                for v in value
            )
        return ", ".join(str(v) for v in value)
    if isinstance(value, dict):
        return ", ".join(f"{k}: {v}" for k, v in value.items())
    return str(value)


def render(template: Any, item: dict) -> str:
    """Fill {{field}} placeholders from the item. Missing fields become ''."""
    if template is None:
        return ""
    return _PLACEHOLDER.sub(lambda m: _stringify(lookup(item, m.group(1))), str(template))
