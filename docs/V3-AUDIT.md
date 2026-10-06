# Personal Assistant v3.0 — audit of v2.0

Date: 2026-10-06. Baseline before any v3 change: backend 525 passed, frontend 142
passed, installer 108 passed (last run v0.6), lint/tsc clean.

## What is actually running on this machine

| Item | Finding |
|---|---|
| Installed stack (`pa-*` containers) | backend **0.4.0** (pre-v0.5), Postgres DB `automation_center`, Alembic `0004` |
| Users | 3 |
| Hub connections (OAuth / bot) | none — the only credential row is a legacy Telegram `api_key` |
| AI | OpenRouter and NVIDIA NIM configured and last test OK; no Gemini key |
| n8n | configured, last test OK |
| Telegram (4 assistants) | `TELEGRAM_CHAT_ID` + 4 bot tokens set in the n8n container environment |
| Google | not connected → **real Gmail cannot be tested until the user connects it** |

The v2.0 code has never been deployed to the running stack; updating it is a
production change and is left to the user (installer / launcher update).

## Matrix

P = priority (P0 critical … P3 polish). "Test" = how v3 proves it.

| Feature | Current state (v2.0) | Problems | Opportunity | P | Implementation | Test |
|---|---|---|---|---|---|---|
| Credentials / Hub | Hub with OAuth+PKCE, health, per-service permissions, test, disconnect | Test is one opaque call; disconnect doesn't say what breaks; no stepwise health | Connection overview, stepwise test, dependency-aware disconnect, health checklist | P0 | `hub.dependencies`, `health.test_steps`, UI on detail page | backend + page tests |
| Integrations Hub | Provider cards + Gemini/n8n platform cards | Cards lack "used by", last sync, messages today, n8n success rate | Control-center cards | P0 | extend `overview`/usage counters, n8n stats | page tests |
| AI Assistant (chat) | Local-history chat over the system snapshot, action proposals with confirmation | Knows automations but not the user's day (mail, calendar, tasks); answers are text only | Personal context + structured cards + action buttons | P0 | `POST /api/assistant/ask` (intent + sections + actions), chat renders them | backend + chat tests |
| Gmail | Inbox, AI triage, reply, reminder | Priority is the model's guess only (no explanation); no archive / mark important / tasks / tones; no filter by AI result | Priority engine with reasons, more actions, tones, email→task | P0 | `priority.py`, `gmail_manage` service (gmail.modify, opt-in), tasks | unit + API tests |
| Telegram | Conversational bot, 6 commands, linked chat only | No /tasks /automations; no confirmation for sensitive actions; no grouped notifications | Inline-keyboard confirmation, /reply flow, scheduled briefing | P0 | `bot_reply` + callback_query handling | bot tests |
| 4 legacy assistants | n8n workflows read 4 bot tokens + chat id from env written by the launcher | Two credential systems: Hub (encrypted, per-user) vs launcher env (plaintext `.env` in AppData) | Route their messages through the Hub when connected, keep env path as fallback | P0 | `/api/automations/notify` + workflow node change, documented | backend test + workflow JSON test |
| n8n | Hub card, executions, errors | No single "n8n control center" view | Workflows / active / executions today / success / last run | P0 | `/api/observability/n8n` + page section | tests |
| Dashboard | ServiceStrip, stats, briefing, quick actions | Not a command center: no greeting, no command bar, no insights | Command center (greeting, AI bar, today, automations, services, insights) | P0 | rebuild `DashboardPage` | page tests |
| Automation builder | Blocks, NL draft, templates, test run | Templates miss the TDR set (daily briefing, deadline detector…) | Add templates | P0 | `drafting.TEMPLATES` | test |
| Daily briefing | Card + /briefing | No sections, deadlines, automations health; manual only | Briefing 2.0 + automatic delivery at preferred time | P1 | `briefing()` v2, scheduler in bot loop | tests |
| Executions | Step list + Retry | No timestamps per step; retry is blind | Timeline with times; smart retry advice | P1 | `retry_advice` on run detail | tests |
| Error center | Diagnosed groups with action | No impact, no cause/recommended split | Problem / cause / impact / recommended | P1 | `impact` per group | tests |
| Suggestions | Frequent senders | No weekly pattern, no PDFs, no "never suggest" | Pattern-based suggestions + dismiss | P1 | `suggestions()` v2 + memory | tests |
| Notifications | Bell with events | No assistant insights | Proactive insights feed | P1 | `/api/assistant/insights` | tests |
| AI memory | — | Missing | Preferences, important senders, notes; view/edit/delete | P2 | table `assistant_memory` | tests |
| Tasks | — | Missing | Email→task, deadlines | P2 | table `assistant_tasks` | tests |
| Search | Ctrl+K pages/actions/automations | No emails/errors/tasks | Search 2.0 | P2 | palette sources | test |
| Shortcuts | Ctrl+K | No G-chords, no help | Ctrl+/, G H/I/A/T | P2 | `useShortcuts` | test |
| Demo mode | — | Missing | Coherent sample data, clearly labelled | P2 | `demo.py` behind a per-user preference | tests |
| Privacy / Security | Security posture inside integration detail | No overall view | Privacy + Security centers | P3 | `/api/assistant/privacy` + settings sections | tests |
| System health | Services page (admin) | Not user-facing | System health card | P3 | settings section | test |
| Design system | Tokens in `index.css` + Tailwind | z-index/motion not tokenised | Add motion/z tokens | P3 | CSS vars | build |
| Accessibility | Focus rings, aria on controls | reduced-motion not honoured everywhere | `prefers-reduced-motion` | P3 | CSS | visual |

## Decisions

* No new external dependency (no markdown lib, no e2e framework download): the
  chat already has its own Markdown renderer; E2E flows are covered by
  API-level flow tests (FastAPI TestClient, every external HTTP call mocked)
  plus browser verification against the panel.
* One migration (`0005`) for two genuinely new kinds of data: assistant memory
  and tasks. Nothing else in the schema changes.
* Archive / mark important need `gmail.modify`. It is a **separate opt-in
  service** ("Organize Gmail") so existing connections keep their least-privilege
  grant and nothing they had stops working.
* Sensitive actions (send email, archive, disconnect, change credentials)
  always require an explicit confirmation — in the web and in Telegram.

## Los 4 asistentes de serie y Telegram

Investigación pedida expresamente. **Resultado: deuda técnica documentada, no
migrada.** Nada se ha borrado ni cambiado en los workflows (copia de seguridad
previa en `backups/workflows-v2.0/`).

**1. Qué son.** Los workflows de n8n `01-email` (Asistente - Email), `02-laboral`,
`03-news` y `04-marca-personal`, más el sistema `00-error-handler`. Cada uno
envía su resultado a Telegram con un **bot propio** (comprobado con la API real:
`@email_TDR_bot`, `@noticias_TDR_bot`, `@laboral_TDR_bot`, `@marca_TFR_bot`).

**2. Por qué usan el launcher.** Sus nodos HTTP leen `$env.TELEGRAM_TOKEN_*` y
`$env.TELEGRAM_CHAT_ID`. El launcher de Windows pide esos valores en su ventana
de Ajustes, los guarda en el `.env` de `%LOCALAPPDATA%` y `docker compose` los
pasa al contenedor de n8n. Fue la forma de que un workflow *versionado en Git*
funcione en cualquier instalación sin credenciales de n8n (que son por
instancia) y sin secretos en el JSON (un test lo garantiza).

**3. ¿Dos sistemas de credenciales?** Sí. (a) El **Integrations Hub**: un bot, un
chat vinculado con *Start*, cifrado en PostgreSQL, validado y con salud.
(b) El **launcher**: cuatro bots, el chat id a mano, texto claro en un `.env`.
No comparten nada.

**4. ¿Contradice el Hub?** En parte. Dos fuentes de verdad para lo mismo y un
mensaje distinto según quién envíe (cuatro identidades de bot frente a una). El
Hub y el bot conversacional funcionan bien sin ellos; los asistentes de serie
funcionan bien sin el Hub. La contradicción es de experiencia, no de
funcionamiento.

**5. ¿Riesgo de seguridad?** Moderado y acotado. Los tokens están en texto claro en
el `.env` local y en el entorno del contenedor de n8n (visibles con `docker
inspect` para quien ya administra Docker en ese PC). **No** están en Git, ni en
los workflows, ni en el frontend, ni en logs; el launcher los enmascara al
escribirlos. En un PC de un solo usuario es asumible; no lo es en uno compartido.

**6. ¿Se puede migrar?** Sí, y la pieza está hecha y probada: el relé
`POST /api/automations/notify` (token de servicio) envía por el Telegram del Hub.
**No se aplicó a los workflows** por tres razones concretas:

- No puedo validar una edición de workflow contra el n8n **de esta instalación**:
  corre un backend 0.4.0 que no tiene el relé, y actualizarla es modificar tu
  entorno real, que no debo hacer sin que lo decidas.
- Cambia la **identidad** del remitente (de 4 bots a 1). Es una decisión de
  producto tuya, no técnica.
- Los tests de workflows fijan hoy el contrato `$env` (configuración validada al
  inicio); romperlo sin poder ejecutarlo en vivo es arriesgar justo lo que
  funciona.

**Plan recomendado (dos fases, reversibles):**
1. En cada workflow, antes del nodo de Telegram, un `IF`: *si hay token de
   launcher → envío directo (como hoy); si no → `POST /api/automations/notify`*.
   Actualizar el comprobador de configuración para que `TELEGRAM_*` sea opcional
   cuando el Hub tiene Telegram conectado. Probar en una copia de n8n.
2. Cuando eso esté probado en real, ocultar los campos `TELEGRAM_TOKEN_*` del
   launcher y dejar de pasarlos al contenedor.

---

## PERSONAL ASSISTANT v3.0 - informe final

```
Implemented:
  Command Center (greeting, AI command bar, Today, automations, services,
    insights, briefing 2.0)          Priority engine with reasons ("Why high?")
  Assistant chat with interactive cards and buttons
  Inbox 2.0: filters, batch analysis, action→task, deadline→calendar, 4 reply
    tones, confirm-before-send, archive / mark important, automate sender
  Tasks · AI memory (view/edit/delete, refuses secrets)
  Telegram 2.0: /tasks /automations /reply, [Send][Edit][Cancel], natural
    language, automatic daily briefing
  Credentials 2.0: overview, health, animated test, permissions, dependencies
    shown before disconnecting     n8n control center     Error Center 2.0
  Executions timeline + smart retry     Automation health     Suggestions 2.0
  Privacy · Security center · System health · Demo mode · Presentation view
  Ctrl+K search (emails, tasks, executions…) · Ctrl+/ · G-chords
  real-check.py (real-service validation, discreet)

Improved:
  Design tokens (motion, z-index; contrast fixed to WCAG AA in both themes)
  Onboarding = the requested first-run order     Notification bell includes insights
  Hub cards (used by, messages today, AI errors, n8n success)
  Hardened pages against partial API responses

Tests:
  Backend:   574 passed, 3 skipped (525 at the start; +49)
  Frontend:  174 passed (142; +32); tsc and eslint clean; build OK
  Installer: 108 passed
  E2E:       3 mock end-to-end suites covering the 10 flows (+ no-secret-leak,
             + demo mode). Visual: 20 routes x 6 widths, no overflow.
  Level:     mock tests everywhere; PostgreSQL integration for migration 0005
             and the memory/tasks services; see docs/TESTING.md

Real integrations:
  Gmail:    NOT TESTED (no Google account connected on this machine)
  Gemini:   NOT TESTED (no Gemini key; OpenRouter/NIM configured, not used)
  Telegram: getMe verified for the 4 existing bots (real, read-only).
            Sending / answering commands NOT tested for real.
  n8n:      /healthz verified (real). Compiling and running a v3 automation
            against the real n8n NOT tested (installed backend is 0.4.0).
  Full chain Gmail -> AI -> n8n -> Telegram: NOT validated for real.

Security:
  OAuth+PKCE, Fernet vault, no secret in any response or log (tested), human
  confirmation for send / archive / disconnect, the assistant cannot delete
  mail, demo mode touches nothing. Known: legacy launcher tokens in plain text.

Performance:
  Main bundle 123 kB gzip; every page lazy-loaded (new pages 2-16 kB gzip).
  No new polling: new queries use staleTime and load on demand; Gmail is
  queried only when a view is opened; email search in Ctrl+K waits 400 ms and
  3 characters. The lite briefing skips the AI call. Existing 30 s polling kept.

Known limitations:
  Chat is not streamed (backend answers at once).
  "Telegram smart notifications" = the grouped daily briefing; there is no
  separate real-time alert digest.
  Calendar reminders go through the builder's test-run path (works, but it is
  not a dedicated endpoint).
  The installed copy on this PC (v0.4.0) was not updated by me.

Remaining technical debt:
  4 built-in assistants use launcher Telegram tokens (plan above).
  Gmail archive needs the optional gmail.modify permission (re-consent).
  No multi-provider AI selection per feature (the architecture allows it).
```
