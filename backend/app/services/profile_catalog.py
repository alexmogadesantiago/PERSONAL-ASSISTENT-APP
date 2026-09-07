"""The catalogue of pickable profile options.

The panel used to ask the user to type values, or to edit raw JSON. This module
is the other half of replacing that with a visual picker: it declares every
section, field and option the UI can render, so adding a new sector or a new
interest is a one-line change here and needs no frontend work at all.

Two rules this file exists to keep:

* **One vocabulary.** Option ids use the slugs already in `config/modules.json`
  (`ingenieria_organizacion_industrial`, `inteligencia_artificial`, ...), which
  is what the n8n workflows read. A second, prettier set of ids would silently
  stop matching them.
* **The stored shape does not change.** Fields write into the same
  `profiles.configuration` keys the backend already documents in
  `PROFILE_DIMENSIONS` and grades in `REQUIRED_PROFILE_FIELDS`, so completeness,
  the monitor and the automations keep working untouched.

`normalise_configuration()` is what lets old, hand-typed profiles open in the
new UI: it maps free text onto option ids where it can and leaves anything it
does not recognise exactly as it found it.
"""
from __future__ import annotations

import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Literal

FieldKind = Literal["multi", "single", "scale", "toggle", "text"]


@dataclass(frozen=True)
class Option:
    id: str
    label: str


@dataclass(frozen=True)
class Field:
    #: where the value is written inside `configuration`. One element for a
    #: top-level dimension (`["sector"]`), two for a grouped one
    #: (`["preferencias_laborales", "tipo_empresa"]`).
    path: tuple[str, ...]
    label: str
    kind: FieldKind
    options: tuple[Option, ...] = ()
    hint: str = ""
    #: for `multi` fields: selecting this option reveals `free_text_path`
    free_text_trigger: str = ""
    free_text_path: tuple[str, ...] = ()
    free_text_label: str = ""

    @property
    def key(self) -> str:
        return ".".join(self.path)


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    question: str
    description: str = ""
    fields: tuple[Field, ...] = ()


def _opts(*pairs: tuple[str, str]) -> tuple[Option, ...]:
    return tuple(Option(id=i, label=label) for i, label in pairs)


# --------------------------------------------------------------------------
# 1. Formación
# --------------------------------------------------------------------------
_FORMACION = _opts(
    ("ingenieria_organizacion_industrial", "Ingeniería en Organización Industrial"),
    ("ingenieria_industrial", "Ingeniería Industrial"),
    ("ingenieria_informatica", "Ingeniería Informática"),
    ("ingenieria_aeroespacial", "Ingeniería Aeroespacial"),
    ("ingenieria_mecanica", "Ingeniería Mecánica"),
    ("ingenieria_electronica", "Ingeniería Electrónica"),
    ("ingenieria_telecomunicaciones", "Ingeniería de Telecomunicaciones"),
    ("ingenieria_civil", "Ingeniería Civil"),
    ("ingenieria_software", "Ingeniería de Software"),
    ("ingenieria_electrica", "Ingeniería Eléctrica"),
    ("ingenieria_quimica", "Ingeniería Química"),
    ("ingenieria_energia", "Ingeniería de la Energía"),
    ("ingenieria_automatica", "Ingeniería Automática"),
    ("administracion_direccion_empresas", "ADE"),
    ("economia", "Economía"),
    ("marketing", "Marketing"),
    ("ciencia_datos", "Ciencia de Datos"),
    ("fisica", "Física"),
    ("matematicas", "Matemáticas"),
    ("ciencias", "Ciencias"),
    ("arquitectura", "Arquitectura"),
    ("derecho", "Derecho"),
    ("comunicacion", "Comunicación"),
    ("fp_industrial", "FP"),
    ("bachillerato", "Bachillerato"),
    ("master", "Máster"),
    ("doctorado", "Doctorado"),
    ("otra", "Otra"),
)

# --------------------------------------------------------------------------
# 2. Sector
# --------------------------------------------------------------------------
_SECTOR = _opts(
    ("industria_manufactura", "Industria"),
    ("automocion", "Automoción"),
    ("aeroespacial", "Aeroespacial"),
    ("defensa", "Defensa"),
    ("tecnologia", "Tecnología"),
    ("software", "Software"),
    ("inteligencia_artificial", "Inteligencia Artificial"),
    ("robotica", "Robótica"),
    ("automatizacion", "Automatización"),
    ("energia", "Energía"),
    ("renovables", "Renovables"),
    ("logistica_supply_chain", "Logística"),
    ("supply_chain", "Supply Chain"),
    ("consultoria", "Consultoría"),
    ("finanzas_banca", "Finanzas"),
    ("banca", "Banca"),
    ("seguros", "Seguros"),
    ("farmaceutico_salud", "Salud"),
    ("farmaceutica", "Farmacéutica"),
    ("telecomunicaciones", "Telecomunicaciones"),
    ("construccion_infraestructuras", "Construcción"),
    ("infraestructura", "Infraestructura"),
    ("retail_consumo", "Retail"),
    ("ecommerce", "E-commerce"),
    ("gaming", "Gaming"),
    ("media", "Media"),
    ("educacion", "Educación"),
    ("investigacion", "Investigación"),
)

# --------------------------------------------------------------------------
# 3. Objetivo profesional
# --------------------------------------------------------------------------
_OBJETIVO = _opts(
    ("encontrar_trabajo", "Encontrar trabajo"),
    ("practicas_universitarias", "Encontrar prácticas"),
    ("graduate_program", "Graduate Program"),
    ("primer_empleo", "Conseguir primer empleo"),
    ("cambio_sector", "Cambiar de sector"),
    ("mejora_profesional", "Mejorar profesionalmente"),
    ("alta_proyeccion", "Conseguir un puesto de alta proyección"),
    ("alta_remuneracion", "Conseguir un puesto de alta remuneración"),
    ("crear_empresa", "Crear una empresa"),
    ("emprender", "Emprender"),
    ("multinacional", "Trabajar en una multinacional"),
    ("startup", "Trabajar en una startup"),
)

# --------------------------------------------------------------------------
# 4. Ubicación
# --------------------------------------------------------------------------
_UBICACION = _opts(
    ("barcelona", "Barcelona"),
    ("madrid", "Madrid"),
    ("lleida", "Lleida"),
    ("valencia", "Valencia"),
    ("sevilla", "Sevilla"),
    ("bilbao", "Bilbao"),
    ("zaragoza", "Zaragoza"),
    ("espana", "España"),
    ("europa", "Europa"),
    ("union_europea", "Unión Europea"),
    ("reino_unido", "Reino Unido"),
    ("estados_unidos", "Estados Unidos"),
    ("internacional", "Internacional"),
    ("remoto", "Remoto"),
    ("otra", "Otra"),
)

#: Languages the automations can write in. The ids are the codes the runtime
#: profile hands to the workflows, so there is nothing to translate later.
_IDIOMA = _opts(
    ("es", "Espanol"),
    ("ca", "Catala"),
    ("en", "English"),
    ("fr", "Francais"),
    ("de", "Deutsch"),
)

_MODALIDAD = _opts(
    ("presencial", "Presencial"),
    ("hibrido", "Híbrido"),
    ("remoto", "Remoto"),
    ("flexible", "Flexible"),
)

_EXPERIENCIA = _opts(
    ("estudiante", "Estudiante"),
    ("sin_experiencia", "Sin experiencia"),
    ("practicas", "Prácticas"),
    ("internship", "Internship"),
    ("trainee", "Trainee"),
    ("graduate", "Graduate"),
    ("graduate_program", "Graduate Program"),
    ("junior", "Junior"),
    ("entry_level", "Entry Level"),
    ("associate", "Associate"),
    ("mid_level", "Mid-level"),
    ("senior", "Senior"),
    ("manager", "Manager"),
)

_INTERESES = _opts(
    ("inteligencia_artificial", "Inteligencia Artificial"),
    ("machine_learning", "Machine Learning"),
    ("automatizacion", "Automatización"),
    ("robotica", "Robótica"),
    ("programacion", "Programación"),
    ("software", "Software"),
    ("cloud", "Cloud"),
    ("ciberseguridad", "Ciberseguridad"),
    ("datos_analytics", "Data"),
    ("business_intelligence", "Business Intelligence"),
    ("aviacion", "Aviación"),
    ("aeroespacial", "Aeroespacial"),
    ("espacio", "Espacio"),
    ("automocion", "Automoción"),
    ("industria_40", "Industria 4.0"),
    ("manufacturing", "Manufacturing"),
    ("supply_chain", "Supply Chain"),
    ("logistica", "Logística"),
    ("operaciones", "Operaciones"),
    ("finanzas", "Finanzas"),
    ("economia_mercados", "Economía"),
    ("negocios", "Negocios"),
    ("consultoria_estrategia", "Consultoría"),
    ("estrategia", "Estrategia"),
    ("producto", "Producto"),
    ("tecnologia_startups", "Startups"),
    ("emprendimiento", "Emprendimiento"),
    ("gaming", "Gaming"),
    ("deporte", "Deporte"),
    ("ciencia", "Ciencia"),
    ("investigacion", "Investigación"),
    ("tecnologia", "Tecnología"),
    ("innovacion_tecnologica", "Innovación"),
)

# --------------------------------------------------------------------------
# 8. Preferencias laborales
# --------------------------------------------------------------------------
_SALARIO = _opts(
    ("20k", "20.000 €"),
    ("25k", "25.000 €"),
    ("30k", "30.000 €"),
    ("35k", "35.000 €"),
    ("40k", "40.000 €"),
    ("45k", "45.000 €"),
    ("50k", "50.000 €"),
    ("60k", "60.000 €"),
    ("75k", "75.000 €"),
    ("100k_mas", "100.000 € o más"),
)

_TIPO_EMPRESA = _opts(
    ("startup", "Startup"),
    ("pyme", "PYME"),
    ("empresa_mediana", "Empresa mediana"),
    ("gran_empresa", "Gran empresa"),
    ("multinacional", "Multinacional"),
)

_TIPO_CONTRATO = _opts(
    ("indefinido", "Indefinido"),
    ("temporal", "Temporal"),
    ("practicas", "Prácticas"),
    ("graduate_program", "Graduate Program"),
    ("trainee", "Trainee"),
)

_PROYECCION = _opts(
    ("alta_proyeccion", "Alta proyección"),
    ("crecimiento_profesional", "Crecimiento profesional"),
    ("internacional", "Internacional"),
    ("liderazgo", "Liderazgo"),
    ("especializacion_tecnica", "Especialización técnica"),
)

# --------------------------------------------------------------------------
# 9. Preferencias de noticias
# --------------------------------------------------------------------------
_NOTICIAS_CATEGORIAS = _opts(
    ("tecnologia", "Tecnología"),
    ("inteligencia_artificial", "IA"),
    ("industria_manufactura", "Industria"),
    ("aeroespacial", "Aeroespacial"),
    ("aviacion", "Aviación"),
    ("automocion", "Automoción"),
    ("economia_mercados", "Economía"),
    ("finanzas", "Finanzas"),
    ("energia", "Energía"),
    ("ciencia", "Ciencia"),
    ("tecnologia_startups", "Startups"),
    ("negocios", "Negocios"),
    ("politica_economica", "Política económica"),
    ("innovacion_tecnologica", "Innovación"),
    ("gaming", "Gaming"),
)

_FRECUENCIA = _opts(
    ("tiempo_real", "Tiempo real"),
    ("varias_veces_dia", "Varias veces al día"),
    ("diario", "Diario"),
    ("semanal", "Semanal"),
)

# --------------------------------------------------------------------------
# 10. Marca personal
# --------------------------------------------------------------------------
_MARCA_OBJETIVOS = _opts(
    ("presencia_profesional", "Crear presencia profesional"),
    ("linkedin", "LinkedIn"),
    ("blog", "Blog"),
    ("portfolio", "Portfolio"),
    ("networking", "Networking"),
    ("publicar_contenido", "Publicar contenido"),
    ("detectar_tendencias", "Detectar tendencias"),
    ("contenido_automatico", "Crear contenido automáticamente"),
    ("monitorizar_sector", "Monitorizar mi sector"),
    ("monitorizar_nombre", "Monitorizar mi nombre"),
    ("monitorizar_empresas", "Monitorizar empresas"),
)

_MARCA_TEMAS = _opts(
    ("inteligencia_artificial", "IA"),
    ("tecnologia", "Tecnología"),
    ("industria_manufactura", "Industria"),
    ("aeroespacial", "Aeroespacial"),
    ("automatizacion", "Automatización"),
    ("negocios", "Negocios"),
)

# --------------------------------------------------------------------------
# 11. Automatizaciones — the four the product actually ships
# --------------------------------------------------------------------------
AUTOMATIONS: tuple[tuple[str, str, str], ...] = (
    (
        "agenda",
        "Agenda",
        "Gestionar automáticamente correos relacionados con citas, reuniones y eventos.",
    ),
    ("laboral", "Laboral", "Detectar ofertas y oportunidades profesionales relevantes."),
    ("noticias", "Noticias", "Filtrar y resumir noticias según mis intereses."),
    (
        "marca_personal",
        "Marca Personal",
        "Monitorizar y detectar oportunidades para mi marca personal.",
    ),
)


SECTIONS: tuple[Section, ...] = (
    Section(
        key="formacion",
        title="Formación",
        question="¿Cuál es tu formación?",
        fields=(
            Field(
                path=("formacion",),
                label="Formación",
                kind="multi",
                options=_FORMACION,
                free_text_trigger="otra",
                free_text_path=("formacion_otra",),
                free_text_label="¿Cuál?",
            ),
        ),
    ),
    Section(
        key="sector",
        title="Sector",
        question="¿En qué sectores te interesa trabajar?",
        fields=(Field(path=("sector",), label="Sectores", kind="multi", options=_SECTOR),),
    ),
    Section(
        key="objetivo_profesional",
        title="Objetivo",
        question="¿Qué buscas ahora mismo?",
        fields=(
            Field(
                path=("objetivo_profesional",),
                label="Objetivo profesional",
                kind="multi",
                options=_OBJETIVO,
            ),
        ),
    ),
    Section(
        key="ubicacion",
        title="Ubicación",
        question="¿Dónde quieres trabajar?",
        fields=(
            Field(
                path=("ubicacion",),
                label="Ubicación",
                kind="multi",
                options=_UBICACION,
                free_text_trigger="otra",
                free_text_path=("ubicacion_otra",),
                free_text_label="¿Dónde?",
            ),
            Field(path=("modalidad",), label="Modalidad", kind="multi", options=_MODALIDAD),
            # The automations write in this language and search news in it. It
            # used to be read from a static file the picker could not reach, so
            # the user's real choice never applied; it is a picker field now.
            Field(
                path=("idioma",),
                label="Idioma",
                kind="single",
                options=_IDIOMA,
                hint="En qué idioma te escriben los resúmenes y borradores.",
            ),
        ),
    ),
    Section(
        key="experiencia_nivel",
        title="Nivel",
        question="¿En qué punto de tu carrera estás?",
        fields=(
            Field(
                path=("experiencia_nivel",),
                label="Nivel / experiencia",
                kind="multi",
                options=_EXPERIENCIA,
            ),
        ),
    ),
    Section(
        key="intereses",
        title="Intereses",
        question="¿Qué te interesa?",
        description="Las automatizaciones filtran y puntúan contra esto.",
        fields=(Field(path=("intereses",), label="Intereses", kind="multi", options=_INTERESES),),
    ),
    Section(
        key="preferencias_laborales",
        title="Preferencias laborales",
        question="¿Qué buscas en una oferta?",
        fields=(
            Field(
                path=("preferencias_laborales", "salario_minimo"),
                label="Salario mínimo",
                kind="scale",
                options=_SALARIO,
                hint="Las ofertas por debajo bajan de puntuación, no se descartan.",
            ),
            Field(
                path=("preferencias_laborales", "tipo_empresa"),
                label="Tipo de empresa",
                kind="multi",
                options=_TIPO_EMPRESA,
            ),
            Field(
                path=("preferencias_laborales", "tipo_contrato"),
                label="Tipo de contrato",
                kind="multi",
                options=_TIPO_CONTRATO,
            ),
            Field(
                path=("preferencias_laborales", "proyeccion"),
                label="Proyección",
                kind="multi",
                options=_PROYECCION,
            ),
        ),
    ),
    Section(
        key="preferencias_noticias",
        title="Noticias",
        question="¿Qué noticias quieres recibir?",
        fields=(
            Field(
                path=("preferencias_noticias", "categorias"),
                label="Categorías",
                kind="multi",
                options=_NOTICIAS_CATEGORIAS,
            ),
            Field(
                path=("preferencias_noticias", "frecuencia"),
                label="Frecuencia",
                kind="single",
                options=_FRECUENCIA,
            ),
        ),
    ),
    Section(
        key="marca_personal",
        title="Marca personal",
        question="¿Qué quieres conseguir con tu marca personal?",
        fields=(
            Field(
                path=("marca_personal", "objetivos"),
                label="Objetivos",
                kind="multi",
                options=_MARCA_OBJETIVOS,
            ),
            Field(
                path=("marca_personal", "temas"),
                label="Temas",
                kind="multi",
                options=_MARCA_TEMAS,
            ),
        ),
    ),
    Section(
        key="automatizaciones",
        title="Automatizaciones",
        question="¿Cuáles quieres activar?",
        description="Puedes cambiarlo en cualquier momento.",
        fields=tuple(
            Field(
                path=("automatizaciones", key),
                label=label,
                kind="toggle",
                hint=description,
            )
            for key, label, description in AUTOMATIONS
        ),
    ),
)


def field_at(path) -> Field | None:
    """The catalogue field stored at `path`, or None if nothing lives there.

    Used by `services.profile_runtime` to turn stored option ids back into the
    labels the automations search with, so the catalogue stays the only
    taxonomy in the product.
    """
    wanted = tuple(path)
    for section in SECTIONS:
        for field in section.fields:
            if field.path == wanted:
                return field
    return None


def as_dict() -> dict:
    """JSON-serialisable catalogue for the API."""
    return {
        "sections": [
            {
                "key": section.key,
                "title": section.title,
                "question": section.question,
                "description": section.description,
                "fields": [
                    {
                        "key": f.key,
                        "path": list(f.path),
                        "label": f.label,
                        "kind": f.kind,
                        "hint": f.hint,
                        "options": [asdict(o) for o in f.options],
                        "free_text_trigger": f.free_text_trigger,
                        "free_text_path": list(f.free_text_path),
                        "free_text_label": f.free_text_label,
                    }
                    for f in section.fields
                ],
            }
            for section in SECTIONS
        ],
        # the fields completeness grades, so the UI can show the same progress
        # the backend computes instead of inventing its own rule
        "required_sections": ["sector", "ubicacion", "intereses", "preferencias_laborales"],
    }


# ---------------------------------------------------------------- migration --


def _slug(value: str) -> str:
    """Loose key for matching legacy free text against option ids/labels."""
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "_" for c in text.lower()).strip("_")


def _lookup(f: Field) -> dict[str, str]:
    """Every spelling that should resolve to an option id."""
    table: dict[str, str] = {}
    for option in f.options:
        table[_slug(option.id)] = option.id
        table[_slug(option.label)] = option.id
    return table


def _fields_by_path() -> dict[tuple[str, ...], Field]:
    return {f.path: f for s in SECTIONS for f in s.fields}


def _normalise_value(f: Field, value: Any) -> Any:
    """Map one stored value onto option ids, keeping anything unrecognised."""
    if f.kind == "toggle":
        return bool(value)
    table = _lookup(f)

    def one(v: Any) -> Any:
        if not isinstance(v, str):
            return v
        return table.get(_slug(v), v)

    if f.kind in ("multi",):
        if isinstance(value, str):
            # legacy free text was stored comma-separated
            parts = [p.strip() for p in value.split(",") if p.strip()]
            values = parts or []
        elif isinstance(value, (list, tuple)):
            values = list(value)
        else:
            return value
        seen: list[Any] = []
        for v in values:
            mapped = one(v)
            if mapped not in seen:
                seen.append(mapped)
        return seen
    if f.kind in ("single", "scale"):
        if isinstance(value, (list, tuple)):
            value = value[0] if value else ""
        return one(value)
    return value


def normalise_configuration(configuration: dict | None) -> dict:
    """Convert a stored `configuration` onto the catalogue's vocabulary.

    Non-destructive by design:

    * keys the catalogue does not know are copied through untouched;
    * values that match no option are kept verbatim, so a profile written by
      hand still opens in the new UI (the picker shows them as custom chips)
      and nothing a user typed is ever silently dropped.
    """
    if not configuration:
        return {}

    known = _fields_by_path()
    out: dict = {}
    # top-level dimensions
    for key, value in configuration.items():
        f = known.get((key,))
        if f is not None:
            out[key] = _normalise_value(f, value)
            continue
        if isinstance(value, dict):
            # a grouped dimension: normalise the sub-fields we recognise
            group: dict = {}
            for sub_key, sub_value in value.items():
                sub_field = known.get((key, sub_key))
                group[sub_key] = (
                    _normalise_value(sub_field, sub_value) if sub_field else sub_value
                )
            out[key] = group
            continue
        out[key] = value
    return out


__all__ = [
    "AUTOMATIONS",
    "Field",
    "Option",
    "SECTIONS",
    "Section",
    "as_dict",
    "normalise_configuration",
]
