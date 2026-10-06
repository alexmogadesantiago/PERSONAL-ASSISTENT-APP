"""The real-service check script: its logic and its discretion (no real service involved)."""
from __future__ import annotations

import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "real-check.py"


def _load():
    if not SCRIPT.exists():  # the backend image's test stage only copies backend/
        import pytest

        pytest.skip("scripts/ is not in this build context")
    spec = importlib.util.spec_from_file_location("real_check", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fake(answers):
    def call(method, path, body):
        for key, value in answers.items():
            if path.startswith(key.split(" ", 1)[1]) and method == key.split(" ", 1)[0]:
                return value
        return 404, {}

    return call


def test_nothing_connected_is_skipped_not_passed():
    mod = _load()
    r = mod.run(fake({
        "GET /api/health": (200, {"status": "ok", "version": "3.0.0", "database": "ok"}),
        "GET /api/integrations": (200, {"data": [{"key": "google", "connected": False}, {"key": "telegram", "connected": False}]}),
        "GET /api/ai/health": (200, {"status": "not_configured"}),
        "GET /api/n8n-center": (200, {"available": False, "state": "not_configured"}),
    }))
    by = {step: status for status, step, _ in r.rows}
    assert by["Backend"] == "PASS"
    assert by["Google / Gmail"] == "SKIP" and by["Telegram"] == "SKIP" and by["AI provider"] == "SKIP"
    assert by["AI analysis of a real email"] == "SKIP", "no Gmail claim is made when Gmail was never reached"
    assert not r.failed


def test_a_real_failure_is_a_failure_with_its_reason():
    mod = _load()
    r = mod.run(fake({
        "GET /api/health": (200, {"status": "ok"}),
        "GET /api/integrations": (200, {"data": [{"key": "google", "connected": True}]}),
        "POST /api/integrations/google/test": (200, {"ok": False, "checks": [{"label": "Authentication", "ok": False}]}),
        "GET /api/assistant/mail": (409, {"detail": "Google needs you to sign in again."}),
        "GET /api/ai/health": (200, {"status": "online", "provider": "gemini", "latency_ms": 900}),
    }))
    assert r.failed
    assert any(s == "FAIL" and step == "Read email (Gmail API)" for s, step, _ in r.rows)


def test_output_never_carries_a_secret_or_an_email_subject():
    mod = _load()
    r = mod.run(fake({
        "GET /api/health": (200, {"status": "ok"}),
        "GET /api/integrations": (200, {"data": [{"key": "google", "connected": True}]}),
        "POST /api/integrations/google/test": (200, {"ok": True, "checks": [{"label": "Authentication", "ok": True}]}),
        "GET /api/assistant/mail": (200, {"data": [{"id": "m1", "subject": "Salary: confidential", "snippet": "secret plans"}]}),
        "GET /api/ai/health": (200, {"status": "online", "provider": "gemini", "latency_ms": 100}),
        "POST /api/assistant/mail/m1/analyze": (200, {"priority": "high", "category": "work", "action_required": True, "summary": "Salary: confidential"}),
    }))
    printed = "\n".join(f"{s} {step} {d}" for s, step, d in r.rows)
    assert "Salary" not in printed and "secret plans" not in printed, "mail content is never printed"
    assert "priority=high" in printed
    assert mod.redact("token ya29.a0AfH6SMB-secret and 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123") == "token [redacted] and [redacted]"
    assert mod.redact("Bearer abc.def-ghi") == "[redacted]"
