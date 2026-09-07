# Architecture

Automation Center is one product made of four cooperating parts: a **web
control plane** (React panel + FastAPI backend), the **services that do the
work** (n8n, a Playwright scraper, an AI provider), **Postgres** as the single
store of state, and an **installer** that bootstraps all of it on a machine.

```
                        ┌──────────────────────────┐
                        │  Frontend (Vercel / SPA) │
                        │  React 18 + Vite + TS    │
                        └───────────┬──────────────┘
                    HTTPS + WSS     │
                        ┌───────────▼──────────────┐
                        │  Backend (Render/Docker) │
                        │  FastAPI + SQLAlchemy    │
                        └───────────┬──────────────┘
                                    │
        ┌───────────────┬───────────┴──────────┬──────────────┐
        ▼               ▼                      ▼              ▼
  ┌───────────┐   ┌───────────┐         ┌────────────┐  ┌──────────────┐
  │ Postgres  │   │    n8n    │         │ Playwright │  │  AI Service  │
  │ state +   │   │ workflows │         │  scraper   │  │  (in-process)│
  │ config    │   │           │         │  (private) │  └──────┬───────┘
  └───────────┘   └─────┬─────┘         └────────────┘         │
                        │                            ┌─────────┼─────────┐
        ┌───────────────┼────────────────┐            ▼         ▼         ▼
        ▼               ▼                ▼        NVIDIA   OpenRouter  Gemini
      Gmail         Calendar     Tasks / Telegram   NIM     (fallback) (optional)
                                                  (primary)
```

The backend does not proxy workflow traffic in general: n8n calls Gmail, the
scraper and Telegram directly. AI is the deliberate exception. The workflows
POST to `/api/ai/generate` and the backend chooses the provider, so swapping
NVIDIA NIM for OpenRouter is a panel setting, not a workflow edit — and no
provider key is ever handed to n8n.

---

## Components

| Component | Where | Responsibility |
|---|---|---|
| `frontend/` | Vercel (or a local container) | The panel. Holds no secret: everything comes from the API. |
| `backend/` | Render (or a local container) | Auth, profiles, credentials, service configuration, health monitoring, the n8n client. |
| `workflows/` | imported into n8n | The four automations: Agenda/Email, Laboral, Noticias, Marca Personal. |
| `playwright/` | private container | Job-offer scraping. Never exposed publicly — it fetches arbitrary URLs. |
| `profile/` | local container only | Legacy helper that maintains `config/user_profile.json` for the n8n Code nodes. **Not** what the monitor calls PROFILE. |
| `installer/` | user's machine | Platform detection, dependency bootstrap, service start, health checks. |

---

## Configuration: one source, two layers

Every integration resolves its endpoint and secret through
`backend/app/services/service_config.py`, in this order:

1. **the `service_configs` table** — written from the panel (Settings →
   Services). Secrets are encrypted with Fernet using
   `AC_CREDENTIAL_ENCRYPTION_KEY`, which lives outside the database.
2. **the environment** (`AC_*`, plus the legacy `N8N_*` / `GEMINI_*` /
   `NVIDIA_NIM_*` / `OPENROUTER_*` names) —
   what the installer or the hosting provider injected.
3. **nothing** → the service reports `not_configured`.

This ordering is what makes the product usable without a terminal: pasting an
n8n URL and API key into the panel takes effect on the next health check
(≤ 5 s), with no restart and no redeploy. A deployment that only ever sets
environment variables behaves exactly as it did before the table existed,
because an empty table changes nothing.

Secrets leave the backend only as a `secret_hint` (`...a3f9`). No endpoint, log
line, audit entry or OpenAPI schema carries the value.

```
Panel (admin)  ──PUT /api/services/config/n8n──►  service_configs (encrypted)
                                                         │
Environment  ─────────────── fallback ───────────────────┤
                                                         ▼
                                        resolve()  ──►  probes + n8n client
```

---

## Health model

`backend/app/services/services_probe.py` runs one probe per service, and the
metrics hub (`services/monitor.py`) broadcasts the results over
`WS /ws/monitor`. A single loop feeds every connected client.

| State | Meaning |
|---|---|
| `online` | reachable and answering (HTTP/TCP services) |
| `configured` | set up and verified, but not something you can ping — profile data in Postgres, an accepted API key |
| `degraded` | reachable but only partly usable — n8n answers `/healthz` yet rejects the API key |
| `invalid` | configured with credentials the provider refuses |
| `offline` | configured, but not responding |
| `not_configured` | nothing configured here. **Not an error**, and deliberately distinct from `offline` |
| `unknown` | the probe itself could not run |

Two rules this encodes:

* **Unconfigured is not broken.** A backend-only deployment with no n8n must
  not look like an outage, so `not_configured` never drags the platform into
  `degraded`.
* **Half-working is not healthy.** n8n that answers its health endpoint but
  rejects the API key is `degraded`. The automations would fail, so a green
  light there would be a lie.

Per service:

| Service | Kind | How it is judged |
|---|---|---|
| postgres | `db` | `SELECT 1` through the application's own engine |
| n8n | `http` | `GET /healthz`, then `GET /api/v1/workflows?limit=1` with the API key |
| playwright | `http` | `GET /health` on the resolved endpoint |
| profile | `data` | the `profiles` table contains a profile carrying the minimum fields |
| ai | `provider` | the *configured* provider is called for real (a cheap authenticated model listing, which costs no tokens); verdict cached for `AC_AI_VERIFY_TTL_SECONDS`. A dead primary with a live fallback reports `degraded`, not `offline` — the automations still run. |

### Why PROFILE is a database check

The `profile` container is a small Node helper that edits a JSON file for the
n8n Code nodes. Probing it answered "is that helper up?", which is not the
question the dashboard asks. The product's profile lives in Postgres, so
PROFILE is now computed from `services/profiles.any_complete_profile()`, which
requires real values in the minimum fields (`profesion`, `ubicacion`,
`intereses`, `preferencias`, under any of their accepted key names). A row
existing, an empty `configuration`, or an untouched multi-select (`[]`) does
**not** count — marking those green would send the automations out with nothing
to filter on. The endpoint reports aggregate counts only and never returns
anyone's profile content.

---

## Data model

`backend/app/models/`

| Table | Purpose |
|---|---|
| `users` | accounts; the first registered user becomes admin |
| `refresh_tokens` | rotating refresh tokens |
| `profiles` | per-user personalisation, open JSON `configuration` |
| `credentials` | per-user third-party secrets, Fernet-encrypted |
| `service_configs` | per-integration endpoint + secret, control-plane owned |
| `workflows`, `executions` | n8n mirror |
| `system_events` | append-only audit trail |

Migrations are Alembic, in `backend/migrations/versions/`. The entrypoint runs
`alembic upgrade head` on boot when `AC_RUN_MIGRATIONS=1`.

---

## Security boundaries

* Secrets are encrypted at rest with a key held outside the database. Losing
  `AC_CREDENTIAL_ENCRYPTION_KEY` makes stored secrets unreadable — by design.
* Writing service configuration and running connection tests are **admin-only**
  and audited, because both make the backend originate outbound requests to an
  operator-chosen address. Treat admin on this panel as equivalent to
  "can make the server fetch a URL".
* The Playwright sidecar is deployed as a **private service**: a headless
  browser that fetches arbitrary URLs is never published.
* CORS is an explicit origin list plus an optional scoped regex. `*` is
  rejected because the API sends `Allow-Credentials: true`.
* WebSocket auth is enforced for the lifetime of the socket, not just at
  connect: the connection closes when the access token expires and the user's
  status is re-checked periodically.
* The JSON log formatter scrubs common secret key patterns as a backstop;
  callers are still expected not to log secrets.

---

## Request lifecycle

1. Middleware assigns a correlation id (`x-request-id`, echoed on the response)
   and adds `nosniff` / `DENY` / `no-referrer` headers.
2. `get_current_user` validates the bearer token and the user's status.
3. Routers delegate to `services/`; routers never talk to n8n or the database
   directly.
4. Domain errors carry their own HTTP status; anything unhandled becomes a
   clean 500 with the correlation id, and the trace stays in the logs.

---

## Related documents

* [INSTALLATION.md](INSTALLATION.md) — installing and first run
* [DEVELOPMENT.md](DEVELOPMENT.md) — working on the code
* [docs/CLOUD-DEPLOYMENT.md](docs/CLOUD-DEPLOYMENT.md) — Vercel + Render
* [CREDENCIALES.md](CREDENCIALES.md) — which credentials each automation needs


---

## AI provider abstraction

```
Automation (n8n)
      │  POST /api/ai/generate  (X-AC-Service-Token)
      ▼
   AIService          resolve config → pick provider → apply fallback policy
      │
      ├── NvidiaNimProvider   (primary, OpenAI-compatible)
      ├── OpenRouterProvider  (fallback, OpenAI-compatible)
      └── GeminiProvider      (optional, generateContent)
      │
      ▼
  AIResponse { text, data, provider, model, usage }
```

Every provider implements one interface (`app/services/ai/base.AIProvider`), so
nothing above it knows or cares which one answered. Structured output is part of
the contract: a caller sends plain JSON Schema and each provider translates it
into its own dialect — Gemini's upper-case `responseSchema`, OpenRouter's native
`json_schema`, NIM's `json_object` plus `nvext.guided_json` — and the reply is
parsed and checked against the schema's required fields before it is returned.

### Where the configuration lives

| What | Where | Notes |
|---|---|---|
| provider, model, fallback, limits | `service_configs` row `ai`, in `meta` | written by the panel |
| each provider's key + endpoint | `service_configs` rows `nvidia_nim` / `openrouter` / `gemini` | Fernet-encrypted, same master key as `credentials` |
| automation token | `service_configs` row `ai`, in `encrypted_secret` | shown once on generation |
| environment fallback | `AC_AI_*`, `AC_NVIDIA_NIM_*`, `AC_OPENROUTER_*`, `AC_GEMINI_*` | used when the table is empty |

No migration was needed: the existing `service_configs` table already carried a
`meta` JSON column and an encrypted secret column.

With nothing selected, the provider is inferred: the first one holding a
credential, in the order NVIDIA NIM → OpenRouter → Gemini. That is what keeps an
existing `GEMINI_API_KEY`-only installation running unchanged.

### Fallback policy

The fallback is attempted only for failures another provider could survive:
timeout, HTTP 429, HTTP 5xx, connection refused. HTTP 400 (bad request) and
401/403 (rejected credential) are raised immediately — replaying them elsewhere
would spend a second quota to reach the same conclusion and would hide the real
fault from the operator.

### Notes verified against the live providers

* **NIM's `GET /models` is a catalogue, not an entitlement list.** The hosted
  endpoint listed 81 models for a real key while several of them answered HTTP
  404 on `/chat/completions`. The default model is therefore one confirmed to
  serve, and `GET /api/ai/models` labels the list with that caveat instead of
  implying every entry is callable.
* **`nvext.guided_json` is opt-in.** Sending it unconditionally was verified to
  fail with HTTP 400 `unknown field guided_json` on engines that do not
  implement it - turning a working model into a hard error. The default path
  asks for `response_format: json_object` and describes the schema in the
  prompt, which every JSON-capable model accepts.
* **The connection test needs a real token budget.** A reasoning model spends
  output tokens before it writes anything, so a tight `max_tokens` returns an
  empty completion and a healthy provider would be reported as broken.
