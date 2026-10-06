/**
 * What every automation needs before it can run, and where each piece is set.
 *
 * This is the single answer to "which credentials do I need?". It mirrors the
 * workflow JSON under `workflows/` and the environment `docker-compose.yml`
 * hands to n8n: if a workflow starts reading a new `$env.X` or a new n8n
 * credential type, it belongs here too (`requirements.test.ts` keeps the two in
 * step).
 *
 * Status is never invented. A requirement the panel can verify carries a
 * `check`; one that lives only in n8n's own credential store or in n8n's
 * environment (which the backend cannot read) is `manual` and says so.
 */
import type { AutomationKey } from "@/features/automations/catalog";

export type RequirementCheck = "ai" | "service_token" | "n8n" | "profile" | "manual";

export type RequirementKind = "api_key" | "oauth2" | "bot_token" | "token" | "identifier";

/** Where the user actually enters the value. */
export type RequirementLocation = "panel" | "launcher" | "n8n";

export interface CredentialRequirement {
  id: string;
  title: string;
  kind: RequirementKind;
  /** Automations that stop working without it. Empty = the platform itself. */
  usedBy: AutomationKey[];
  optional?: boolean;
  location: RequirementLocation;
  /** In-app route (starts with "/") or external URL for the "Configure" button. */
  configureHref?: string;
  configureLabel?: string;
  /** Variables n8n reads; shown so the user can match them in the launcher. */
  envVars?: string[];
  /** n8n credential types, for requirements stored in n8n. */
  n8nCredentialTypes?: string[];
  /** Where the value comes from (provider console, bot, …). */
  obtainHref?: string;
  obtainLabel?: string;
  steps: string[];
  check: RequirementCheck;
}

export const AUTOMATION_LABELS: Record<AutomationKey, string> = {
  agenda: "Email & Agenda",
  laboral: "Laboral",
  noticias: "Noticias",
  "marca-personal": "Marca Personal",
};

const ALL: AutomationKey[] = ["agenda", "laboral", "noticias", "marca-personal"];

export const CREDENTIAL_REQUIREMENTS: CredentialRequirement[] = [
  {
    id: "ai-provider",
    title: "AI provider API key",
    kind: "api_key",
    usedBy: ALL,
    location: "panel",
    configureHref: "/ai",
    configureLabel: "Open AI settings",
    obtainHref: "https://build.nvidia.com",
    obtainLabel: "Get an NVIDIA NIM key",
    steps: [
      "Pick one provider: NVIDIA NIM (nvapi-…), OpenRouter (sk-or-…) or Gemini (AIza…).",
      "Paste the key in AI → Provider, choose a model and press Test connection.",
      "Optional: enable a fallback provider so a rate limit does not stop the automations.",
    ],
    check: "ai",
  },
  {
    id: "service-token",
    title: "Automation service token",
    kind: "token",
    usedBy: ALL,
    location: "panel",
    configureHref: "/ai",
    configureLabel: "Generate token",
    envVars: ["AC_SERVICE_TOKEN"],
    steps: [
      "AI → Automation token → Generate. It is shown once: copy it.",
      "The workflows send it as X-AC-Service-Token when they call /api/ai/generate and /api/profiles/runtime.",
      "The installer writes it to n8n's environment; after rotating it, restart n8n from the launcher.",
    ],
    check: "service_token",
  },
  {
    id: "profile",
    title: "Active profile",
    kind: "identifier",
    usedBy: ALL,
    location: "launcher",
    configureHref: "/profiles",
    configureLabel: "Open profiles",
    envVars: ["AC_PROFILE_ID"],
    steps: [
      "Create and complete a profile in Profiles (interests, location, language, tone).",
      "Copy its id from the address bar and paste it in the launcher → Ajustes → ID del perfil activo.",
    ],
    check: "profile",
  },
  {
    id: "n8n-api",
    title: "n8n API key",
    kind: "api_key",
    usedBy: [],
    location: "panel",
    configureHref: "/services",
    configureLabel: "Open services",
    steps: [
      "In n8n: Settings → n8n API → Create an API key.",
      "Paste it in Services → n8n. The panel uses it to list, run and activate the workflows.",
    ],
    check: "n8n",
  },
  {
    id: "telegram-chat",
    title: "Telegram chat id",
    kind: "identifier",
    usedBy: ALL,
    location: "launcher",
    envVars: ["TELEGRAM_CHAT_ID"],
    obtainHref: "https://core.telegram.org/bots/api#getupdates",
    obtainLabel: "How getUpdates works",
    steps: [
      "Send any message to each of your bots (press Start).",
      "Open https://api.telegram.org/bot<TOKEN>/getUpdates and copy the number in \"chat\":{\"id\": …}.",
      "Paste it in the launcher → Ajustes → Chat ID de Telegram.",
    ],
    check: "manual",
  },
  {
    id: "telegram-bots",
    title: "Telegram bot tokens",
    kind: "bot_token",
    usedBy: ALL,
    location: "launcher",
    envVars: [
      "TELEGRAM_NOTICIAS_TOKEN",
      "TELEGRAM_TOKEN_MARCA",
      "TELEGRAM_TOKEN_LABORAL",
      "TELEGRAM_TOKEN_EMAIL",
      "TELEGRAM_TOKEN_ALERTAS",
    ],
    obtainHref: "https://t.me/BotFather",
    obtainLabel: "Open @BotFather",
    steps: [
      "Talk to @BotFather → /newbot, once per automation (one bot each keeps the chats tidy).",
      "Paste each token (123456:AA…) in the launcher → Ajustes. The launcher restarts n8n to apply them.",
      "Optional: TELEGRAM_TOKEN_ALERTAS for failure alerts; without it they go out through the first bot configured.",
      "Failures are reported by the «Sistema - Gestor de errores» workflow, so a wrong token does not fail silently.",
    ],
    check: "manual",
  },
  {
    id: "google-oauth",
    title: "Google OAuth 2.0 (Gmail + Calendar)",
    kind: "oauth2",
    usedBy: ["agenda"],
    location: "n8n",
    n8nCredentialTypes: ["Gmail OAuth2 API", "Google Calendar OAuth2 API"],
    obtainHref: "https://console.cloud.google.com/apis/credentials",
    obtainLabel: "Open Google Cloud Console",
    steps: [
      "See the OAuth section below: create the OAuth client, then connect both credentials in n8n.",
    ],
    check: "manual",
  },
];

/* --------------------------------- OAuth --------------------------------- */

export interface OAuthCredentialSpec {
  /** Name of the credential type as n8n shows it in Credentials → New. */
  n8nType: string;
  /** Workflow nodes that must point at it. */
  nodes: string[];
  scopes: string[];
}

export interface OAuthProviderSpec {
  id: string;
  provider: string;
  usedBy: AutomationKey[];
  authorizationUrl: string;
  tokenUrl: string;
  /** Path n8n serves the callback on; prefixed with the n8n editor URL. */
  redirectPath: string;
  consoleUrl: string;
  apisToEnable: { name: string; href: string }[];
  credentials: OAuthCredentialSpec[];
  steps: string[];
  revokeUrl: string;
}

export const GOOGLE_OAUTH: OAuthProviderSpec = {
  id: "google",
  provider: "Google",
  usedBy: ["agenda"],
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  redirectPath: "/rest/oauth2-credential/callback",
  consoleUrl: "https://console.cloud.google.com/apis/credentials",
  apisToEnable: [
    { name: "Gmail API", href: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
    { name: "Google Calendar API", href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
  ],
  credentials: [
    {
      n8nType: "Gmail OAuth2 API",
      nodes: ["Correo nuevo (Gmail)", "Gmail - Correos recientes (prueba)"],
      scopes: [
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.addons.current.action.compose",
        "https://www.googleapis.com/auth/gmail.addons.current.message.action",
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.compose",
      ],
    },
    {
      n8nType: "Google Calendar OAuth2 API",
      nodes: ["Google Calendar - Crear evento"],
      scopes: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
      ],
    },
  ],
  steps: [
    "Google Cloud Console → create a project and enable the Gmail API and the Google Calendar API.",
    "OAuth consent screen → External → add your own Gmail address as a test user (no Google review needed in Testing).",
    "Credentials → Create credentials → OAuth client ID → Web application. Add the redirect URI shown here.",
    "In n8n → Credentials → New → Gmail OAuth2 API: paste the Client ID and Client secret, then Sign in with Google.",
    "Repeat with Google Calendar OAuth2 API (the same client can be reused).",
    "Open the «Asistente - Email» workflow, select both credentials in the Gmail and Calendar nodes, run it once and activate it.",
  ],
  revokeUrl: "https://myaccount.google.com/permissions",
};

export function oauthRedirectUri(n8nUrl: string, spec: OAuthProviderSpec = GOOGLE_OAUTH): string {
  return n8nUrl.replace(/\/+$/, "") + spec.redirectPath;
}
