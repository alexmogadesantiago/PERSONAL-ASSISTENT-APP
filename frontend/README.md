# Automation Center — frontend

React + TypeScript + Vite + Tailwind CSS + React Router + TanStack Query.
One build runs everywhere; only the environment variables change.

- **Production**: hosted on **Vercel** (frontend only). Talks to the FastAPI
  backend over HTTPS + WSS.
- **Local**: `npm run dev` (or `docker compose up frontend`) against
  `http://localhost:8080`.

Vercel never runs Docker / Postgres / n8n / Playwright — those stay on the
backend host.

## Architecture

```
src/
├── api/          typed API client (one fetch wrapper, 401 → refresh → retry)
├── ai/           the assistant: prompt, live context, action protocol, chat state
├── features/     domain logic (automations/catalog.ts maps blueprints → n8n)
├── websocket/    reconnecting WebSocket (exponential backoff)
├── hooks/        TanStack Query hooks + useMonitorWebSocket / useLogsWebSocket
├── stores/       auth, theme, toast (React context)
├── components/   ui/ primitives, chat/, and shared cards
├── layouts/      AppLayout (sidebar + topbar), nav config
├── pages/        one file per route
├── router.tsx    routes + auth guards (RequireAuth / RequireAdmin / PublicOnly)
└── config.ts     reads VITE_* env vars
```

## The AI Assistant

`/assistant` is a real conversation with whichever provider the platform is
configured to use. It calls the backend endpoint the automations already use —
`POST /api/ai/generate` — with the signed-in user's bearer token, so no key
ever reaches the browser and changing provider in the panel changes the chat
too.

Each request carries a freshly built snapshot of this installation (services,
automations, recent executions, AI health, profile completeness) assembled by
`ai/useSystemSnapshot.ts` from endpoints the user can already read. The model
is instructed to answer from that snapshot only.

Two limits are deliberate and visible in the UI rather than faked:

- **No streaming.** The backend answers in one shot, so the chat shows a
  thinking state and a Stop button that aborts the actual request.
- **No conversation API.** History lives in this browser's `localStorage`
  (`ai/conversations.ts`) and is labelled as such. It holds the transcript
  only — never a token, a key, or the system context.

Operations the assistant proposes (`[[action:...]]`) are mapped in
`ai/actions.ts` onto endpoints that already exist — run / activate /
deactivate a workflow, re-probe services, test the AI connection — and are
always confirmed by the user before anything runs. A directive outside that
set renders as "not available in this panel"; no endpoint is ever invented.

## Environment variables

Copy `.env.example` → `.env.local` for local dev.

| Variable | Required | Example |
|---|---|---|
| `VITE_API_URL` | yes (prod) | `https://api.automation-center.example` |
| `VITE_WS_URL` | no (derived from `VITE_API_URL`) | `wss://api.automation-center.example` |
| `VITE_APP_ENV` | no | `production` |

`http`→`ws` and `https`→`wss` derivation happens automatically when
`VITE_WS_URL` is unset. `localhost` / `127.0.0.1` are only ever defaults for
local dev — production must set real URLs.

Those three are the **only** variables this app needs. AI provider
credentials (NVIDIA NIM, OpenRouter, Gemini) must never appear here or in the
Vercel project: Vite inlines `VITE_*` into the shipped bundle, so a key set
there is published. They live in the backend's `service_configs` table,
written from the *AI* page, and only FastAPI ever
sends them anywhere:

```
Browser → Vercel frontend → FastAPI → AIService → NVIDIA NIM (primary)
                                                → OpenRouter (fallback)
                                                → Gemini (optional)
```

`src/security.test.ts` fails the build if a credential-shaped value, a
credential-shaped `VITE_*` name, or a direct call to a provider host gets
into the source or into `dist/`. It also pins which files may touch browser
storage: the session, the theme, and the assistant transcript — nothing else.

The backend must allow this origin: set `AC_CORS_ORIGINS` to the Vercel URL
(and `AC_CORS_ORIGIN_REGEX` for preview deployments). The API sends
credentials, so `*` is rejected by the backend's own configuration check.

## Commands

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run test
npm run build      # → dist/
npm run preview    # serve dist/ on :3000
```

## Deploying to Vercel

1. Import the repo in Vercel. Set **Root Directory** to `frontend/`.
2. Framework preset: **Vite** (auto-detected). Build: `npm run build`,
   output: `dist` — already pinned in `vercel.json`.
3. Add environment variables (Production + Preview):
   `VITE_API_URL`, `VITE_WS_URL`, `VITE_APP_ENV`.
4. Deploy. `vercel.json` rewrites all non-asset paths to `/index.html` so
   React Router deep links work, and sets security headers + asset caching.

CLI:

```bash
npm i -g vercel
vercel login          # interactive, one-time
cd frontend
vercel --prod
```

### CORS on the backend

Add the Vercel origin to the backend:

```
AC_CORS_ORIGINS=https://automation-center.vercel.app
# optional, previews only (scoped regex — never ".*"):
AC_CORS_ORIGIN_REGEX=https://automation-center-[a-z0-9-]+\.vercel\.app
```

## Backend contract

All calls go to `/api/*`; WebSockets to `/ws/monitor` and `/ws/logs`
(`?token=<access>`). Auth is a JWT access token + revocable refresh token;
a 401 triggers one transparent refresh, then a single retry, then logout.
