"""Demo mode: a coherent, clearly labelled sample day for presentations.

Turned on per user (Settings > Demo mode, stored as a preference). While it is
on, the assistant's *read* surfaces (Inbox, analysis, briefing, insights, chat
context, calendar) use this dataset instead of the user's Google account, so
the product can be shown without exposing personal mail or credentials.

Hard rules:
* every payload built from here carries ``"demo": True`` and the UI shows a
  permanent "Demo mode" banner;
* nothing is ever *sent* in demo mode (no email, no Telegram) and nothing in
  Google changes; actions answer "simulated in demo mode";
* no AI provider is called - the analyses below are fixed, so the demo works
  offline and gives the same result every time.

Dataset: 5 emails, 3 calendar events, 1 deadline, 4 automations, 2 executions,
1 error.
"""
from __future__ import annotations

import datetime as dt

IMPORTANT_SENDERS = {"marta.puig@institut.cat": "TDR tutor"}


def _now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def _today_at(hour: int, minute: int = 0) -> dt.datetime:
    return _now().replace(hour=hour, minute=minute, second=0, microsecond=0)


def _next_friday(hour: int = 17) -> dt.datetime:
    now = _now()
    days = (4 - now.weekday()) % 7 or 7
    return (now + dt.timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def _mail() -> list[dict]:
    now = _now()

    def ago(**kw) -> str:
        return (now - dt.timedelta(**kw)).strftime("%a, %d %b %Y %H:%M:%S %z")

    friday = _next_friday().strftime("%A %d/%m")
    return [
        {"id": "demo-1", "thread_id": "demo-t1", "from": "Marta Puig <marta.puig@institut.cat>",
         "to": "you@example.com", "subject": "Presentación del TDR: entrega el viernes",
         "date": ago(minutes=42), "snippet": f"Hola, recuerda enviarme la presentación del TDR antes del {friday} a las 17:00…",
         "has_attachments": False, "attachments": [], "labels": ["INBOX", "UNREAD", "IMPORTANT"], "link": "",
         "text": (f"Hola,\n\nRecuerda enviarme la presentación del TDR antes del {friday} a las 17:00. "
                  "Incluye la demo del asistente y las conclusiones. Si tienes dudas, hablamos hoy a las 13:00.\n\n"
                  "Un saludo,\nMarta Puig")},
        {"id": "demo-2", "thread_id": "demo-t2", "from": "Club Esportiu <entrenos@clubesportiu.cat>",
         "to": "you@example.com", "subject": "Cambio de horario: entrenamiento a las 18:00",
         "date": ago(hours=2), "snippet": "Esta semana el entrenamiento del martes pasa a las 18:00 en la pista 2…",
         "has_attachments": False, "attachments": [], "labels": ["INBOX", "UNREAD"], "link": "",
         "text": "Esta semana el entrenamiento del martes pasa a las 18:00 en la pista 2. Trae la equipación azul."},
        {"id": "demo-3", "thread_id": "demo-t3", "from": "Laura Vidal <laura.vidal@example.com>",
         "to": "you@example.com", "subject": "¿Repasamos mates mañana?",
         "date": ago(hours=3), "snippet": "Oye, ¿te va bien repasar el tema de integrales mañana después de clase?",
         "has_attachments": False, "attachments": [], "labels": ["INBOX", "UNREAD"], "link": "",
         "text": "Oye, ¿te va bien repasar el tema de integrales mañana después de clase? Dime algo."},
        {"id": "demo-4", "thread_id": "demo-t4", "from": "Tech Weekly <newsletter@techweekly.io>",
         "to": "you@example.com", "subject": "Las 10 noticias de IA de la semana",
         "date": ago(hours=6), "snippet": "Esta semana: nuevos modelos, agentes y automatización…",
         "has_attachments": False, "attachments": [], "labels": ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"], "link": "",
         "text": "Esta semana: nuevos modelos, agentes y automatización. Lee el resumen completo en la web."},
        {"id": "demo-5", "thread_id": "demo-t5", "from": "Admisiones Universidad <admisiones@universidad.edu>",
         "to": "you@example.com", "subject": "Jornada de puertas abiertas: inscripción abierta",
         "date": ago(days=1), "snippet": "Inscríbete a la jornada de puertas abiertas del Grado en Ingeniería Informática…",
         "has_attachments": True, "attachments": [{"filename": "programa.pdf", "mime_type": "application/pdf", "size": 182000}],
         "labels": ["INBOX"], "link": "",
         "text": "Inscríbete a la jornada de puertas abiertas del Grado en Ingeniería Informática. Plazas limitadas."},
    ]


def _analysis() -> dict[str, dict]:
    friday = _next_friday().isoformat()
    return {
        "demo-1": {"priority": "high", "category": "school", "action_required": True,
                   "summary": "Tu tutora pide la presentación del TDR antes del viernes a las 17:00, con la demo y las conclusiones.",
                   "deadline": friday, "deadline_title": "Entregar la presentación del TDR",
                   "suggested_action": "Responde confirmando la entrega y crea un recordatorio.",
                   "tasks": [{"title": "Enviar la presentación del TDR a Marta", "due": friday}]},
        "demo-2": {"priority": "medium", "category": "personal", "action_required": False,
                   "summary": "El entrenamiento del martes cambia a las 18:00 en la pista 2.",
                   "deadline": "", "deadline_title": "", "suggested_action": "Nada que hacer; ya está en tu calendario.",
                   "tasks": []},
        "demo-3": {"priority": "medium", "category": "personal", "action_required": True,
                   "summary": "Laura propone repasar integrales mañana después de clase.",
                   "deadline": "", "deadline_title": "", "suggested_action": "Contesta a Laura si te va bien.",
                   "tasks": [{"title": "Contestar a Laura sobre el repaso de mates", "due": ""}]},
        "demo-4": {"priority": "low", "category": "notification", "action_required": False,
                   "summary": "Boletín semanal con noticias de IA.", "deadline": "", "deadline_title": "",
                   "suggested_action": "Léelo cuando tengas tiempo o archívalo.", "tasks": []},
        "demo-5": {"priority": "medium", "category": "school", "action_required": True,
                   "summary": "Inscripción abierta a la jornada de puertas abiertas de Ingeniería Informática; plazas limitadas.",
                   "deadline": "", "deadline_title": "", "suggested_action": "Inscríbete si te interesa.",
                   "tasks": [{"title": "Inscribirme a la jornada de puertas abiertas", "due": ""}]},
    }


def mail(query: str = "", limit: int = 15) -> list[dict]:
    q = (query or "").lower()
    items = _mail()
    if "is:unread" in q:
        items = [m for m in items if "UNREAD" in m["labels"]]
    if "is:important" in q:
        items = [m for m in items if "IMPORTANT" in m["labels"]]
    if "has:attachment" in q:
        items = [m for m in items if m["has_attachments"]]
    words = [w for w in q.split() if ":" not in w]
    if words:
        items = [m for m in items if all(w in (m["subject"] + m["from"] + m["snippet"]).lower() for w in words)]
    return items[:limit]


def message(message_id: str) -> dict | None:
    return next((m for m in _mail() if m["id"] == message_id), None)


def analysis(message_id: str) -> dict | None:
    return _analysis().get(message_id)


DRAFTS = {
    "demo-1": "Hola Marta,\n\nGracias por el recordatorio. Te envío la presentación del TDR antes del viernes a las 17:00, "
              "con la demo del asistente y las conclusiones.\n\nUn saludo",
    "demo-3": "¡Hola Laura! Sí, mañana después de clase me va perfecto. ¿Quedamos en la biblioteca?",
}


def draft(message_id: str) -> str:
    return DRAFTS.get(message_id, "Gracias por tu mensaje. Lo reviso y te contesto pronto.\n\nUn saludo")


def events() -> list[dict]:
    return [
        {"title": "Matemáticas", "start": _today_at(9).isoformat(), "end": _today_at(10).isoformat(),
         "location": "Aula 12", "link": ""},
        {"title": "Reunión con la tutora del TDR", "start": _today_at(13).isoformat(),
         "end": _today_at(13, 30).isoformat(), "location": "Departamento", "link": ""},
        {"title": "Entrenamiento", "start": _today_at(18).isoformat(), "end": _today_at(19, 30).isoformat(),
         "location": "Pista 2", "link": ""},
    ]


def deadlines() -> list[dict]:
    return [{"title": "Entregar la presentación del TDR", "due": _next_friday().isoformat(),
             "source": "Marta Puig", "href": "/inbox?id=demo-1"}]


def automations() -> list[dict]:
    """For the presentation view; not real n8n workflows."""
    return [
        {"name": "Email Assistant", "flow": "Gmail → Gemini → Telegram", "status": "active", "runs": 142,
         "success_rate": 98.6, "last_run_minutes": 2, "avg_duration_ms": 2400},
        {"name": "Daily Briefing", "flow": "Gmail + Calendar → Gemini → Telegram", "status": "active", "runs": 31,
         "success_rate": 100.0, "last_run_minutes": 95, "avg_duration_ms": 4100},
        {"name": "Important Email Alert", "flow": "Gmail → AI → Telegram", "status": "active", "runs": 58,
         "success_rate": 96.6, "last_run_minutes": 12, "avg_duration_ms": 1900},
        {"name": "Failed Automation Alert", "flow": "n8n → Telegram", "status": "active", "runs": 3,
         "success_rate": 100.0, "last_run_minutes": 300, "avg_duration_ms": 600},
    ]


def executions() -> list[dict]:
    t = _now().replace(second=0, microsecond=0)

    def at(offset_s: int) -> str:
        return (t - dt.timedelta(minutes=18) + dt.timedelta(seconds=offset_s)).isoformat()

    return [
        {"id": "demo-run-1", "automation": "Email Assistant", "status": "success", "started_at": at(0),
         "duration_ms": 2400, "mode": "trigger",
         "steps": [{"label": "New email in Gmail", "node": "trigger", "status": "success", "items": 1, "duration_ms": 310, "error": None, "at": at(0)},
                   {"label": "Analyze with Gemini", "node": "ai", "status": "success", "items": 1, "duration_ms": 1650, "error": None, "at": at(1)},
                   {"label": "Send Telegram notification", "node": "tg", "status": "success", "items": 1, "duration_ms": 440, "error": None, "at": at(2)}]},
        {"id": "demo-run-2", "automation": "Important Email Alert", "status": "error", "started_at": at(-3600),
         "duration_ms": 30200, "mode": "trigger",
         "steps": [{"label": "New email in Gmail", "node": "trigger", "status": "success", "items": 1, "duration_ms": 280, "error": None, "at": at(-3600)},
                   {"label": "Classify with Gemini", "node": "ai", "status": "error", "items": 0, "duration_ms": 29900,
                    "error": "Gemini timed out after 30 s", "at": at(-3599)},
                   {"label": "Send Telegram notification", "node": "tg", "status": "skipped", "items": 0, "duration_ms": None, "error": None, "at": None}]},
    ]


def errors() -> list[dict]:
    return [{
        "id": "demo-error-1", "title": "AI provider failed", "severity": "medium", "service": "AI",
        "automation": "Important Email Alert", "source": "automation", "count": 1,
        "explanation": "The AI step could not get an answer from the configured model.",
        "cause": "Gemini did not answer within 30 seconds.",
        "message": "Gemini timed out after 30 s",
        "impact": {"automations": 1, "features": ["Important email alerts"]},
        "action": {"label": "Retry", "href": "/executions/demo-run-2", "kind": "retry"},
        "first_seen": _now().isoformat(), "last_seen": _now().isoformat(), "link": None,
    }]
