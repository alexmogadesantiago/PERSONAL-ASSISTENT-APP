# Automation Center — backend

FastAPI + SQLAlchemy 2 + Alembic + Postgres. Runs as the `backend` service in
`docker-compose.yml` (`pa-backend`, `127.0.0.1:8080`).

## Layout

```
app/
  config.py          settings (env prefix AC_), validate_runtime()
  db.py              engine + session (sync, psycopg 3)
  main.py            FastAPI app factory, CORS, security headers, request id
  core/logging.py    structured JSON logs, secret scrubbing
  models/            SQLAlchemy models (users, profiles, credentials,
                     workflows, executions, system_events)
  schemas/           pydantic response models
  services/
    metrics.py         real host/container metrics (psutil)
    services_probe.py   live TCP/HTTP probes of every stack service
  api/routes/        routers; mounted under /api
migrations/          Alembic (0001_initial creates the whole schema)
tests/               pytest (SQLite in-memory; `-m integration` needs real PG)
```

## Endpoints (phase 3)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | backend liveness + DB check + `validate_runtime()` problems |
| GET | `/api/system/status` | live probe of postgres / n8n / playwright / profile |
| GET | `/api/system/metrics` | real CPU / RAM / disk / load / uptime |
| GET | `/openapi.json`, `/docs` | OpenAPI schema + Swagger UI |

Auth, profiles, credentials, n8n integration and WebSockets land in phases 4–8.

## Dev

```bash
# tests (no services needed). Context is the repo root: the test stage also
# checks the n8n workflow JSONs, which live outside ./backend.
docker build --target test -t pa-backend-test -f backend/Dockerfile .

# run against the stack
docker compose up -d postgres backend
curl -s localhost:8080/api/health | jq

# migrations
docker compose exec backend alembic upgrade head
docker compose exec backend alembic downgrade base
```

## Operator commands

Roles are not editable over HTTP: no endpoint writes `users.role`, and
`/api/auth/register` ignores a `role` field. The platform makes the **first**
registered account an admin, and after that the only way to change a role is a
shell where the database credentials already are:

```bash
# who exists, and what they are
docker compose exec backend python -m app.manage list-users
docker compose exec backend python -m app.manage list-users --admins-only

# give / take the admin role (idempotent, audited as `auth.role.change`)
docker compose exec backend python -m app.manage promote-admin <username-or-email>
docker compose exec backend python -m app.manage demote-admin  <username-or-email>
```

On Render, run the same commands in the service's **Shell** tab without the
`docker compose exec backend` prefix.

The last remaining administrator cannot be demoted - a platform with no admin
can only be repaired from a shell, which is what this exists to avoid.

A role change applies immediately to the session the user already has open:
authorisation reads the database on every request, not the JWT's `role` claim,
so nobody has to log out and back in.

Admin is what gates writing the AI provider selection and its API keys, the
automation service token, and the n8n / Playwright endpoints and keys. Reading
those settings stays open to any signed-in user, so the Settings page renders
for everyone and only saving is refused.

Local venv needs Python 3.11–3.13 (pydantic-core has no 3.14 wheel yet); the
container uses 3.12.
