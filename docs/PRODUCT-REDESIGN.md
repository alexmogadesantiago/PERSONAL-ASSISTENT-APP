# Personal Assistant — product redesign (v0.6)

Decision log for the move from "a panel that wraps n8n" to "my personal AI and
automation centre". Written before any code changed. Each phase is updated
with what was actually built.

## Phase 1 — Audit (2026-10-05)

### Baseline

| Suite | Result |
|---|---|
| backend `pytest` | 478 passed, 3 deselected |
| frontend `vitest` | 140 passed (15 files) |
| installer `Test-Installer.ps1` | 108 pass, 0 fail |
| frontend lint / typecheck / build | clean |

### Architecture as found

```
Browser (React 18 + Vite + Tailwind + React Query, no UI library)
   │  JWT bearer (access + refresh, localStorage)
FastAPI backend (SQLAlchemy 2, Alembic, Postgres)
   ├── auth (users, roles, refresh tokens, rate limit)
   ├── credentials   (Fernet-encrypted secrets, real connection tests, audit)
   ├── service_configs (panel-owned config: n8n, AI providers; DB > env)
   ├── ai            (AIService: NVIDIA NIM / OpenRouter / Gemini + fallback,
   │                  service token for n8n, /api/ai/generate)
   ├── profiles      (catalogue-driven personal profile, /runtime for n8n)
   ├── n8n proxy     (workflows, executions, activate/run)
   ├── pipelines     (reads results back out of n8n execution data)
   ├── system        (health, service monitor, metrics, logs ring, WS)
   └── automations/events (n8n Error workflow → activity trail)
n8n 1.121 (Postgres) — 4 assistants + error handler, all HTTP to the backend
Playwright scraper · profile sidecar · Docker Compose · Inno Setup installer
```

### What is solid and must not break

* Credential encryption (`core/crypto`, Fernet, key outside the DB), the
  "secret never returned" contract and its tests.
* `service_configs` resolution (DB first, env second) — the right home for
  admin-owned OAuth app credentials.
* The AI layer (provider abstraction, fallback, structured output, service
  token). Every AI feature in the redesign goes through it.
* `/api/profiles/runtime`, `/api/ai/generate`, `/api/automations/events` —
  contracts the n8n workflows depend on.
* Auth, refresh-token rotation, rate limiting, SSRF guard.
* The installer and the workflow JSON test suite.

### Gaps found

| Area | Gap |
|---|---|
| Integrations | No OAuth anywhere in the backend. Google OAuth lives only inside n8n; Telegram is six env vars edited from the launcher. "Credentials" is a generic key vault, not a connection hub. |
| Automations | Read-only views of four hard-coded n8n workflows. No create / duplicate / delete, no builder, n8n concepts (execution ids, nodes) leak into the UI. |
| Observability | Executions table and a logs ring; no per-step execution view, no grouped error centre, no notifications. |
| AI | Chat page exists and is good, but AI is not woven into dashboard, errors or automation creation. |
| Shell | Sidebar + header are clean but generic; no command palette, no global search, no mobile navigation beyond a drawer, no notification centre. |
| Design system | Tokens exist (graphite + olive), ~10 primitives. Missing: drawer/sheet, tabs, tooltip, dropdown, avatar, data list, timeline, step indicator, command palette. |

### Integration choice

Kept the four pillars proposed in the brief — they are the right ones for this
product and all four fit the existing architecture:

| Pillar | Why | Auth | Fit |
|---|---|---|---|
| **Google Workspace** (Gmail, Drive, Calendar, Sheets) | Already the backbone of the Email assistant; largest surface for personal automation | OAuth 2.0 authorization code + PKCE, offline access (refresh token) | backend holds tokens; n8n reaches APIs through the backend |
| **Telegram** | Already every assistant's output channel | Bot token + chat linking by deep link (`/start <code>`), no manual chat id | replaces six env vars with one connection |
| **Microsoft 365** (Outlook, Calendar, OneDrive, Teams) | Same shape as Google for users on Microsoft; mature Graph API | OAuth 2.0 auth code + PKCE (Entra ID, `common` tenant) | same token store and broker |
| **GitHub** (issues, PRs, notifications, releases) | Productivity/workflow signals, excellent API, OAuth apps | OAuth app (auth code) | same token store |

Rejected: Slack/Notion (good, but would duplicate the "channel" and "docs"
roles already covered by Telegram and Google Docs), Dropbox (Drive/OneDrive
cover it).

### Key design decisions

1. **Connections reuse the `credentials` table.** A connection is a credential
   with `type=oauth2` (or `bearer` for Telegram) and the provider's metadata in
   `meta` (account, granted scopes, services, health). No parallel secret
   store, no new encryption path, existing audit trail.
2. **OAuth app credentials are admin configuration**, stored in
   `service_configs` (`google_oauth`, `microsoft_oauth`, `github_oauth`): the
   client secret encrypted, the client id in `meta`. Normal users only ever see
   "Sign in with Google"; the "Advanced" path is the admin form.
3. **The backend is the token broker.** n8n never holds third-party OAuth
   credentials for panel-built automations: it calls backend *actions* with the
   installation service token, and the backend uses (and refreshes) the stored
   tokens. This is what lets Personal Assistant be a product layer over n8n.
4. **Automations are blocks, compiled to n8n.** The builder edits a small
   typed spec (trigger → conditions → AI → actions); the backend compiles it to
   an n8n workflow whose every node is an HTTP call to a backend action, creates
   it through the n8n API and tags it as panel-managed. The four existing
   assistants stay as they are and appear as "system automations".
5. **Health is honest.** Every state shown (healthy, degraded, expired,
   authentication required, error) comes from a real probe or a real token
   state; anything not observable says so.
6. **No new UI dependency.** The existing stack (Tailwind + hand-built
   primitives) is extended into a proper design system rather than replaced,
   keeping the bundle small.

### Risks

* OAuth needs an OAuth app registered at each provider by the admin — cannot
  be automated. The hub detects and explains this (Advanced setup).
* Google's unverified-app screen in "Testing" mode allows 100 test users and
  shows a warning; acceptable for a personal install.
* n8n workflow creation requires the n8n API key configured in Services.

## Phases 2-10 - what was built (2026-10-06)

| Phase | Delivered |
|---|---|
| Backend: integrations | `services/integrations/*`: provider registry (Google, Telegram, Microsoft, GitHub), OAuth 2.0 + PKCE with sealed single-use state, token refresh, revoke, per-service health checks, Telegram deep-link chat linking. Routes `/api/integrations/*`. 16 tests. |
| Backend: automations | `services/automations/*`: block catalogue (25 blocks), validated spec, real actions over the token broker, n8n compiler (HTTP-only nodes, no user text in n8n), test runs, run history per step, AI drafting, 8 templates. Reuses the `workflows` table - no migration. 18 tests. |
| Backend: observability | `/api/overview`, `/api/activity`, `/api/errors` (diagnosed + grouped + resolvable), `/api/notifications` (server read state), `/api/executions/{id}`; daily usage counters; `/api/auth/password`, `/api/auth/sessions`. 9 tests. |
| Design system | New tokens (graphite + iris + AI teal, light/dark), elevation, motion; Button/Badge/Stat/Avatar, Drawer (bottom sheet on phones), Menu, Tooltip, Tabs, Segmented, Switch, HealthBadge, Timeline, Steps, CopyField; Modal as bottom sheet. |
| Shell | New sidebar, header (search, system pulse, Ask AI, notifications, account), phone tab bar + More sheet, Ctrl+K command palette, notification centre, page-level code splitting (main bundle 136 → 117 kB gzip). |
| Pages | Home, Integrations Hub + detail + connect flows (OAuth, Advanced OAuth app, Telegram), Automations list, Builder (AI draft / templates / blocks / test run), automation detail (custom + system), run detail, Activity Center, Error Center, Settings (9 sections), Onboarding. AI assistant aware of integrations and errors, opens with `?q=`. |
| QA | backend 521 passed; frontend 140 passed, lint and typecheck clean; every page checked at desktop and 375 px with no horizontal overflow. |

### Known limits (honest)

* Real OAuth needs each provider's OAuth app registered once (Advanced setup); cannot be automated.
* The four system assistants still read Telegram tokens from the launcher; panel-built automations use the Telegram connection.
* `transform.combine` in a test run uses the first 5 items per step to avoid mass side effects.

## v2.0 - the assistant (2026-10-06)

| Area | Delivered |
|---|---|
| Inbox | `/inbox`: Gmail search and views, AI triage (priority, category, action, summary, deadline), deadline -> calendar reminder, AI reply draft, reply sent in the same thread (`In-Reply-To`). API `/api/assistant/mail/*`. |
| Daily briefing | Unread mail + today's events + open problems, summarised by AI (Home card, `/briefing` on Telegram). |
| Telegram bot | The linked chat can talk to the assistant: `/emails`, `/briefing`, `/errors`, `/status` or any question. Background poll in the backend (4 s); other chats are ignored; updates are acknowledged once. |
| Suggestions | Frequent senders not yet automated -> one-click "Automate it" (AI builder pre-filled). |
| Hub | Gemini/AI provider and n8n engine shown as platform cards (model, requests today, average response time). |
| Home | Service strip (Gmail · AI · Telegram · n8n), AI requests stat, quick actions incl. activity and errors. |
| Runs | Retry on failed runs; activity filters by service. Onboarding includes the n8n step. |
| Tests | backend 525, frontend 142. |

## v3.0 - the personal operating system (2026-10-06)

Audit and decisions: [V3-AUDIT.md](V3-AUDIT.md). How to demo it: [DEMO.md](DEMO.md).

| Area | Delivered |
|---|---|
| Home = Command Center | Time-aware greeting, **AI command bar** with the five suggestions, *Today* (important emails, events, deadlines, critical errors), automations health, services strip, **AI insights** (a few, each with one action, hideable), daily briefing 2.0. |
| Assistant chat | Answers a personal question with **interactive cards** (Email / Calendar / Deadlines / Problems) and buttons (*Show emails*, *Create briefing*), not only text. Model gets a compact personal context. Sensitive actions are never executed by the model. |
| Priority engine | LOW / NORMAL / HIGH / URGENT from a transparent score (sender, deadline, urgency words, action, history, automated sender) - shown as **"Why high priority?"** with the reasons. |
| Inbox 2.0 | Filters by what the AI found (needs action, deadline, important sender, category), batch analysis, per-row badges. Detail: analysis, reasons, **action detected → task**, **deadline → calendar**, reply in 4 tones, **confirm before send**, archive / mark important (optional permission), **automate this sender**. |
| Tasks, memory | `/tasks`; **AI memory** (briefing time/auto, channel, summaries, language, important senders, notes) - view, edit, delete; refuses anything that looks like a secret. |
| Telegram 2.0 | `/tasks`, `/automations`, `/reply N` with **[Send] [Edit] [Cancel]** confirmation (15 min, single use), natural language through the same context as the web chat, **briefing sent automatically** at the chosen time. |
| Credentials 2.0 | Connection overview, credential health (authentication / API / permissions / token), animated 4-step test, permissions grouped per service, **disconnect shows what breaks** (automations, scheduled tasks, features). |
| Hub 2.0 | Service cards with used-by, last sync, messages today (Telegram), AI errors/latency, n8n success rate; **n8n control center** (`/engine`). |
| Errors / Executions 2.0 | Error Center: problem → cause → impact → recommended action. Runs: timeline with time per step; **smart retry** explains the failure and whether retrying can help or you must reconnect first. |
| Automations | Health per automation (success, runs, last run, average time); suggestions from patterns (weekly sender, recurring PDFs) with *Create / Not now / Never suggest this*; 5 new templates. |
| Trust | **Privacy** (who has access, what is sent to the AI, what stays local), **Security center** (live checklist with the fix), **System health**. |
| Search & keys | `Ctrl K` finds emails, tasks, executions, errors, integrations, automations and settings; `Ctrl /` lists shortcuts; `G H/I/A/T` navigate. |
| Demo | **Demo mode** (sample day, banner everywhere, nothing sent) and a **presentation view** (`/presentation`). |
| Design system | Tokens for colour (AA contrast fixed in both themes), motion and z-index; `prefers-reduced-motion` respected. |
| Data | One additive migration `0005` (memory, tasks). Verified on real PostgreSQL (up, down, up). |
| QA | backend 574 (525), frontend 174 (142), installer 108, E2E flows 3; visual check 20 routes × 6 widths, no overflow. |

### Known limits (honest)

* Everything above was verified with **simulated** Google, Telegram, AI and n8n; only the checks listed in [TESTING.md](TESTING.md#qué-se-ha-probado-con-servicios-reales) ran against real services. **Gmail and Gemini were not tested for real.**
* The chat is not streamed (the backend answers at once).
* The four built-in assistants still use their launcher Telegram tokens (documented debt).
