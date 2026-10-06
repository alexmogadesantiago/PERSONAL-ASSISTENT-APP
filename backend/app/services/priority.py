"""Personal priority engine: LOW / NORMAL / HIGH / URGENT, with the reasons.

The AI reads the email; this module decides how much it matters *to this user*
and says why. It is deliberately a transparent weighted score rather than a
second model call, so every level can be explained line by line ("Known
important sender", "Deadline in 2 days", "Requires a response") - which is
what the Inbox, the briefing and Telegram show.

Signals and weights (positive raises, negative lowers):

    important sender (AI memory)          +35
    you write to each other often         +10
    Gmail marked it important             +10
    urgency words (urgent, asap, hoy...)  +20
    deadline detected                     +20
    deadline within 48 h                  +15
    requires a response / action          +15
    AI judged it high / low               +10 / -10
    automated sender (no-reply, news...)  -25

Thresholds: >= 70 urgent, >= 40 high, >= 15 normal, otherwise low.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

LEVELS = ("low", "normal", "high", "urgent")

_URGENT = re.compile(
    r"\b(urgent|urgente|urgentment|asap|immediately|inmediato|immediat|today|hoy|avui|important|importante|"
    r"deadline|fecha l[ií]mite|data l[ií]mit|last chance|[uú]ltimo d[ií]a|action required|acci[oó]n requerida)\b",
    re.I)
_AUTOMATED = re.compile(r"(no-?reply|noreply|notifications?@|newsletter|mailer|marketing|news@|info@|digest)", re.I)
_DEADLINE_WORDS = re.compile(
    r"\b(due|deadline|by (monday|tuesday|wednesday|thursday|friday|tomorrow)|antes del|para el|entrega|entregar|"
    r"fecha l[ií]mite|plazo|abans de|lliurament)\b", re.I)


@dataclass
class Reason:
    label: str
    weight: int

    def view(self) -> dict:
        return {"label": self.label, "weight": self.weight, "positive": self.weight > 0}


def _level(score: int) -> str:
    if score >= 70:
        return "urgent"
    if score >= 40:
        return "high"
    if score >= 15:
        return "normal"
    return "low"


def _deadline(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        d = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def score(email: dict, analysis: dict | None = None, *, important: dict[str, str] | None = None,
          sender_count: int = 0, now: dt.datetime | None = None) -> dict:
    """`email`: from, subject, snippet/text, labels. `analysis`: the AI triage (optional)."""
    from app.services.memory import address_of

    analysis = analysis or {}
    important = important or {}
    now = now or dt.datetime.now(dt.timezone.utc)
    sender = str(email.get("from") or "")
    addr = address_of(sender)
    domain = "@" + addr.split("@", 1)[1] if "@" in addr else ""
    text = " ".join(str(email.get(k) or "") for k in ("subject", "snippet", "text"))[:4000]
    reasons: list[Reason] = []

    if addr in important or (domain and (domain in important or domain.lstrip("@") in important)):
        label = important.get(addr) or important.get(domain) or ""
        reasons.append(Reason(f"Known important sender{f' ({label})' if label else ''}", 35))
    elif sender_count >= 3:
        reasons.append(Reason("You hear from this sender often", 10))
    if "IMPORTANT" in (email.get("labels") or []):
        reasons.append(Reason("Gmail marked it important", 10))
    if _URGENT.search(text):
        reasons.append(Reason("Urgency words in the message", 20))

    deadline = _deadline(analysis.get("deadline"))
    if deadline or _DEADLINE_WORDS.search(text):
        reasons.append(Reason("Deadline detected", 20))
        if deadline and dt.timedelta(0) <= deadline - now <= dt.timedelta(hours=48):
            reasons.append(Reason("Deadline within 48 hours", 15))
    if analysis.get("action_required"):
        reasons.append(Reason("Requires a response or action", 15))
    ai = str(analysis.get("priority") or "").lower()
    if ai in ("high", "urgent"):
        reasons.append(Reason("The AI judged it important", 10))
    elif ai == "low":
        reasons.append(Reason("The AI judged it low priority", -10))
    if _AUTOMATED.search(sender):
        reasons.append(Reason("Automated sender (newsletter / no-reply)", -25))

    total = sum(r.weight for r in reasons)
    return {"level": _level(total), "score": total, "reasons": [r.view() for r in reasons]}


def at_least(level: str, minimum: str) -> bool:
    return LEVELS.index(level if level in LEVELS else "normal") >= LEVELS.index(minimum)
