"""From a sentence to an automation draft, and the curated templates.

`draft()` asks the configured model to express the user's intent with the
blocks in the catalogue - and only those. The answer is validated by the same
`spec.normalise` the builder uses, so an AI draft can never contain a block,
a parameter or an option the engine does not implement. When the model's
draft is incomplete the problems are returned with it and the builder shows
them, instead of the draft being silently "fixed".
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.services.automations import catalog
from app.services.automations import spec as specmod

TEMPLATES: list[dict] = [
    # ---- the Personal Assistant set: Gmail + AI + Telegram + Calendar ----
    {
        "id": "email-assistant", "title": "Email Assistant", "category": "Assistant", "flow": "Gmail → AI → Telegram",
        "description": "Every new email is summarised by AI and sent to your Telegram, so you know what arrived without opening Gmail.",
        "spec": {
            "name": "Email Assistant",
            "description": "New Gmail messages, summarised on Telegram.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox is:unread -category:promotions -category:social", "every_minutes": "15"}},
            "steps": [
                {"block": "ai.summarize", "params": {"instruction": "Summarize in two sentences and say if it needs an answer."}},
                {"block": "telegram.send", "params": {"message": "📧 {{from}}\n{{subject}}\n\n{{summary}}"}},
            ],
        },
    },
    {
        "id": "daily-briefing", "title": "Daily Briefing", "category": "Assistant", "flow": "Gmail → AI → Telegram",
        "description": "Every morning, your important unread email turned into a short briefing on Telegram (the dashboard briefing also adds your calendar).",
        "spec": {
            "name": "Daily Briefing",
            "description": "Morning briefing of important unread email.",
            "trigger": {"block": "schedule", "params": {"every": "day", "at": "08:00"}},
            "steps": [
                {"block": "gmail.search", "params": {"query": "in:inbox is:unread newer_than:1d -category:promotions", "max": 15}},
                {"block": "transform.combine", "params": {}},
                {"block": "ai.compose", "params": {"prompt": "Write a friendly morning briefing of these {{count}} emails: what matters first, what needs a reply, max 120 words."}},
                {"block": "telegram.send", "params": {"message": "☀️ Your briefing\n\n{{text}}"}},
            ],
        },
    },
    {
        "id": "important-email-alert", "title": "Important Email Alert", "category": "Assistant", "flow": "Gmail → AI → Telegram",
        "description": "AI classifies each new email; only the important ones reach your phone, with the reason.",
        "spec": {
            "name": "Important Email Alert",
            "description": "AI importance check of new Gmail messages.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox is:unread", "every_minutes": "5"}},
            "steps": [
                {"block": "ai.classify", "params": {"categories": "important, normal, ignore", "instruction": "Important = a person needs something from me, a deadline, school or work."}},
                {"block": "condition.match", "params": {"field": "category", "operator": "equals", "value": "important"}},
                {"block": "telegram.send", "params": {"message": "⭐ Important email from {{from}}\n{{subject}}\n\nWhy: {{reason}}\n{{link}}"}},
            ],
        },
    },
    {
        "id": "deadline-detector", "title": "Deadline Detector", "category": "Assistant", "flow": "Gmail → AI → Calendar",
        "description": "When an email mentions a due date, AI extracts it and adds a reminder to your calendar.",
        "spec": {
            "name": "Deadline Detector",
            "description": "Deadlines in new email become calendar reminders.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox (deadline OR entrega OR plazo OR due)", "every_minutes": "15"}},
            "steps": [
                {"block": "ai.extract", "params": {"fields": "deadline, task", "instruction": "deadline: ISO 8601 date-time with timezone, empty if none. task: what must be done, in a few words."}},
                {"block": "condition.match", "params": {"field": "extracted.deadline", "operator": "not_empty"}},
                {"block": "calendar.create_event", "params": {"title": "⏰ {{extracted.task}}", "start": "{{extracted.deadline}}",
                                                              "duration_minutes": 30, "description": "From: {{from}}\n{{subject}}\n{{link}}"}},
            ],
        },
    },
    {
        "id": "email-summarizer", "title": "Email Summarizer", "category": "Assistant", "flow": "Gmail → AI → Drive",
        "description": "Long emails summarised and kept as notes in Drive.",
        "spec": {
            "name": "Email Summarizer",
            "description": "Summaries of long emails saved to Drive.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox is:unread larger:20K", "every_minutes": "60"}},
            "steps": [
                {"block": "ai.summarize", "params": {"instruction": "Summarize in five bullet points with any dates and actions."}},
                {"block": "drive.save_text", "params": {"name": "Summary - {{subject}}.md", "content": "# {{subject}}\n\nFrom: {{from}}\n\n{{summary}}"}},
            ],
        },
    },
    {
        "id": "invoices", "title": "File invoices automatically", "category": "Email",
        "description": "When an invoice arrives in Gmail, extract the amount and vendor, save a note to Drive and tell you on Telegram.",
        "spec": {
            "name": "Invoice processing",
            "description": "Invoices from Gmail are summarised, filed in Drive and announced on Telegram.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "has:attachment (invoice OR factura OR receipt)", "every_minutes": "15"}},
            "steps": [
                {"block": "ai.extract", "params": {"fields": "vendor, amount, due_date"}},
                {"block": "drive.save_text", "params": {"name": "Invoice - {{extracted.vendor}} - {{date}}.md",
                                                        "content": "# {{subject}}\n\nFrom: {{from}}\nAmount: {{extracted.amount}}\nDue: {{extracted.due_date}}\n\n{{snippet}}"}},
                {"block": "telegram.send", "params": {"message": "🧾 Invoice from {{extracted.vendor}}: {{extracted.amount}} (due {{extracted.due_date}})\n{{drive_link}}"}},
            ],
        },
    },
    {
        "id": "urgent-email", "title": "Alert me about urgent email", "category": "Email",
        "description": "Every new email is classified by AI; only the urgent ones reach your phone.",
        "spec": {
            "name": "Urgent email alerts",
            "description": "AI triage of new Gmail messages; urgent ones go to Telegram.",
            "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox is:unread", "every_minutes": "5"}},
            "steps": [
                {"block": "ai.classify", "params": {"categories": "urgent, normal", "instruction": "Urgent = needs action today or comes from a person waiting on me."}},
                {"block": "condition.match", "params": {"field": "category", "operator": "equals", "value": "urgent"}},
                {"block": "telegram.send", "params": {"message": "⚠️ Urgent email from {{from}}\n{{subject}}\n\n{{reason}}\n{{link}}"}},
            ],
        },
    },
    {
        "id": "weekly-digest", "title": "Monday digest of important email", "category": "Email",
        "description": "Every Monday at 08:00, a summary of last week's important email.",
        "spec": {
            "name": "Weekly important email digest",
            "description": "Monday 08:00 summary of important Gmail messages.",
            "trigger": {"block": "schedule", "params": {"every": "week", "at": "08:00", "weekday": "1"}},
            "steps": [
                {"block": "gmail.search", "params": {"query": "is:important newer_than:7d", "max": 20}},
                {"block": "transform.combine", "params": {}},
                {"block": "ai.compose", "params": {"prompt": "Write a short digest of these {{count}} emails: group by topic, flag what needs a reply, one line each."}},
                {"block": "telegram.send", "params": {"message": "📬 Your week in email\n\n{{text}}"}},
            ],
        },
    },
    {
        "id": "awaiting-reply", "title": "Emails waiting for my reply", "category": "Email",
        "description": "Every weekday, the unread emails older than two days.",
        "spec": {
            "name": "Emails awaiting reply",
            "description": "Weekday reminder of unanswered email.",
            "trigger": {"block": "schedule", "params": {"every": "weekdays", "at": "09:00"}},
            "steps": [
                {"block": "gmail.search", "params": {"query": "in:inbox is:unread older_than:2d", "max": 15}},
                {"block": "transform.combine", "params": {}},
                {"block": "ai.compose", "params": {"prompt": "List these {{count}} emails as a to-reply list: sender, subject, one suggested next step each."}},
                {"block": "telegram.send", "params": {"message": "✉️ Waiting for your reply\n\n{{text}}"}},
            ],
        },
    },
    {
        "id": "daily-agenda", "title": "Morning agenda", "category": "Calendar",
        "description": "Weekdays at 07:30, today's events with a short briefing.",
        "spec": {
            "name": "Morning agenda",
            "description": "Today's calendar, briefed by AI.",
            "trigger": {"block": "schedule", "params": {"every": "weekdays", "at": "07:30"}},
            "steps": [
                {"block": "calendar.list_events", "params": {"days": "1"}},
                {"block": "transform.combine", "params": {}},
                {"block": "ai.compose", "params": {"prompt": "Write a friendly morning briefing of these {{count}} events: times, what to prepare, gaps for focus work."}},
                {"block": "telegram.send", "params": {"message": "☀️ Today\n\n{{text}}"}},
            ],
        },
    },
    {
        "id": "github-reviews", "title": "Pull requests waiting for me", "category": "GitHub",
        "description": "Weekdays at 09:00, the PRs that requested your review.",
        "spec": {
            "name": "Review requests digest",
            "description": "Open PRs waiting for my review.",
            "trigger": {"block": "schedule", "params": {"every": "weekdays", "at": "09:00"}},
            "steps": [
                {"block": "github.pull_requests", "params": {}},
                {"block": "transform.combine", "params": {}},
                {"block": "ai.compose", "params": {"prompt": "Summarise these {{count}} pull requests waiting for my review, oldest first, one line each with the repo."}},
                {"block": "telegram.send", "params": {"message": "🔍 Reviews waiting\n\n{{text}}"}},
            ],
        },
    },
    {
        "id": "github-notify", "title": "GitHub notifications on Telegram", "category": "GitHub",
        "description": "Mentions, review requests and CI alerts as they happen.",
        "spec": {
            "name": "GitHub notifications",
            "description": "Forward new GitHub notifications.",
            "trigger": {"block": "github.notifications", "params": {"every_minutes": "15"}},
            "steps": [{"block": "telegram.send", "params": {"message": "🐙 {{repo}} · {{type}} ({{reason}})\n{{title}}\n{{link}}"}}],
        },
    },
    {
        "id": "outlook-urgent", "title": "Urgent Outlook mail to Telegram", "category": "Microsoft",
        "description": "The Microsoft 365 version of urgent-email alerts.",
        "spec": {
            "name": "Urgent Outlook alerts",
            "description": "AI triage of new Outlook mail.",
            "trigger": {"block": "outlook.new_email", "params": {"every_minutes": "5"}},
            "steps": [
                {"block": "ai.classify", "params": {"categories": "urgent, normal"}},
                {"block": "condition.match", "params": {"field": "category", "operator": "equals", "value": "urgent"}},
                {"block": "telegram.send", "params": {"message": "⚠️ Outlook: {{from}}\n{{subject}}\n{{link}}"}},
            ],
        },
    },
]


def templates() -> list[dict]:
    out = []
    for t in TEMPLATES:
        spec = specmod.normalise(t["spec"])
        out.append({**t, "spec": spec, "providers": specmod.providers_of(spec)})
    return out


def _catalogue_for_prompt() -> str:
    lines = []
    for b in catalog.BLOCKS:
        params = []
        for p in b.params:
            opt = f" one of [{', '.join(v for v, _ in p.options)}]" if p.options else ""
            params.append(f"{p.key}{'*' if p.required else ''}{opt}")
        outs = f" -> adds {', '.join(b.outputs)}" if b.outputs else ""
        lines.append(f"- {b.key} ({b.kind}{', ' + b.provider if b.provider else ''}): {b.description} "
                     f"params: {', '.join(params) or 'none'}{outs}")
    return "\n".join(lines)


DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "trigger": {"type": "object", "properties": {"block": {"type": "string"}, "params": {"type": "object"}},
                    "required": ["block", "params"]},
        "steps": {"type": "array", "items": {"type": "object", "properties": {
            "block": {"type": "string"}, "params": {"type": "object"}}, "required": ["block", "params"]}},
        "explanation": {"type": "string"},
    },
    "required": ["name", "description", "trigger", "steps", "explanation"],
}


async def draft(db: Session, prompt: str) -> dict:
    from app.services.ai.errors import AIError
    from app.services.ai.service import AIService

    system = (
        "You turn a person's request into an automation for Personal Assistant. Use ONLY these blocks "
        "(key, kind, provider, params; * = required; 'adds' lists fields later steps can use as {{field}}):\n"
        f"{_catalogue_for_prompt()}\n\n"
        "Rules: exactly one trigger block; then 1-8 steps in order. To send several items as one message, "
        "put transform.combine before the AI or message step and refer to {{count}} / {{text}}. Use "
        "condition.match to filter. Message templates may use {{field}} placeholders from earlier blocks. "
        "Schedule 'at' is HH:MM 24h; weekday 1=Monday..7=Sunday. Write the name and description in the "
        "language of the request. 'explanation' is one sentence telling the user what the automation does."
    )
    try:
        result = await AIService.from_db(db).generate(
            [{"role": "system", "content": system}, {"role": "user", "content": prompt[:1500]}],
            response_format={"type": "json_schema", "schema": DRAFT_SCHEMA},
            temperature=0.2,
        )
    except AIError as exc:
        return {"ok": False, "error": exc.message, "spec": None, "problems": []}
    data = result.response.data if isinstance(result.response.data, dict) else {}
    explanation = str(data.pop("explanation", "") or "")
    raw = {
        "name": str(data.get("name") or "New automation")[:120],
        "description": str(data.get("description") or "")[:500],
        "trigger": data.get("trigger") or {"block": "manual", "params": {}},
        "steps": [s for s in (data.get("steps") or []) if isinstance(s, dict)][: specmod.MAX_STEPS],
    }
    try:
        spec = specmod.normalise(raw)
        return {"ok": True, "spec": spec, "providers": specmod.providers_of(spec), "explanation": explanation,
                "problems": []}
    except specmod.SpecError as exc:
        # keep what is usable so the builder can show it with the problems
        raw["steps"] = [s for s in raw["steps"] if catalog.get(str(s.get("block")))]
        return {"ok": False, "spec": raw, "providers": [], "explanation": explanation, "problems": exc.problems}
    except ValueError as exc:
        return {"ok": False, "spec": None, "problems": [re.sub(r"\s+", " ", str(exc))[:300]], "explanation": explanation}

