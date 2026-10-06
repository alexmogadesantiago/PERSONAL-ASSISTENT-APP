"""Daily usage counters (AI requests, automation steps) for the dashboard.

Kept in the `service_configs` row "usage" (meta: {"YYYY-MM-DD": {counter: n}})
rather than as one audit event per call: the Email assistant alone can make a
model call a minute, and the activity trail is for things a person reads.
Fourteen days are kept; nothing here is a secret.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import ServiceConfig

KEEP_DAYS = 14


def _today() -> str:
    return dt.date.today().isoformat()


def bump(db: Session, counter: str, by: int = 1) -> None:
    try:
        row = db.get(ServiceConfig, "usage")
        if row is None:
            row = ServiceConfig(service="usage", base_url="", meta={})
            db.add(row)
        meta = dict(row.meta or {})
        day = dict(meta.get(_today()) or {})
        day[counter] = int(day.get(counter, 0)) + by
        meta[_today()] = day
        for key in sorted(k for k in meta if len(k) == 10)[:-KEEP_DAYS]:
            meta.pop(key, None)
        row.meta = meta
        flag_modified(row, "meta")
        db.commit()
    except Exception:  # noqa: BLE001 - a counter must never break a request
        db.rollback()


def read(db: Session, days: int = 7) -> dict[str, dict[str, int]]:
    row = db.get(ServiceConfig, "usage")
    meta = dict(row.meta or {}) if row else {}
    start = dt.date.today() - dt.timedelta(days=days - 1)
    out = {}
    for i in range(days):
        d = (start + dt.timedelta(days=i)).isoformat()
        out[d] = {k: int(v) for k, v in (meta.get(d) or {}).items()}
    return out
