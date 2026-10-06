#!/usr/bin/env python3
"""Real-service validation: Gmail -> Personal Assistant -> AI -> n8n -> Telegram.

Run it against a running installation AFTER you have connected the services in
the panel (Integrations). It uses only the public API, with your own login, and
it is read-only unless you pass --send-telegram.

    python scripts/real-check.py --api http://localhost:8082 --user you@example.com

The password is read from the PA_PASSWORD environment variable or asked for
interactively; it is never put on the command line, in a file or in the output.

Every step reports one of:
    PASS  worked against the real service
    FAIL  reached the service and it failed (the reason is shown)
    SKIP  not connected / not configured - nothing was tested, and nothing is claimed

What it prints is deliberately poor: counts, priorities, durations, yes/no.
Never an email subject or body, a token, a key or a client secret.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Callable

Request = Callable[[str, str, dict | None], tuple[int, dict]]

_SECRET = re.compile(r"(ya29\.[\w-]+|1//[\w-]+|AIza[\w-]{20,}|\d{6,}:[\w-]{30,}|GOCSPX-[\w-]+|sk-[\w-]{10,}|nvapi-[\w-]+|Bearer\s+[\w.-]+)")


def redact(text: str) -> str:
    return _SECRET.sub("[redacted]", str(text))[:200]


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, step: str, detail: str = "") -> None:
        self.rows.append((status, step, redact(detail)))
        print(f"  {status:<4}  {step}" + (f"  - {redact(detail)}" if detail else ""))

    @property
    def failed(self) -> bool:
        return any(s == "FAIL" for s, _, _ in self.rows)


def run(call: Request, *, send_telegram: bool = False, out: Report | None = None) -> Report:
    r = out or Report()

    st, h = call("GET", "/api/health", None)
    r.add("PASS" if st == 200 and h.get("status") == "ok" else "FAIL", "Backend", f"version {h.get('version', '?')}, database {h.get('database', '?')}")

    st, integ = call("GET", "/api/integrations", None)
    by = {i["key"]: i for i in integ.get("data", [])} if st == 200 else {}

    # ---- Gmail (real) ------------------------------------------------------
    google = by.get("google")
    if not google or not google.get("connected"):
        r.add("SKIP", "Google / Gmail", "not connected - connect it in Integrations first")
        first_id = None
    else:
        st, t = call("POST", "/api/integrations/google/test", None)
        r.add("PASS" if st == 200 and t.get("ok") else "FAIL", "Google connection test", ", ".join(f"{c['label']}={'ok' if c['ok'] else 'FAIL'}" for c in t.get("checks", [])))
        st, m = call("GET", "/api/assistant/mail?q=in%3Ainbox&limit=5", None)
        mails = m.get("data", []) if st == 200 else []
        r.add("PASS" if st == 200 else "FAIL", "Read email (Gmail API)", f"{len(mails)} message(s) listed" if st == 200 else str(m.get("detail", st)))
        first_id = mails[0]["id"] if mails else None

    # ---- AI (real) ---------------------------------------------------------
    st, ai = call("GET", "/api/ai/health", None)
    status = ai.get("status")
    if st != 200 or status in (None, "not_configured"):
        r.add("SKIP", "AI provider", "not configured - add a key in Settings > AI")
        ai_ok = False
    else:
        ai_ok = status == "online"
        r.add("PASS" if ai_ok else "FAIL", f"AI provider ({ai.get('provider', '?')})", f"{status}, {ai.get('latency_ms', '?')} ms")

    # ---- the Gmail -> AI step ------------------------------------------------
    if first_id and ai_ok:
        t0 = time.time()
        st, a = call("POST", f"/api/assistant/mail/{first_id}/analyze", None)
        if st == 200:
            r.add("PASS", "AI analysis of a real email", f"priority={a.get('priority')}, category={a.get('category')}, action_required={a.get('action_required')}, {int((time.time() - t0) * 1000)} ms")
        else:
            r.add("FAIL", "AI analysis of a real email", str(a.get("detail", st)))
    else:
        r.add("SKIP", "AI analysis of a real email", "needs both Google and the AI provider")

    # ---- n8n (real) ----------------------------------------------------------
    st, n = call("GET", "/api/n8n-center", None)
    if st != 200 or not n.get("available"):
        r.add("SKIP" if (n or {}).get("state") == "not_configured" else "FAIL", "n8n", (n or {}).get("message") or (n or {}).get("error") or f"HTTP {st}")
    else:
        t = n.get("totals") or {}
        r.add("PASS", "n8n", f"{t.get('workflows')} workflows, {t.get('executions_today')} executions today, success today {t.get('success_rate_today')}")

    # ---- Telegram (real) -----------------------------------------------------
    tg = by.get("telegram")
    if not tg or not tg.get("connected"):
        r.add("SKIP", "Telegram", "not connected - connect it in Integrations first")
    else:
        st, t = call("POST", "/api/integrations/telegram/test", None)
        r.add("PASS" if st == 200 and t.get("ok") else "FAIL", "Telegram connection test", ", ".join(f"{c['label']}={'ok' if c['ok'] else 'FAIL'}" for c in t.get("checks", [])))
        if send_telegram and st == 200 and t.get("ok"):
            st, s = call("POST", "/api/integrations/telegram/test-message", None)
            r.add("PASS" if st == 200 and s.get("sent") else "FAIL", "Telegram message delivered", "check your chat")
        elif not send_telegram:
            r.add("SKIP", "Telegram message delivered", "pass --send-telegram to send a real test message")
    return r


def _http(api: str, token: str | None) -> Request:
    def call(method: str, path: str, body: dict | None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else (b"{}" if method == "POST" else None)
        req = urllib.request.Request(api.rstrip("/") + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                return e.code, {}
        except OSError as e:
            return 0, {"detail": f"unreachable: {type(e).__name__}"}

    return call


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default=os.environ.get("PA_API", "http://localhost:8082"))
    p.add_argument("--user", default=os.environ.get("PA_USER"), help="email or username")
    p.add_argument("--send-telegram", action="store_true", help="also send one real test message to your chat")
    args = p.parse_args(argv)
    if not args.user:
        p.error("--user (or PA_USER) is required")
    password = os.environ.get("PA_PASSWORD") or getpass.getpass("Password: ")
    st, login = _http(args.api, None)("POST", "/api/auth/login", {"identifier": args.user, "password": password})
    if st != 200:
        print("Login failed.", file=sys.stderr)
        return 2
    print(f"Real-service check against {args.api}\n")
    report = run(_http(args.api, login["access_token"]), send_telegram=args.send_telegram)
    skipped = sum(1 for s, _, _ in report.rows if s == "SKIP")
    print(f"\n{sum(1 for s, _, _ in report.rows if s == 'PASS')} passed, {sum(1 for s, _, _ in report.rows if s == 'FAIL')} failed, {skipped} skipped (skipped = not tested).")
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
