"""The one shape the automations consume, derived from `profiles.configuration`.

Before this module the platform had two profiles: the visual picker wrote
`profiles.configuration` in Postgres, and the n8n workflows read a static
`/files/config/user_profile.json` that nothing kept in step. What the user chose
in the panel never reached Laboral, Noticias or Marca Personal - they silently
ran on hard-coded defaults.

Postgres is now the only source of truth. This module turns a stored profile
into the runtime values the workflows already expect, and `/api/profiles/runtime`
serves it, so there is no file to synchronise and nothing to go stale.

No second taxonomy is introduced: every value here is derived from the option
**labels** of `profile_catalog`, which is the same catalogue the picker renders.
Adding an option to the catalogue automatically makes it usable by a workflow.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

from app.services import profile_catalog as catalog

#: `idioma` code -> Google News locale triple (hl, gl, ceid), matching what the
#: workflows built themselves before.
LOCALES: dict[str, tuple[str, str, str]] = {
    "es": ("es", "ES", "ES:es"),
    "ca": ("ca", "ES", "ES:ca"),
    "en": ("en-US", "US", "US:en"),
    "fr": ("fr", "FR", "FR:fr"),
    "de": ("de", "DE", "DE:de"),
}
DEFAULT_LANGUAGE = "es"

#: tone per marca-personal objective. Deliberately small and readable; the
#: default is what the workflows used when nothing was configured.
DEFAULT_TONE = "Profesional, claro y cercano."
TONE_BY_OBJECTIVE: dict[str, str] = {
    "presencia_profesional": "Profesional, claro y cercano.",
    "linkedin": "Profesional cercano, en primera persona.",
    "blog": "Divulgativo, ordenado y con ejemplos.",
    "liderazgo_opinion": "Analitico y con criterio propio.",
    "networking": "Conversacional y abierto a debate.",
}

#: how many search phrases the job scraper accepts
MAX_KEYWORDS = 8
NEWS_WORDS = 80

_WORD = re.compile(r"[^a-z0-9]+")


def _fold(text: str) -> str:
    """Lower-case, accent-free form used for matching."""
    stripped = unicodedata.normalize("NFD", str(text or ""))
    stripped = "".join(c for c in stripped if unicodedata.category(c) != "Mn")
    return stripped.lower().strip()


def _labels(config: dict, path: tuple[str, ...]) -> list[str]:
    """Human labels for whatever is selected at `path`.

    An id the catalogue no longer knows is kept as-is rather than dropped: a
    profile saved before an option was renamed must not silently lose it.
    """
    field = catalog.field_at(path)
    selected = _selected(config, path)
    if field is None:
        return [str(s) for s in selected]
    by_id = {o.id: o.label for o in field.options}
    return [by_id.get(str(s), str(s)) for s in selected]


def _selected(config: dict, path: tuple[str, ...]) -> list:
    """Raw selection at `path`, always as a list."""
    node: object = config or {}
    for part in path:
        if not isinstance(node, dict):
            return []
        node = node.get(part)
    if node is None or node == "":
        return []
    return list(node) if isinstance(node, (list, tuple)) else [node]


def _first(config: dict, path: tuple[str, ...], default: str = "") -> str:
    labels = _labels(config, path)
    return labels[0] if labels else default


def _terms(labels: list[str]) -> list[str]:
    """Search tokens from labels: the whole phrase plus its words.

    Mirrors what the Laboral workflow did with `keywords_linkedin`, so scoring
    behaves the same - only the source of the words changed.
    """
    out: list[str] = []
    for label in labels:
        folded = _fold(label)
        if not folded:
            continue
        out.append(folded)
        out.extend(w for w in _WORD.split(folded) if len(w) > 2)
    seen: dict[str, None] = {}
    for term in out:
        seen.setdefault(term, None)
    return list(seen)


def _toggle(config: dict, key: str) -> bool:
    """Is this automation switched on? Absent means off."""
    selected = _selected(config, ("automatizaciones", key))
    if not selected:
        return False
    value = selected[0]
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on", "si", "sí")
    return bool(value)


def language_of(config: dict) -> str:
    """`es` | `ca` | `en` | `fr` | `de`. Defaults to Spanish."""
    selected = _selected(config, ("idioma",))
    code = str(selected[0]).strip().lower() if selected else ""
    return code if code in LOCALES else DEFAULT_LANGUAGE


def _news_query(categories: list[str]) -> str:
    if not categories:
        return "(economia OR tecnologia OR ciencia OR IA)"
    return "(" + " OR ".join(categories) + ")"


def google_news_url(categories: list[str], language: str) -> str:
    hl, gl, ceid = LOCALES.get(language, LOCALES[DEFAULT_LANGUAGE])
    return (
        "https://news.google.com/rss/search?q="
        + quote(_news_query(categories))
        + f"&hl={hl}&gl={gl}&ceid={quote(ceid)}"
    )


#: extra feeds Marca Personal reads alongside the Google News query
EXTRA_BRAND_FEEDS = (
    "https://blogs.nvidia.com/feed/",
    "https://openai.com/news/rss.xml",
    "https://blog.google/rss/",
)


def build(configuration: dict | None) -> dict:
    """The runtime profile every workflow reads.

    Never raises: a half-filled or legacy profile yields the same defaults the
    workflows used to fall back to, so nothing breaks while a user is still
    filling the picker in.
    """
    config = configuration if isinstance(configuration, dict) else {}

    language = language_of(config)
    hl, gl, ceid = LOCALES[language]

    formacion = _labels(config, ("formacion",))
    sector = _labels(config, ("sector",))
    objetivo = _labels(config, ("objetivo_profesional",))
    intereses = _labels(config, ("intereses",))
    noticias = _labels(config, ("preferencias_noticias", "categorias"))
    temas = _labels(config, ("marca_personal", "temas"))
    objetivos_marca = _selected(config, ("marca_personal", "objetivos"))

    # Laboral: what the scraper searches for, and what scoring rewards.
    keywords = list(dict.fromkeys(formacion + sector))[:MAX_KEYWORDS]
    include_terms = _terms(formacion + sector + intereses)

    location = _first(config, ("ubicacion",))
    modalidad = _first(config, ("modalidad",))
    nivel = _first(config, ("experiencia_nivel",))

    perfil_texto = _profile_sentence(formacion, objetivo, sector, nivel)

    tone = DEFAULT_TONE
    for objective in objetivos_marca:
        if str(objective) in TONE_BY_OBJECTIVE:
            tone = TONE_BY_OBJECTIVE[str(objective)]
            break

    # Noticias: the picker's own news categories, falling back to interests so a
    # profile that only filled Intereses still gets a relevant feed.
    categorias = list(dict.fromkeys(noticias or intereses))

    return {
        "idioma": language,
        "locale": {"hl": hl, "gl": gl, "ceid": ceid},
        # --- Laboral -------------------------------------------------------
        "keywords": ",".join(keywords) or "Engineer,Analyst,Operations",
        "include_terms": include_terms,
        "location": location,
        "modalidad": modalidad,
        "nivel": nivel,
        "perfil_texto": perfil_texto,
        "preferencias_laborales": {
            "salario_minimo": _first(config, ("preferencias_laborales", "salario_minimo")),
            "tipo_empresa": _labels(config, ("preferencias_laborales", "tipo_empresa")),
            "tipo_contrato": _labels(config, ("preferencias_laborales", "tipo_contrato")),
            "proyeccion": _labels(config, ("preferencias_laborales", "proyeccion")),
        },
        # --- Noticias ------------------------------------------------------
        "categorias": categorias,
        "feed_url": google_news_url(categorias, language),
        "frecuencia": _first(config, ("preferencias_noticias", "frecuencia")),
        "max_palabras": NEWS_WORDS,
        # --- Marca personal ------------------------------------------------
        "tono": tone,
        "temas": ", ".join(temas),
        "objetivos_marca": _labels(config, ("marca_personal", "objetivos")),
        "feeds": [google_news_url(categorias, language), *EXTRA_BRAND_FEEDS],
        # --- which automations the user turned on ---------------------------
        "automatizaciones": {
            key: _toggle(config, key)
            for key in ("agenda", "laboral", "noticias", "marca_personal")
        },
        # --- everything else, untouched -------------------------------------
        # Legacy or unknown keys are not part of the derived shape, so they are
        # handed back verbatim. A profile written by an older build keeps every
        # value it had; nothing here destroys data it does not understand.
        "raw": config,
    }


def _profile_sentence(
    formacion: list[str], objetivo: list[str], sector: list[str], nivel: str
) -> str:
    """The one-line self-description the AI prompts embed."""
    parts: list[str] = []
    if formacion:
        parts.append("Perfil de " + ", ".join(formacion[:2]))
    if nivel:
        parts.append("nivel " + nivel.lower())
    if sector:
        parts.append("interesado en " + ", ".join(sector[:3]))
    if objetivo:
        parts.append("objetivo: " + ", ".join(objetivo[:2]).lower())
    return ". ".join(parts) + "." if parts else "Perfil profesional sin detallar."


__all__ = [
    "DEFAULT_LANGUAGE",
    "EXTRA_BRAND_FEEDS",
    "LOCALES",
    "MAX_KEYWORDS",
    "build",
    "google_news_url",
    "language_of",
]
