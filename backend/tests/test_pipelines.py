"""Reading automation results back out of n8n.

The shapes below are the ones the live installation really returns - taken from
executions 219 (Noticias), 257 (Laboral) and 259 (Email) - so these tests
exercise the projection against the actual item layout, not an invented one.

What matters here: the right node is chosen, only whitelisted fields survive
(a correo must never contribute its body), long text is cut, and an absent node
produces an honest empty answer instead of a fabricated one.
"""
from __future__ import annotations

import datetime as dt
import json

import httpx
import pytest

from app.services import pipelines
from app.services.n8n import N8nService

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _clear_cache():
    pipelines.reset_cache()
    yield
    pipelines.reset_cache()


WORKFLOWS = [
    {"id": "w-mail", "name": "Asistente - Email"},
    {"id": "w-job", "name": "Asistente - Laboral"},
    {"id": "w-news", "name": "Asistente - Noticias"},
    {"id": "w-brand", "name": "Asistente - Marca Personal"},
]


def _items(*payloads: dict) -> list[dict]:
    """n8n stores runData[node] as a LIST of node runs, each with data.main."""
    return [{"data": {"main": [[{"json": p} for p in payloads]]}}]


def _execution(run_data: dict, execution_id: str = "1") -> dict:
    return {
        "id": execution_id,
        "status": "success",
        "startedAt": "2026-09-12T07:30:00.000Z",
        "data": {"resultData": {"runData": run_data}},
    }


def _service(run_data: dict, *, workflow_name: str, executions: int = 1) -> N8nService:
    """A real N8nService over a transport that answers like the live instance."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/workflows"):
            return httpx.Response(200, json={"data": WORKFLOWS})
        if path.endswith("/executions"):
            wanted = request.url.params.get("workflowId")
            rows = [
                {"id": str(i), "status": "success", "startedAt": "2026-09-12T07:30:00.000Z", "workflowId": wanted}
                for i in range(1, executions + 1)
            ]
            return httpx.Response(200, json={"data": rows})
        if "/executions/" in path:
            return httpx.Response(200, json=_execution(run_data, path.rsplit("/", 1)[-1]))
        return httpx.Response(404, json={"message": "nope"})

    assert workflow_name  # documents which module the run data belongs to
    return N8nService(
        base_url="http://n8n:5678", api_key="k", transport=httpx.MockTransport(handler)
    )


async def test_laboral_takes_the_merged_offer_node():
    run = {
        "Extraer ofertas": _items({"title": "Ruido", "company": "X"}),
        "Fusionar oferta + resumen": _items(
            {
                "title": "Data Engineer",
                "company": "Acme",
                "location": "Madrid",
                "link": "https://example.com/1",
                "score": 87,
                "resumen": "Puesto de ingeniería de datos.",
                "motivo_fit": "Coincide con tu perfil.",
            }
        ),
    }
    out = await pipelines.collect(_service(run, workflow_name="laboral"), "laboral")

    assert out["count"] == 1
    offer = out["items"][0]
    assert offer["title"] == "Data Engineer" and offer["score"] == 87
    assert offer["motivo_fit"] == "Coincide con tu perfil."
    # the preferred node won over the raw scrape
    assert out["source_nodes"] == ["Fusionar oferta + resumen"]
    assert offer["_execution_id"] == "1"


async def test_correos_never_carry_the_body():
    run = {
        "Correo nuevo (Gmail)": _items(
            {
                "From": "banco@example.com",
                "Subject": "Movimiento en tu cuenta",
                "internalDate": "1789000000000",
                "payload": {"body": {"data": "CONTENIDO CONFIDENCIAL DEL CORREO"}},
                "sizeEstimate": 4096,
                "labels": ["INBOX"],
            }
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="correos"), "correos")

    item = out["items"][0]
    assert item["From"] == "banco@example.com"
    assert item["Subject"] == "Movimiento en tu cuenta"
    assert "payload" not in item and "sizeEstimate" not in item and "labels" not in item
    assert "CONFIDENCIAL" not in json.dumps(out, ensure_ascii=False)
    assert "cuerpo del correo no se lee" in out["privacy_note"]


async def test_long_text_is_truncated():
    run = {"Normalizar noticia": _items({"title": "T", "text": "palabra " * 500, "link": "u"})}
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias")

    text = out["items"][0]["text"]
    assert len(text) <= pipelines.MAX_FIELD_CHARS
    assert text.endswith("…")


async def test_search_ranks_instead_of_discarding():
    run = {
        "Normalizar noticia": _items(
            {"title": "Avances en inteligencia artificial", "link": "a", "source": "s"},
            {"title": "Mercado inmobiliario", "link": "b", "source": "s"},
        )
    }
    svc = _service(run, workflow_name="noticias")

    hit = await pipelines.collect(svc, "noticias", query="Inteligencia Artificial")
    assert hit["count"] == 1 and hit["items"][0]["title"].startswith("Avances")
    assert hit["matched"] == 1 and hit["relaxed"] is False

    # accent- and case-insensitive
    again = await pipelines.collect(svc, "noticias", query="artificial")
    assert again["count"] == 1


async def test_summary_decides_relevance_when_the_title_does_not():
    """The exact failure reported: "noticias sobre IA" found nothing because the
    headline never says "IA" - only the summary written by the workflow does."""
    run = {
        "Validar JSON IA": _items(
            {
                "titulo": "Europa frente a EE.UU. en competitividad tecnológica",
                "resumen": "El análisis compara la inversión en inteligencia artificial de ambos bloques.",
                "link": "https://example.com/a",
                "fuente": "Medio",
            },
            {
                "titulo": "Mercado inmobiliario en агosto",
                "resumen": "Precios de la vivienda y tipos de interés.",
                "link": "https://example.com/b",
                "fuente": "Medio",
            },
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias", query="IA")

    assert out["matched"] == 1, "el resumen debe bastar para encontrarla"
    assert out["relaxed"] is False
    assert out["items"][0]["titulo"].startswith("Europa")


async def test_ai_node_envelope_is_flattened():
    """`IA - Resumir noticia` answers with the /api/ai/generate envelope: the
    real article lives in `data`, and without flattening the item arrived with
    no title at all."""
    run = {
        "IA - Resumir noticia": _items(
            {
                "provider": "nvidia_nim",
                "model": "nemotron",
                "text": '{"titulo": "...", "resumen": "..."}',
                "usage": {"total_tokens": 900},
                "data": {
                    "titulo": "Cuando todos tienen la misma inteligencia artificial",
                    "resumen": "Ante la democratización de la IA, las empresas deben diferenciarse.",
                    "relevancia": "media",
                    "prioridad": 3,
                    "enlace": "https://example.com/x",
                },
            }
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias", query="IA")

    item = out["items"][0]
    assert item["titulo"].startswith("Cuando todos")
    assert item["relevancia"] == "media" and item["prioridad"] == 3
    assert out["matched"] == 1
    # the model's raw JSON and its token usage are not context material
    assert "text" not in item and "usage" not in item and "model" not in item


async def test_short_query_does_not_match_inside_words():
    run = {
        "Normalizar noticia": _items(
            {"title": "La familia y los medios de comunicación", "link": "a", "source": "s"}
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias", query="IA")

    # "familia" y "media" contienen "ia": no son coincidencias
    assert out["matched"] == 0
    assert out["relaxed"] is True


async def test_no_match_reports_zero_but_still_returns_what_exists():
    run = {
        "Normalizar noticia": _items(
            {"title": "Mercado inmobiliario", "link": "b", "source": "s"},
            {"title": "Deportes", "link": "c", "source": "s"},
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias", query="cocina")

    assert out["matched"] == 0, "cero coincidencias, reportadas como tal"
    assert out["relaxed"] is True
    assert out["count"] == 2, "pero los resultados reales siguen disponibles"
    assert "cocina" in out["detail"] and "no propongas" in out["detail"]


async def test_empty_module_is_still_empty():
    run = {"Normalizar noticia": _items()}
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias", query="IA")

    assert out["count"] == 0 and out["matched"] == 0
    assert out["relaxed"] is False, "sin datos no es lo mismo que sin coincidencias"


async def test_general_question_returns_the_latest_without_a_query():
    run = {
        "Normalizar noticia": _items(
            *[{"title": f"Noticia {i}", "link": f"u{i}", "source": "s"} for i in range(6)]
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias")

    assert out["count"] == 6 and out["matched"] == 0 and out["relaxed"] is False
    assert out["detail"] == ""


async def test_reading_results_never_runs_a_workflow():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        if request.url.path.endswith("/workflows"):
            return httpx.Response(200, json={"data": WORKFLOWS})
        if request.url.path.endswith("/executions"):
            return httpx.Response(
                200,
                json={"data": [{"id": "1", "status": "success", "startedAt": "2026-09-12T07:30:00.000Z"}]},
            )
        return httpx.Response(
            200, json=_execution({"Normalizar noticia": _items({"title": "t", "link": "u"})})
        )

    svc = N8nService(base_url="http://n8n:5678", api_key="k", transport=httpx.MockTransport(handler))
    await pipelines.collect(svc, "noticias", query="IA")

    assert all(call.startswith("GET ") for call in seen), seen
    assert not any("/run" in c or "/activate" in c or "/deactivate" in c for c in seen), seen


async def test_marca_personal_reads_the_saved_draft():
    run = {
        "Validar y guardar borrador": _items(
            {
                "titulo": "IA y soberanía tecnológica",
                "borrador": "Texto del post para LinkedIn.",
                "hashtags": ["#IA", "#Europa"],
                "ruta": "/files/output/marca-personal/2026-09-12_ia.md",
            }
        )
    }
    out = await pipelines.collect(_service(run, workflow_name="marca-personal"), "marca-personal")

    assert out["count"] == 1
    assert out["items"][0]["borrador"].startswith("Texto del post")
    assert out["source_nodes"] == ["Validar y guardar borrador"]


async def test_renamed_node_is_reported_not_invented():
    run = {"Un nodo que nadie conoce": _items({"title": "algo"})}
    out = await pipelines.collect(_service(run, workflow_name="noticias"), "noticias")

    assert out["items"] == []
    assert "renombrado" in out["detail"]
    assert out["workflow"]["name"] == "Asistente - Noticias"


async def test_missing_workflow_says_so():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/workflows"):
            return httpx.Response(200, json={"data": [{"id": "x", "name": "Otro flujo"}]})
        return httpx.Response(200, json={"data": []})

    svc = N8nService(base_url="http://n8n:5678", api_key="k", transport=httpx.MockTransport(handler))
    out = await pipelines.collect(svc, "laboral")

    assert out["count"] == 0 and out["workflow"] is None
    assert "ningún workflow desplegado" in out["detail"]


async def test_limit_and_scan_are_capped():
    run = {"Normalizar noticia": _items(*[{"title": f"n{i}", "link": "u"} for i in range(50)])}
    out = await pipelines.collect(
        _service(run, workflow_name="noticias", executions=30), "noticias", limit=5, scan=99
    )

    assert out["count"] == 5
    assert out["executions_inspected"] <= pipelines.MAX_SCAN


async def test_since_skips_older_executions():
    run = {"Normalizar noticia": _items({"title": "vieja", "link": "u"})}
    out = await pipelines.collect(
        _service(run, workflow_name="noticias"),
        "noticias",
        since=dt.datetime(2026, 9, 13, tzinfo=dt.timezone.utc),
    )
    assert out["count"] == 0 and out["executions_inspected"] == 0


async def test_second_call_is_served_from_cache():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if request.url.path.endswith("/workflows"):
            return httpx.Response(200, json={"data": WORKFLOWS})
        if request.url.path.endswith("/executions"):
            return httpx.Response(
                200,
                json={"data": [{"id": "1", "status": "success", "startedAt": "2026-09-12T07:30:00.000Z"}]},
            )
        return httpx.Response(200, json=_execution({"Normalizar noticia": _items({"title": "t", "link": "u"})}))

    svc = N8nService(base_url="http://n8n:5678", api_key="k", transport=httpx.MockTransport(handler))
    first = await pipelines.collect(svc, "noticias")
    after_first = calls["n"]
    second = await pipelines.collect(svc, "noticias")

    assert first["cached"] is False and second["cached"] is True
    assert calls["n"] == after_first, "a cached answer must not touch n8n again"


def test_catalogue_lists_the_four_modules():
    keys = {m["module"] for m in pipelines.catalogue()}
    assert keys == {"correos", "laboral", "noticias", "marca-personal"}
