"""CI only: create the owner of a FRESH n8n and an API key for it.

In GitHub Actions the key is masked (`::add-mask::` on stdout, where the runner
reads workflow commands) and appended to $GITHUB_ENV as AC_N8N_API_KEY, so it
never appears in the job log. Elsewhere it prints `AC_N8N_API_KEY=<key>`. The
owner password is random and thrown away: the n8n container lives for one job.

    python scripts/ci/n8n_api_key.py [base_url]
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5678").rstrip("/")
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.ProxyHandler({})
)


def call(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"content-type": "application/json"},
    )
    try:
        with opener.open(request, timeout=30) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} {path} -> HTTP {exc.code}: {exc.read()[:200]!r}")


# /healthz answers before the REST API is ready, and while starting n8n
# answers every route with a plain "n8n is starting up" page: wait for JSON.
for _ in range(90):
    try:
        with opener.open(BASE + "/rest/settings", timeout=5) as response:
            if "data" in json.loads(response.read() or b"{}"):
                break
    except (urllib.error.URLError, OSError, ValueError):
        pass
    time.sleep(2)
else:
    sys.exit("n8n's REST API never came up")

password = "Ci-" + secrets.token_urlsafe(18) + "9"
email = "ci-owner@example.com"
call("POST", "/rest/owner/setup", {"email": email, "firstName": "CI", "lastName": "Owner", "password": password})
call("POST", "/rest/login", {"emailOrLdapLoginId": email, "password": password})
scopes = call("GET", "/rest/api-keys/scopes").get("data") or []
created = call("POST", "/rest/api-keys", {"label": "ci", "expiresAt": None, **({"scopes": scopes} if scopes else {})})
key = (created.get("data") or {}).get("rawApiKey")
if not key:
    sys.exit("n8n did not return an API key")
github_env = os.environ.get("GITHUB_ENV")
if github_env:
    print(f"::add-mask::{key}")
    with open(github_env, "a", encoding="utf-8") as fh:
        fh.write(f"AC_N8N_API_KEY={key}\n")
    print("AC_N8N_API_KEY written to GITHUB_ENV")
else:
    print(f"AC_N8N_API_KEY={key}")
