"""Results produced by the four automations, read back out of n8n.

None of the pipelines persists what it produces: `Asistente - Email` ends in
Telegram and Google Calendar, `Laboral` and `Noticias` end in Telegram, and
`Marca Personal` writes a `.md` file. The content itself survives only inside
n8n's own execution store (`execution_data`), which keeps the full item stream
of every run.

This module turns that store into something the assistant can read:

* it knows, per module, which node carries the *result* (not the 106 raw RSS
  items, but the five that were normalised and summarised);
* it projects a fixed whitelist of fields, so a correo never contributes more
  than its sender, subject and date - the body is never read;
* it truncates long strings and caps the number of items, because a single
  Noticias execution is ~450 kB and none of that belongs in a prompt;
* it caches for a couple of minutes, so a conversation does not re-download the
  same executions on every question.

Nothing here writes to n8n, and nothing here invents data: if a node is missing
(renamed in n8n, or the run produced nothing) the module reports zero items and
says why, rather than filling the gap.
"""
from __future__ import annotations

import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

import logging

from app.services.n8n import N8nError, N8nService

log = logging.getLogger("pipelines")

#: How long a module's extracted result stays warm. Short enough that a run
#: finishing mid-conversation shows up quickly.
CACHE_TTL_SECONDS = 120.0

#: Executions inspected per request. Each one costs a full `includeData` fetch,
#: so this is the main performance dial.
DEFAULT_SCAN = 4
MAX_SCAN = 10

#: Items returned per request, and how much text each field may carry.
DEFAULT_LIMIT = 12
MAX_LIMIT = 40
MAX_FIELD_CHARS = 600

#: Items held in memory while ranking, before `limit` is applied. A Noticias
#: run yields ~106, so four runs stay comfortably under this. Only `limit` of
#: them ever reach the model.
HARD_ITEM_CEILING = 600


@dataclass(frozen=True)
class NodeSource:
    """One candidate node inside a workflow, and what may be taken from it."""

    #: Node names in preference order; the first one present wins.
    nodes: tuple[str, ...]
    #: The only fields copied out. Anything else in the item is dropped.
    fields: tuple[str, ...]


@dataclass(frozen=True)
class ModuleSpec:
    key: str
    label: str
    #: Lowercase fragments that identify the workflow by name in n8n.
    aliases: tuple[str, ...]
    #: Tried in order; the first source that yields items is used.
    sources: tuple[NodeSource, ...]
    description: str
    #: Documented reason for a narrow projection, shown by the API.
    privacy_note: str = ""
    #: Fields searched by `q`.
    searchable: tuple[str, ...] = field(default_factory=tuple)


MODULES: dict[str, ModuleSpec] = {
    "correos": ModuleSpec(
        key="correos",
        label="Correos",
        aliases=("email", "correo", "mail"),
        sources=(
            # The analysed digest, when the message survived the noise filter.
            NodeSource(
                nodes=("Registrar resultado", "Parsear análisis", "Parsear analisis"),
                fields=("asunto", "remitente", "categoria", "prioridad", "fecha", "requiere_accion"),
            ),
            # Otherwise the trigger itself - sender, subject and date only.
            NodeSource(
                nodes=("Filtrar ruido", "Correo nuevo (Gmail)", "Gmail - Correos recientes (prueba)"),
                fields=("From", "Subject", "internalDate", "from", "subject", "date"),
            ),
        ),
        description="Correos recibidos y clasificados por el asistente.",
        privacy_note=(
            "Solo remitente, asunto y fecha. El cuerpo del correo no se lee ni se expone."
        ),
        searchable=("Subject", "asunto", "From", "remitente"),
    ),
    "laboral": ModuleSpec(
        key="laboral",
        label="Laboral",
        aliases=("laboral", "job", "empleo", "trabajo"),
        sources=(
            NodeSource(
                nodes=("Fusionar oferta + resumen", "Seleccionar TOP 3"),
                fields=(
                    "title",
                    "company",
                    "location",
                    "link",
                    "score",
                    "resumen",
                    "motivo_fit",
                    "source",
                    "postedAt",
                ),
            ),
            NodeSource(
                nodes=("Scoring de ofertas", "Filtrar por perfil", "Extraer ofertas"),
                fields=(
                    "title",
                    "company",
                    "location",
                    "link",
                    "score",
                    "source",
                    "postedAt",
                    "descriptionSnippet",
                ),
            ),
        ),
        description="Ofertas encontradas, filtradas por perfil y puntuadas.",
        searchable=("title", "company", "location", "resumen", "descriptionSnippet"),
    ),
    "noticias": ModuleSpec(
        key="noticias",
        label="Noticias",
        aliases=("noticia", "news", "rss"),
        sources=(
            NodeSource(
                nodes=("Validar JSON IA", "IA - Resumir noticia"),
                # `relevancia`, `prioridad` y `enlace` son los que escribe el
                # propio workflow al resumir; `text` queda fuera porque es el
                # JSON crudo del modelo y duplica lo anterior.
                fields=(
                    "titulo",
                    "title",
                    "resumen",
                    "relevancia",
                    "prioridad",
                    "enlace",
                    "texto",
                    "link",
                    "fuente",
                    "source",
                    "isoDate",
                ),
            ),
            NodeSource(
                nodes=("Máx. 5 por ejecución", "Max. 5 por ejecucion", "Normalizar noticia"),
                fields=("title", "link", "source", "isoDate", "text"),
            ),
        ),
        description="Noticias recogidas de las fuentes RSS y resumidas.",
        searchable=("titulo", "title", "resumen", "texto", "text", "source", "fuente"),
    ),
    "marca-personal": ModuleSpec(
        key="marca-personal",
        label="Marca Personal",
        aliases=("marca", "brand", "linkedin"),
        sources=(
            NodeSource(
                nodes=("Validar y guardar borrador", "IA - Borrador LinkedIn"),
                fields=("titulo", "title", "borrador", "texto", "text", "hashtags", "ruta", "link", "fuente", "source"),
            ),
            NodeSource(
                nodes=("Máx. 3 por ejecución", "Max. 3 por ejecucion", "Normalizar fuente"),
                fields=("title", "link", "source", "isoDate"),
            ),
        ),
        description="Borradores de publicación generados a partir de las fuentes seguidas.",
        searchable=("titulo", "title", "borrador", "texto", "text"),
    ),
}


class PipelineError(Exception):
    def __init__(self, message: str, *, status_code: int = 502, code: str = "pipeline_error") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def is_known(module: str) -> bool:
    return module in MODULES


def _normalise(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", value.lower()) if unicodedata.category(c) != "Mn"
    )


def _truncate(value: Any) -> Any:
    """Keep items small. Numbers and booleans pass through untouched."""
    if isinstance(value, str):
        clean = " ".join(value.split())
        return clean if len(clean) <= MAX_FIELD_CHARS else clean[: MAX_FIELD_CHARS - 1] + "…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_truncate(v) for v in value[:10]]
    return _truncate(str(value))


def _project(item: dict, fields: Iterable[str]) -> dict:
    """Copy only the whitelisted fields. Absent ones are simply not there.

    The AI nodes answer with the platform's `/api/ai/generate` envelope, which
    carries the useful part - titulo, resumen, relevancia - one level down in
    `data`. That nesting is flattened first, so the whitelist sees it; the
    whitelist itself is unchanged, so nothing new escapes through here.
    """
    source: dict[str, Any] = item
    nested = item.get("data")
    if isinstance(nested, dict):
        source = {**nested, **{k: v for k, v in item.items() if k != "data"}}

    out: dict[str, Any] = {}
    for name in fields:
        if name in source and source[name] not in (None, "", [], {}):
            out[name] = _truncate(source[name])
    return out


def _items_of(run_data: dict, node: str) -> list[dict]:
    runs = run_data.get(node)
    if not isinstance(runs, list) or not runs:
        return []
    collected: list[dict] = []
    for run in runs:
        main = ((run or {}).get("data") or {}).get("main") or []
        for branch in main:
            for entry in branch or []:
                payload = (entry or {}).get("json")
                if isinstance(payload, dict):
                    collected.append(payload)
    return collected


#: Terms the user and the sources write differently. Expanding them is what
#: lets "IA" find a piece whose summary says "inteligencia artificial".
SYNONYMS: dict[str, tuple[str, ...]] = {
    "ia": ("inteligencia artificial", "artificial intelligence", "ai"),
    "ai": ("inteligencia artificial", "artificial intelligence", "ia"),
    "inteligencia artificial": ("ia", "ai", "artificial intelligence"),
    "llm": ("modelo de lenguaje", "language model", "gpt"),
    "ciberseguridad": ("seguridad informatica", "cybersecurity"),
}

#: Fields that carry the *meaning* of an item, weighted above its title. The
#: summary written by "IA - Resumir noticia" is the best signal there is.
STRONG_FIELDS = ("resumen", "texto", "text", "borrador", "motivo_fit", "descriptionSnippet")

_WORD_LIMIT = 3


def _terms(needle: str) -> list[str]:
    """The query as searchable terms: the phrase, its words, and synonyms."""
    base = _normalise(needle).strip()
    if not base:
        return []
    out = {base}
    for word in base.split():
        if len(word) >= _WORD_LIMIT:
            out.add(word)
    for key, expansions in SYNONYMS.items():
        if key in out or key == base:
            out.update(_normalise(e) for e in expansions)
    return sorted(out, key=len, reverse=True)


def _contains_term(haystack: str, term: str) -> bool:
    """Word-boundary match, so "IA" does not fire on "familia" or "media"."""
    if not term:
        return False
    start = 0
    while True:
        found = haystack.find(term, start)
        if found == -1:
            return False
        before_ok = found == 0 or not haystack[found - 1].isalnum()
        end = found + len(term)
        after_ok = end == len(haystack) or not haystack[end].isalnum()
        if before_ok and after_ok:
            return True
        start = found + 1


def _relevance(item: dict, spec: ModuleSpec, terms: list[str]) -> int:
    """How well an item answers the query. 0 means "no evidence of a match".

    Deliberately not a filter: `collect` keeps the items either way and uses
    this only to order them, so a question about a topic still gets the real
    results back instead of an empty answer.
    """
    if not terms:
        return 0
    score = 0
    names = spec.searchable or tuple(item.keys())
    for name in names:
        value = item.get(name)
        if not isinstance(value, str):
            continue
        haystack = _normalise(value)
        weight = 3 if name in STRONG_FIELDS else 2
        for term in terms:
            if _contains_term(haystack, term):
                # The full phrase is worth more than one of its words.
                score += weight * (2 if " " in term else 1)
    return score


def _started_at(execution: dict) -> datetime | None:
    raw = execution.get("startedAt") or execution.get("createdAt")
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


# --------------------------------------------------------------- cache ----

_cache: dict[tuple, tuple[float, dict]] = {}


def reset_cache() -> None:
    _cache.clear()


def _cached(key: tuple) -> dict | None:
    hit = _cache.get(key)
    if not hit:
        return None
    stored_at, payload = hit
    if time.monotonic() - stored_at > CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return payload


# -------------------------------------------------------------- reading ---


async def _resolve_workflow(n8n: N8nService, spec: ModuleSpec) -> dict | None:
    workflows = await n8n.list_workflows(limit=200)
    for workflow in workflows:
        name = _normalise(str(workflow.get("name") or ""))
        if any(_normalise(alias) in name for alias in spec.aliases):
            return workflow
    return None


async def collect(
    n8n: N8nService,
    module: str,
    *,
    limit: int = DEFAULT_LIMIT,
    scan: int = DEFAULT_SCAN,
    since: datetime | None = None,
    query: str = "",
) -> dict:
    """Read the latest results of one module.

    Returns a dict ready to be serialised: the items, where they came from, and
    - when there is nothing - a plain explanation of why.
    """
    spec = MODULES[module]
    limit = max(1, min(limit, MAX_LIMIT))
    scan = max(1, min(scan, MAX_SCAN))
    cache_key = (module, limit, scan, since.isoformat() if since else "", query.strip().lower())

    cached = _cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    try:
        workflow = await _resolve_workflow(n8n, spec)
        if workflow is None:
            payload = _empty(spec, "no hay ningún workflow desplegado en n8n con ese nombre")
            _cache[cache_key] = (time.monotonic(), payload)
            return payload

        executions = await n8n.list_executions(
            workflow_id=str(workflow.get("id")), status="success", limit=max(scan * 3, 10)
        )
        if not executions:
            payload = _empty(spec, "el workflow existe pero n8n no guarda ninguna ejecución con éxito")
            payload["workflow"] = {"id": str(workflow.get("id")), "name": workflow.get("name")}
            _cache[cache_key] = (time.monotonic(), payload)
            return payload

        items: list[dict] = []
        used_nodes: set[str] = set()
        inspected = 0
        latest: str | None = None

        for execution in executions:
            # Inspect the agreed number of executions even once `limit` items
            # are in hand: with a query, the best match may live in the second
            # run, and stopping early was what made a topic search come back
            # empty while the data was right there.
            if inspected >= scan or len(items) >= HARD_ITEM_CEILING:
                break
            started = _started_at(execution)
            if since and started and started < since:
                continue
            inspected += 1
            detail = await n8n.get_execution(str(execution.get("id")), include_data=True)
            run_data = ((detail.get("data") or {}).get("resultData") or {}).get("runData") or {}
            if latest is None and started:
                latest = started.isoformat()

            for source in spec.sources:
                found = next((n for n in source.nodes if _items_of(run_data, n)), None)
                if not found:
                    continue
                for raw in _items_of(run_data, found):
                    projected = _project(raw, source.fields)
                    if not projected:
                        continue
                    projected["_execution_id"] = str(execution.get("id"))
                    if started:
                        projected["_run_at"] = started.astimezone(timezone.utc).isoformat()
                    # Everything the run produced is kept. The query ranks it
                    # below; it does not decide what gets collected, because a
                    # topic that appears only in a summary would otherwise make
                    # a module with real results look empty.
                    items.append(projected)
                used_nodes.add(found)
                break  # the first source that produced anything wins

        terms = _terms(query)
        scored = [(_relevance(item, spec, terms), index, item) for index, item in enumerate(items)]
        matched = [row for row in scored if row[0] > 0]
        # "Relajado" solo tiene sentido si había algo que relajar: sin datos, el
        # módulo está vacío, que es una situación distinta y se cuenta distinto.
        relaxed = bool(terms) and not matched and bool(items)

        if terms:
            # Best first; ties keep the order the executions produced.
            ordered = [row[2] for row in sorted(matched, key=lambda r: (-r[0], r[1]))]
            if relaxed:
                # Nothing matched. Return the most recent items anyway and say
                # so - the model can judge relevance, and "no hay noticias"
                # when there plainly are some is the worse answer.
                ordered = items
        else:
            ordered = items

        selected = ordered[:limit]
        payload = {
            "module": spec.key,
            "label": spec.label,
            "description": spec.description,
            "privacy_note": spec.privacy_note,
            "workflow": {"id": str(workflow.get("id")), "name": workflow.get("name")},
            "items": selected,
            "count": len(selected),
            "available": len(items),
            "query": query,
            "matched": len(matched),
            "relaxed": relaxed,
            "executions_inspected": inspected,
            "latest_run_at": latest,
            "source_nodes": sorted(used_nodes),
            "detail": _detail_for(query, since, items, matched, relaxed),
            "cached": False,
        }
    except N8nError as exc:
        raise PipelineError(exc.message, status_code=exc.status_code, code=exc.code) from exc

    _cache[cache_key] = (time.monotonic(), payload)
    return payload


def _empty(spec: ModuleSpec, detail: str) -> dict:
    return {
        "module": spec.key,
        "label": spec.label,
        "description": spec.description,
        "privacy_note": spec.privacy_note,
        "workflow": None,
        "items": [],
        "count": 0,
        "available": 0,
        "query": "",
        "matched": 0,
        "relaxed": False,
        "executions_inspected": 0,
        "latest_run_at": None,
        "source_nodes": [],
        "detail": detail,
        "cached": False,
    }


def _detail_for(
    query: str, since: datetime | None, items: list[dict], matched: list, relaxed: bool
) -> str:
    """What the caller should tell the user about this result set."""
    if items and relaxed:
        return (
            f"ninguna entrada menciona «{query}» de forma literal; se devuelven las más recientes "
            "para que valores tú la relevancia. SÍ hay resultados disponibles: no propongas "
            "ejecutar el workflow por esto."
        )
    if items and query:
        return f"{len(matched)} entrada(s) relacionadas con «{query}», ordenadas por relevancia"
    if items:
        return ""
    if since:
        return "no hay resultados en el periodo solicitado"
    return (
        "las ejecuciones revisadas no contienen resultados: o el workflow no produjo nada, "
        "o sus nodos de salida se han renombrado en n8n"
    )


def catalogue() -> list[dict]:
    """The modules this API can report on, without touching n8n."""
    return [
        {
            "module": spec.key,
            "label": spec.label,
            "description": spec.description,
            "privacy_note": spec.privacy_note,
            "searchable": list(spec.searchable),
        }
        for spec in MODULES.values()
    ]
