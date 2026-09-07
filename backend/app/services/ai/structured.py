"""Normalisation of structured (JSON) model output.

The automations depend on a JSON contract - e.g. the email triage returns
``{"categoria", "prioridad", "requiere_accion", "resumen", "evento"}``. Changing
provider must not change that contract, so every provider funnels through here:

* native structured output is used when the provider supports it
  (Gemini ``responseSchema``, OpenRouter ``json_schema``, NIM ``json_object``);
* whatever comes back is then cleaned and parsed by :func:`parse_json_text`,
  which tolerates the ```json fence some models still emit;
* :func:`validate_against_schema` checks only the keys the schema declares
  ``required`` - it is a contract check, not a full JSON Schema validator.
"""
from __future__ import annotations

import json
import re

from app.services.ai.errors import AIInvalidResponse

_FENCE = re.compile(r"^\s*```(?:json|JSON)?\s*(.*?)\s*```\s*$", re.DOTALL)


def strip_code_fence(text: str) -> str:
    """Remove a surrounding ```json ... ``` fence, if present."""
    match = _FENCE.match(text or "")
    return match.group(1) if match else (text or "")


def _first_json_span(text: str) -> str | None:
    """Return the first balanced {...} or [...] span, ignoring braces in strings."""
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start == -1:
            continue
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
    return None


def parse_json_text(text: str, *, provider: str = "") -> dict | list:
    """Parse model output that is supposed to be JSON.

    Raises :class:`AIInvalidResponse` rather than returning a fake empty object,
    so a provider swap that silently degrades output cannot pass unnoticed.
    """
    cleaned = strip_code_fence(text).strip()
    if not cleaned:
        raise AIInvalidResponse("the model returned an empty response", provider=provider)
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        pass
    span = _first_json_span(cleaned)
    if span is not None:
        try:
            return json.loads(span)
        except (ValueError, TypeError):
            pass
    raise AIInvalidResponse("the model response is not valid JSON", provider=provider)


def validate_against_schema(payload: object, schema: dict | None, *, provider: str = "") -> None:
    """Check the required top-level keys the caller asked for.

    Intentionally shallow: the goal is to catch "the new provider dropped a
    field the workflow reads", not to re-implement JSON Schema.
    """
    if not schema or not isinstance(payload, dict):
        return
    required = schema.get("required") or []
    missing = [key for key in required if key not in payload]
    if missing:
        raise AIInvalidResponse(
            f"the model response is missing required field(s): {', '.join(missing)}",
            provider=provider,
        )


_GEMINI_TYPES = {
    "object": "OBJECT",
    "array": "ARRAY",
    "string": "STRING",
    "number": "NUMBER",
    "integer": "INTEGER",
    "boolean": "BOOLEAN",
}


def to_gemini_schema(schema: dict) -> dict:
    """Translate a plain JSON Schema into Gemini's ``responseSchema`` dialect.

    Gemini documents upper-case type names and accepts only a subset of the
    keywords, so anything it does not understand is dropped rather than passed
    through (an unknown keyword makes the whole call fail with HTTP 400).
    """
    if not isinstance(schema, dict):
        return {}
    out: dict = {}
    declared = schema.get("type")
    if isinstance(declared, list):  # ["string", "null"] -> first concrete type
        declared = next((t for t in declared if t != "null"), None)
    if isinstance(declared, str):
        out["type"] = _GEMINI_TYPES.get(declared.lower(), declared.upper())
    if "description" in schema:
        out["description"] = schema["description"]
    if "enum" in schema:
        out["enum"] = [str(v) for v in schema["enum"]]
    props = schema.get("properties")
    if isinstance(props, dict):
        out["properties"] = {k: to_gemini_schema(v) for k, v in props.items()}
    items = schema.get("items")
    if isinstance(items, dict):
        out["items"] = to_gemini_schema(items)
    required = schema.get("required")
    if isinstance(required, list):
        out["required"] = [str(r) for r in required]
    return out


def schema_instruction(schema: dict | None) -> str:
    """Prompt text for providers with no native schema enforcement.

    Used by the NVIDIA NIM path: NIM guarantees *a* JSON object, so the schema
    still has to be described in words for the shape to match.
    """
    if not schema:
        return "Answer with a single valid JSON object and nothing else."
    return (
        "Answer with a single valid JSON object and nothing else - no prose, no "
        "markdown fence. It must conform to this JSON Schema:\n"
        + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    )


__all__ = [
    "parse_json_text",
    "schema_instruction",
    "strip_code_fence",
    "to_gemini_schema",
    "validate_against_schema",
]
