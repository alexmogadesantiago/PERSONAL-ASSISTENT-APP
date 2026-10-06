/**
 * Typed client for the product layer: integrations, automations, observability.
 * Mirrors `backend/app/api/routes/{integrations,automation_builder,observability}.py`.
 */
import { api } from "./client";

/* ------------------------------------------------------------ integrations */

export type ProviderKey = "google" | "telegram" | "microsoft" | "github";
export type Health =
  | "healthy"
  | "degraded"
  | "expired"
  | "auth_required"
  | "error"
  | "not_connected"
  | "pending";

export interface Permission {
  scope: string;
  label: string;
  access: "read" | "write";
}

export interface ProviderService {
  key: string;
  label: string;
  description: string;
  capabilities: string[];
  permissions: Permission[];
}

export interface ConnectionPermission extends Permission {
  service: string;
  granted: boolean;
}

export interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface TelegramChat {
  id: number;
  title: string;
  type: string;
}

export interface Connection {
  id: string;
  health: Health;
  health_detail: string;
  account: { email?: string; name?: string; login?: string; avatar?: string };
  services: string[];
  requested_services: string[];
  permissions: ConnectionPermission[];
  connected_at: string | null;
  last_sync_at: string | null;
  last_refresh_at: string | null;
  last_tested_at: string | null;
  last_test: { ok: boolean; checks: CheckResult[] } | null;
  token_expires_at: string | null;
  security: { method: string; encrypted_at_rest: boolean; refresh: boolean; secret_hint: string };
  telegram?: {
    bot: { id?: number; username?: string; name?: string };
    chat: TelegramChat | null;
    link_url: string | null;
  };
}

export interface Integration {
  key: ProviderKey;
  label: string;
  tagline: string;
  description: string;
  auth: "oauth2" | "bot_token";
  docs_url: string;
  console_url: string;
  default_services: string[];
  services: ProviderService[];
  status: Health;
  connected: boolean;
  setup: { available: boolean; source: string; redirect_uri: string | null };
  connection: Connection | null;
  used_by: { id: string; name: string; status: string }[];
}

export interface TestOutcome {
  ok: boolean;
  health: Health;
  summary: string;
  action: "" | "reconnect" | "manage_permissions" | "retry" | "link_chat";
  checks: CheckResult[];
  latency_ms: number | null;
}

export interface OAuthApp {
  provider: ProviderKey;
  client_id: string;
  client_secret_configured: boolean;
  client_secret_hint: string;
  source: string;
  configured: boolean;
  redirect_uri: string;
  console_url: string;
  docs_url: string;
  scopes: string[];
}

export const integrationsApi = {
  list: () => api.get<{ data: Integration[]; store_configured: boolean }>("/api/integrations"),
  get: (key: string) => api.get<Integration>(`/api/integrations/${key}`),
  connect: (key: string, services: string[], returnTo = "") =>
    api.post<{ authorization_url: string; redirect_uri: string }>(`/api/integrations/${key}/connect`, {
      services,
      return_to: returnTo,
    }),
  test: (key: string) => api.post<TestOutcome>(`/api/integrations/${key}/test`),
  disconnect: (key: string) => api.del<{ disconnected: boolean }>(`/api/integrations/${key}`),
  dependencies: (key: string) => api.get<Dependencies>(`/api/integrations/${key}/dependencies`),
  telegramToken: (botToken: string) =>
    api.post<Integration & { link_url: string | null }>("/api/integrations/telegram/token", { bot_token: botToken }),
  telegramLink: () =>
    api.post<{ linked: boolean; chat: TelegramChat | null; link_url: string | null }>("/api/integrations/telegram/link"),
  telegramLinkReset: () => api.post<{ link_url: string | null }>("/api/integrations/telegram/link/reset"),
  telegramTestMessage: () => api.post<{ sent: boolean }>("/api/integrations/telegram/test-message"),
  app: (key: string) => api.get<OAuthApp>(`/api/integrations/${key}/app`),
  saveApp: (key: string, clientId: string, clientSecret?: string) =>
    api.put<OAuthApp>(`/api/integrations/${key}/app`, {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
};

/* ------------------------------------------------------------- automations */

export type BlockKind = "trigger" | "condition" | "ai" | "action" | "transform";

export interface BlockParam {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "bool" | "time" | "weekday";
  required: boolean;
  default: unknown;
  placeholder: string;
  help: string;
  options: { value: string; label: string }[];
  templated: boolean;
}

export interface Block {
  key: string;
  kind: BlockKind;
  label: string;
  description: string;
  provider: ProviderKey | null;
  service: string | null;
  icon: string;
  params: BlockParam[];
  outputs: string[];
  polling: boolean;
}

export interface SpecStep {
  id?: string;
  block: string;
  label?: string;
  params: Record<string, unknown>;
}

export interface AutomationSpec {
  name: string;
  description: string;
  trigger: { block: string; params: Record<string, unknown> };
  steps: SpecStep[];
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive" | "unknown";
  active: boolean;
  origin: "builder" | "ai" | "template";
  spec: AutomationSpec;
  providers: ProviderKey[];
  trigger_label: string;
  deploy: { status: "deployed" | "error" | "pending"; at?: string; error?: string };
  n8n_workflow_id: string | null;
  last_error: { step: string; at: string; code: string; message: string; provider: string | null } | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Template {
  id: string;
  title: string;
  category: string;
  description: string;
  spec: AutomationSpec;
  providers: ProviderKey[];
}

export interface DraftResult {
  ok: boolean;
  spec: AutomationSpec | null;
  providers: ProviderKey[];
  explanation?: string;
  problems: string[];
  error?: string;
}

export interface TestStepReport {
  step: string;
  label: string;
  block: string;
  ok: boolean;
  items: number;
  skipped?: boolean;
  sample?: Record<string, unknown> | null;
  error?: { code: string; message: string; provider: string | null };
  duration_ms: number;
}

export interface RunSummary {
  id: string;
  status: "success" | "error" | "running" | string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  mode?: string;
}

export interface RunStep {
  label: string;
  node: string;
  status: "success" | "error" | "skipped";
  items: number;
  duration_ms: number | null;
  error: string | null;
  /** When the step started (ISO), when n8n recorded it. */
  at?: string | null;
}

export interface RetryAdvice {
  retry: boolean;
  cause: string;
  suggestion: string;
  action: { label: string; href: string; kind: string } | null;
}

export interface RunDetail extends RunSummary {
  steps: RunStep[];
  workflow?: { id: string; name: string };
  diagnosis?: { title: string; explanation: string; action: { label: string; href: string; kind: string } } | null;
  retry_advice?: RetryAdvice | null;
}

export const automationsApi = {
  catalog: () => api.get<{ data: Block[] }>("/api/automations/catalog"),
  templates: () => api.get<{ data: Template[] }>("/api/automations/templates"),
  draft: (prompt: string) => api.post<DraftResult>("/api/automations/draft", { prompt }),
  test: (spec: AutomationSpec) =>
    api.post<{ ok: boolean; steps: TestStepReport[] }>("/api/automations/test", { spec }),
  list: () => api.get<{ data: Automation[] }>("/api/automations"),
  get: (id: string) => api.get<Automation>(`/api/automations/${id}`),
  create: (spec: AutomationSpec, origin: Automation["origin"] = "builder") =>
    api.post<Automation>("/api/automations", { spec, origin }),
  update: (id: string, spec: AutomationSpec) => api.put<Automation>(`/api/automations/${id}`, { spec }),
  remove: (id: string) => api.del<{ deleted: boolean }>(`/api/automations/${id}`),
  act: (id: string, verb: "activate" | "pause" | "duplicate" | "redeploy" | "run") =>
    api.post<Automation & { started?: boolean }>(`/api/automations/${id}/${verb}`),
  runs: (id: string) => api.get<{ data: RunSummary[] }>(`/api/automations/${id}/runs`),
  run: (id: string, executionId: string) => api.get<RunDetail>(`/api/automations/${id}/runs/${executionId}`),
};

/* ----------------------------------------------------------- observability */

export type ActivityCategory = "all" | "automations" | "ai" | "integrations" | "errors" | "security" | "system";

export interface ActivityItem {
  id: string;
  at: string | null;
  category: Exclude<ActivityCategory, "all">;
  kind: string;
  title: string;
  message: string;
  service: string;
  result: "success" | "error" | "warning" | "running";
  duration_ms: number | null;
  details: Record<string, unknown>;
  link: string | null;
}

export interface ErrorGroup {
  id: string;
  title: string;
  explanation: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  service: string;
  automation: string;
  source: string;
  count: number;
  first_seen: string | null;
  last_seen: string | null;
  action: { label: string; href: string; kind: string };
  link: string | null;
  /** The technical cause in one line (the explanation says what it means). */
  cause?: string;
  /** What stops working while this is open. */
  impact?: { automations: number; features: string[] };
}

export interface NotificationItem {
  id: string;
  at: string | null;
  tone: "success" | "warning" | "error" | "security" | "info";
  kind: "automation" | "integration" | "ai" | "security";
  title: string;
  body: string;
  action: { label: string; href: string } | null;
  unread: boolean;
}

export interface Overview {
  user: { name: string };
  system: { state: "operational" | "degraded" | "attention"; message: string };
  automations: { total: number; active: number; custom: number; system: number };
  executions: {
    today: number;
    failed_today: number;
    success_rate_7d: number | null;
    avg_duration_ms: number | null;
    series: { date: string; success: number; error: number }[];
  };
  errors: { open: number; critical: number; top: ErrorGroup[] };
  integrations: { connected: number; total: number; unhealthy: { key: string; label: string; health: Health }[] };
  ai: { requests_today: number; avg_latency_ms?: number | null; errors_today?: number; series: { date: string; requests: number }[] };
  telegram?: { messages_today: number };
  n8n: { available: boolean; error: string | null };
  open_issues: number;
}

export const observabilityApi = {
  overview: () => api.get<Overview>("/api/overview"),
  activity: (category: ActivityCategory = "all", limit = 100) =>
    api.get<{ data: ActivityItem[]; sources: { n8n: boolean; n8n_error: string | null } }>("/api/activity", {
      category,
      limit,
    }),
  errors: () =>
    api.get<{ data: ErrorGroup[]; counts: Record<ErrorGroup["severity"], number> }>("/api/errors"),
  resolve: (key: string) => api.post<{ resolved: boolean }>(`/api/errors/${key}/resolve`),
  notifications: () => api.get<{ data: NotificationItem[]; unread: number }>("/api/notifications"),
  markRead: () => api.post<{ ok: boolean }>("/api/notifications/read"),
  execution: (id: string) => api.get<RunDetail>(`/api/executions/${id}`),
  n8nCenter: () => api.get<N8nCenter>("/api/n8n-center"),
};

/* ----------------------------------------------------------------- account */

export interface SessionInfo {
  id: string;
  created_at: string | null;
  expires_at: string | null;
  user_agent: string;
  client_ip: string;
}

export const accountApi = {
  sessions: () => api.get<SessionInfo[]>("/api/auth/sessions"),
  changePassword: (current: string, next: string) =>
    api.post<{ changed: boolean; sessions_revoked: number }>("/api/auth/password", {
      current_password: current,
      new_password: next,
    }),
};

/* --------------------------------------------------------------- assistant */

export type PriorityLevel = "low" | "normal" | "high" | "urgent";

export interface MailTriage {
  level: PriorityLevel | null;
  category: MailAnalysis["category"] | null;
  action_required: boolean | null;
  deadline: string | null;
}

export interface MailItem {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  has_attachments: boolean;
  attachments: { filename: string; mime: string }[];
  labels: string[];
  link: string;
  unread: boolean;
  important?: boolean;
  important_sender?: boolean;
  triage?: MailTriage | null;
  demo?: boolean;
  text?: string;
}

export interface PriorityReason {
  label: string;
  weight: number;
  positive: boolean;
}

export interface MailAnalysis {
  priority: PriorityLevel;
  ai_priority?: "high" | "medium" | "low";
  priority_score?: number;
  priority_reasons?: PriorityReason[];
  tasks?: { title: string; due: string | null }[];
  sender?: string;
  demo?: boolean;
  category: "important" | "school" | "work" | "personal" | "notification" | "spam-like";
  action_required: boolean;
  summary: string;
  deadline: string | null;
  deadline_title: string | null;
  suggested_action: string;
}

export interface Briefing {
  generated_at: string;
  greeting?: string;
  emails: MailItem[];
  important?: MailItem[];
  events: { title: string; start: string; end: string; location: string; link: string }[];
  deadlines?: { title: string; due: string; source: string; href: string; overdue?: boolean }[];
  automations?: { active: number; failed_today: number; success_rate: number | null; state: string; message: string };
  problems: { title: string; action: { label: string; href: string } }[];
  summary: string;
  notes: string[];
  demo?: boolean;
}

export interface Suggestion {
  id?: string;
  kind?: "weekly" | "frequent" | "pdf";
  title: string;
  detail: string;
  prompt: string;
}

export interface Insight {
  id: string;
  kind: "email" | "deadline" | "automation";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  action: { label: string; href: string };
}

export interface AskSection {
  key: "email" | "calendar" | "deadlines" | "errors";
  title: string;
  summary: string;
  count: number;
  items: { title: string; subtitle?: string; badge?: string | null; href?: string | null }[];
}

export interface AskAction {
  label: string;
  kind: "navigate" | "briefing" | "external";
  href?: string;
}

export interface AskResult {
  intent: string;
  title: string;
  sections: AskSection[];
  actions: AskAction[];
  notes: string[];
  /** Compact JSON the model writes its prose from; never rendered. */
  context: string;
  demo: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: "open" | "done";
  due_at: string | null;
  overdue: boolean;
  due_soon: boolean;
  source: { type?: string; message_id?: string; subject?: string; from?: string; href?: string };
  created_at: string | null;
  completed_at: string | null;
}

export interface MemoryItem {
  id: string;
  kind: "sender" | "note" | "dismissed";
  key: string;
  label: string;
  value: string;
  updated_at: string | null;
}

export interface MemoryOverview {
  preferences: Record<string, string | boolean>;
  preference_labels: Record<string, string>;
  items: MemoryItem[];
  counts: Record<string, number>;
}

export interface Privacy {
  access: { service: string; key: string; account: string; permissions: string[]; connected_at: string | null }[];
  ai: {
    provider: string | null;
    model: string | null;
    configured: boolean;
    fallback: string | null;
    data: { feature: string; sent: string; when: string }[];
    never: string[];
  };
  stored: {
    tasks: number;
    memory: number;
    priority_cache: number;
    automations: number;
    activity_events: number;
    local_only: string[];
  };
  demo_mode: boolean;
  retention: string[];
}

export interface SecurityCheck {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  action: { label: string; href: string } | null;
}

export interface SystemHealth {
  state: "operational" | "degraded";
  checked_at: string;
  items: { key: string; label: string; status: string; detail: string; latency_ms?: number | null }[];
}

export interface Dependencies {
  provider: string;
  connected: boolean;
  automations: { id: string; name: string; status: string }[];
  scheduled: number;
  features: string[];
}

export interface N8nCenter {
  available: boolean;
  state: "operational" | "degraded" | "unavailable" | "not_configured";
  error: string | null;
  message?: string;
  totals: {
    workflows: number;
    active: number;
    executions_today: number;
    failed_today: number;
    success_rate_today: number | null;
    success_rate_7d: number | null;
    last_execution: { at: string; status: string; workflow: string; id: string } | null;
  } | null;
  workflows: {
    id: string;
    name: string;
    active: boolean;
    kind: "custom" | "system" | "error_handler";
    automation_id: string | null;
    runs_7d: number;
    failed_7d: number;
    success_rate_7d: number | null;
    avg_duration_ms: number | null;
    last_run_at: string | null;
    last_status: string | null;
  }[];
}

export interface Showcase {
  demo: true;
  enabled: boolean;
  automations: { name: string; flow: string; status: string; runs: number; success_rate: number; last_run_minutes: number; avg_duration_ms: number }[];
  executions: { id: string; automation: string; status: string; started_at: string; duration_ms: number; steps: RunStep[] }[];
  errors: { id: string; title: string; cause: string; automation: string }[];
  events: { title: string; start: string; end: string; location: string }[];
  deadlines: { title: string; due: string; source: string }[];
  emails: { id: string; from: string; subject: string; snippet: string; date: string }[];
}

export interface CalendarEvent {
  title: string;
  start: string | null;
  end: string | null;
  location: string;
  link: string;
}

export type Tone = "default" | "formal" | "informal" | "concise" | "detailed";
export type MailAction = "archive" | "important" | "not_important" | "read";

export const assistantApi = {
  mail: (q = "in:inbox", limit = 15) => api.get<{ data: MailItem[]; demo?: boolean }>("/api/assistant/mail", { q, limit }),
  read: (id: string) => api.get<MailItem>(`/api/assistant/mail/${id}`),
  analyze: (id: string) => api.post<MailAnalysis>(`/api/assistant/mail/${id}/analyze`),
  draft: (id: string, instruction = "", tone: Tone = "default") =>
    api.post<{ to: string; subject: string; body: string; tone: Tone; demo?: boolean }>(
      `/api/assistant/mail/${id}/draft`,
      { instruction, tone },
    ),
  reply: (id: string, body: string) =>
    api.post<{ sent: boolean; demo?: boolean; message?: string }>(`/api/assistant/mail/${id}/reply`, { body }),
  modify: (id: string, action: MailAction) =>
    api.post<{ done: boolean; demo?: boolean; message?: string }>(`/api/assistant/mail/${id}/modify`, { action }),
  calendar: (days = 7) => api.get<{ data: CalendarEvent[]; demo?: boolean }>("/api/assistant/calendar", { days }),
  createEvent: (v: { title: string; start: string; duration_minutes?: number; notes?: string }) =>
    api.post<{ created: boolean; link?: string; demo?: boolean; message?: string }>("/api/assistant/calendar/events", v),
  briefing: (summary = true) => api.post<Briefing>(`/api/assistant/briefing?summary=${summary}`),
  briefingToTelegram: () =>
    api.post<{ sent: boolean; demo?: boolean; message?: string }>("/api/assistant/briefing/telegram"),
  insights: () => api.get<{ data: Insight[] }>("/api/assistant/insights"),
  ask: (question: string) => api.post<AskResult>("/api/assistant/ask", { question }),
  suggestions: () => api.get<{ data: Suggestion[] }>("/api/assistant/suggestions"),
  dismiss: (id: string) => api.post<void>("/api/assistant/suggestions/dismiss", { id }),
  tasks: (status: "open" | "done" | "all" = "open") => api.get<{ data: Task[] }>("/api/assistant/tasks", { status }),
  createTask: (v: { title: string; due?: string | null; notes?: string; source?: Task["source"] }) =>
    api.post<Task>("/api/assistant/tasks", v),
  updateTask: (id: string, v: { title?: string; due?: string; clear_due?: boolean; status?: "open" | "done"; notes?: string }) =>
    api.patch<Task>(`/api/assistant/tasks/${id}`, v),
  deleteTask: (id: string) => api.del<void>(`/api/assistant/tasks/${id}`),
  memory: () => api.get<MemoryOverview>("/api/assistant/memory"),
  setPreference: (key: string, value: string | boolean) =>
    api.put<{ preferences: MemoryOverview["preferences"] }>("/api/assistant/memory/preferences", { key, value }),
  addMemory: (kind: "sender" | "note", value: string, label = "") =>
    api.post<MemoryOverview>("/api/assistant/memory", { kind, value, label }),
  editMemory: (id: string, value: string) => api.patch<MemoryItem>(`/api/assistant/memory/${id}`, { value }),
  deleteMemory: (id: string) => api.del<void>(`/api/assistant/memory/${id}`),
  forget: (kind: string) => api.del<{ deleted: number }>(`/api/assistant/memory?kind=${kind}`),
  privacy: () => api.get<Privacy>("/api/assistant/privacy"),
  security: () => api.get<{ status: "ok" | "warn" | "fail"; checks: SecurityCheck[]; checked_at: string }>("/api/assistant/security"),
  health: () => api.get<SystemHealth>("/api/assistant/health"),
  showcase: () => api.get<Showcase>("/api/assistant/demo/showcase"),
};
