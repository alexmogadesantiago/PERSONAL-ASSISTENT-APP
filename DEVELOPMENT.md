# Development

How to run, test and extend Automation Center. For what the pieces are and why,
read [ARCHITECTURE.md](ARCHITECTURE.md) first.

---

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Python | 3.11+ | backend |
| Node.js | 20+ | frontend |
| Docker | 24+ | the full local stack (Postgres, n8n, Playwright) |

---

## Backend

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate   # PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

Run against SQLite (no Docker needed for most work):

```bash
AC_ENVIRONMENT=development AC_DATABASE_URL="sqlite+pysqlite:///./dev.sqlite" uvicorn app.main:app --reload --port 8080
```

Run against the compose Postgres:

```bash
docker compose up -d postgres
AC_DATABASE_URL="postgresql+psycopg://automation:automation@localhost:5432/automation_center" uvicorn app.main:app --reload --port 8080
```

API docs are at `http://localhost:8080/docs`.

### Tests

```bash
cd backend
python -m pytest -q
```

The suite runs on in-memory SQLite and is hermetic: `tests/conftest.py` strips
n8n/AI-provider environment variables so a developer machine that exports them
cannot make the monitor tests pass or fail by accident. The `client` fixture
also points the health probes at the test database, because the monitor opens
its own sessions outside the request cycle.

### Migrations

```bash
cd backend
alembic revision --autogenerate -m "what changed"
alembic upgrade head
```

Migrations must run on both Postgres and SQLite — the test suite and the
desktop install use SQLite paths. Look at `0003_credential_types.py` for how to
guard a Postgres-only operation.

---

## Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxied to VITE_API_URL
```

```bash
npm run build        # tsc --noEmit && vite build
npx vitest run       # tests
npx eslint src --ext .ts,.tsx
```

Configuration comes from Vite env vars only, so the same build runs anywhere:

```
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080
```

---

## Full stack

```bash
cp .env.example .env      # fill in at least AC_JWT_SECRET and AC_CREDENTIAL_ENCRYPTION_KEY
docker compose up -d
```

| URL | Service |
|---|---|
| http://localhost:3000 | Automation Center panel |
| http://localhost:8080/docs | backend API |
| http://localhost:5678 | n8n |
| http://localhost:7777 | legacy profile editor (feeds the n8n Code nodes) |

Generate the two required secrets:

```bash
python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"
```

---

## Adding an integration

Everything a service needs is declared in one place. To add, say, an SMTP
relay:

1. **Declare it** in `backend/app/services/service_config.py`:

   ```python
   "smtp": ServiceSpec(
       key="smtp", label="SMTP", needs_url=True, needs_secret=True,
       settings_url_attr="smtp_base_url", settings_secret_attr="smtp_password",
       env_url_name="AC_SMTP_BASE_URL", env_secret_name="AC_SMTP_PASSWORD",
   ),
   ```

   It now appears in `GET /api/services/config`, gets a card in the panel, and
   resolves database-first automatically.

2. **Add the env fallbacks** to `Settings` in `backend/app/config.py` and to
   `.env.example`.

3. **Write the probe** in `services_probe.py`, returning a `ServiceState` and
   using the state vocabulary honestly — `degraded` when it half-works,
   `not_configured` when nothing is set, never `online` on a guess. Register it
   in `probe_one()`, `probe_services()` and `SERVICE_ORDER`.

4. **Test it.** `tests/test_services_probe.py` shows the pattern: stub
   `_probe_http` per URL fragment and assert on the resulting status.

No frontend change is required — the Settings and Setup pages render whatever
the API lists.

---

## Conventions

* **Routers stay thin.** They validate, call a `services/` function and map
  domain errors to HTTP. No n8n calls or queries in a router.
* **One place per concern.** Before adding a client, a config reader or an
  encryption helper, check `services/` and `core/` — repairing the existing one
  beats a parallel implementation.
* **Never fake a status.** If a dependency is unavailable, implement the real
  client and report the real state. A hard-coded `online`, a mocked success
  response or a swallowed error is worse than a visible failure.
* **Secrets stay in the backend.** They may enter through the API and leave
  only as a hint. Never log them, never put them in a URL, never return them.
* **Comments explain why.** The code already says what it does.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Everything shows `not_configured` | Only the backend is deployed | Expected. Configure the services in Settings → Services. |
| n8n is `degraded` | Reachable, but the API key is rejected | Regenerate it in n8n → Settings → n8n API and save it again in the panel. |
| Saving a key returns 503 | `AC_CREDENTIAL_ENCRYPTION_KEY` is unset | Generate a Fernet key and set it; without it nothing can be stored encrypted. |
| AI is `invalid` | The configured provider refuses the key | `invalid` means rejected, not unreachable. Check the key in that provider's console (build.nvidia.com / openrouter.ai / aistudio.google.com) and re-test from Settings → Artificial Intelligence. |
| AI is `degraded` | The primary provider is down and the fallback is serving | Not an outage: the automations still run. The tile names both providers. |
| AI is `not_configured` | No provider holds a credential | Normal for a fresh install. Add one in Settings → Artificial Intelligence. |
| Profile stays `not_configured` | The row exists but the required fields are empty | Open /setup → Profile; it lists exactly which fields are missing. |
| A stale status after a config change | The verdict is cached | Press **Check services**, or `POST /api/system/check`. |
| Frontend cannot reach the backend | CORS or `VITE_API_URL` | `AC_CORS_ORIGINS` must list the exact frontend origin; `*` is rejected. |
