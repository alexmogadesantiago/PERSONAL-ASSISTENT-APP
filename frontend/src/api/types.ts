/** Response shapes mirrored from the FastAPI backend (app/schemas/*). */

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled" | "pending";

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  last_login_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  environment: string;
  database: string;
  problems: string[];
}

/**
 * `online`         reachable and answering (HTTP / TCP services)
 * `configured`     set up and verified, but not something you can ping
 *                  (profile data in Postgres)
 * `degraded`       reachable but only partly usable (n8n up, API key rejected)
 * `invalid`        configured with credentials the provider refuses
 * `offline`        configured, but not responding
 * `not_configured` nothing configured here - deliberately NOT an error
 * `unknown`        the probe itself could not run
 */
export type ServiceStatus =
  | "online"
  | "configured"
  | "degraded"
  | "invalid"
  | "offline"
  | "not_configured"
  | "unknown";

export interface ServiceState {
  name: string;
  kind: string;
  target: string;
  status: ServiceStatus;
  /** Back-compat: true for online/configured, false for offline/invalid, else null. */
  online: boolean | null;
  configured?: boolean;
  detail: string;
  latency_ms: number | null;
  checked_at?: string;
  meta?: Record<string, unknown>;
}

export interface SystemStatus {
  operational: boolean;
  state: "operational" | "degraded";
  degraded_services: string[];
  not_configured_services: string[];
  services: ServiceState[];
  checked_at: string;
}

export interface HostMetrics {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_free_gb: number;
  disk_total_gb: number;
  load_avg_1m: number | null;
  uptime_seconds: number;
  sampled_at: string;
}

export interface LogEntry {
  type: string;
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
  correlation_id: string | null;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  description: string;
  configuration: Record<string, unknown>;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileDimensions {
  dimensions: string[];
  note: string;
}

export type CredentialType = "api_key" | "bearer" | "basic_auth" | "oauth2" | "custom";
export type CredentialStatus = "connected" | "error" | "untested" | "disabled";

export interface Credential {
  id: string;
  provider: string;
  name: string;
  type: string;
  status: CredentialStatus;
  hint: string;
  meta: Record<string, unknown>;
  is_enabled: boolean;
  last_tested_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialTestResult {
  ok: boolean;
  detail: string;
  latency_ms: number | null;
  status: string;
}

export interface N8nHealth {
  base_url: string;
  api_key_configured: boolean;
  /** Same vocabulary as the service monitor. Absent on older backends. */
  status?: Extract<ServiceStatus, "online" | "offline" | "not_configured">;
  reachable?: boolean;
  api_key_valid?: boolean;
  detail?: string;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: Array<{ id: string; name: string }>;
  nodes?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface N8nExecution {
  id: string;
  workflowId?: string;
  finished?: boolean;
  mode?: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
  [k: string]: unknown;
}

export interface Paginated<T> {
  data: T[];
}

/* ------------------------- service configuration ------------------------- */

/** Where the effective configuration came from. */
export type ConfigSource = "database" | "environment" | "none";

/**
 * One integration's configuration as the panel sees it. Never carries the
 * secret itself - only `secret_configured` and a `secret_hint` like "…a3f9".
 */
export interface ServiceConfig {
  service: string;
  label: string;
  /** `infra` gets a generic card in Settings; `ai` is owned by the AI panel. */
  category?: "infra" | "ai" | "internal";
  configured: boolean;
  enabled: boolean;
  source: ConfigSource;
  base_url: string;
  requires_url: boolean;
  requires_secret: boolean;
  secret_configured: boolean;
  secret_hint: string;
  /** Names of the settings still missing, ready to show to the user. */
  missing: string[];
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: string;
}

export interface ServiceConfigUpdate {
  base_url?: string;
  /** Omit to keep the stored secret; use `clear_secret` to remove it. */
  secret?: string;
  clear_secret?: boolean;
  enabled?: boolean;
}

export interface ServiceTestResult {
  service: string;
  ok: boolean;
  status: ServiceStatus;
  detail: string;
  latency_ms: number | null;
}

/* --------------------------- profile completeness ------------------------ */

export interface ProfileCompletenessReport {
  profile_id: string;
  name: string;
  complete: boolean;
  filled: string[];
  missing: string[];
  score: number;
}

export interface ProfileCompleteness {
  configured: boolean;
  profile_count: number;
  detail: string;
  required_fields: string[];
  best: ProfileCompletenessReport | null;
}

/* ---------------------------- profile catalog ---------------------------- */

/**
 * How a field is picked. Nothing here is typed by the user except `text`,
 * which only appears behind an "Otra" option.
 */
export type CatalogFieldKind = "multi" | "single" | "scale" | "toggle" | "text";

export interface CatalogOption {
  id: string;
  label: string;
}

export interface CatalogField {
  key: string;
  /** Where the value is written inside `configuration`. */
  path: string[];
  label: string;
  kind: CatalogFieldKind;
  hint: string;
  options: CatalogOption[];
  /** Picking this option id reveals the free-text box below. */
  free_text_trigger: string;
  free_text_path: string[];
  free_text_label: string;
}

export interface CatalogSection {
  key: string;
  title: string;
  question: string;
  description: string;
  fields: CatalogField[];
}

export interface ProfileCatalog {
  sections: CatalogSection[];
  /** The sections the backend actually grades, so progress is not invented. */
  required_sections: string[];
}

/* ------------------------- artificial intelligence ----------------------- */

/** The providers the platform can talk to, in preference order. */
export type AiProviderId = "nvidia_nim" | "openrouter" | "gemini";

/** One provider in the picker. Never carries the key, only a hint. */
export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  tagline: string;
  recommended: boolean;
  api_style: string;
  default_base_url: string;
  default_model: string;
  key_help: string;
  console_url: string;
  service_key: string;
  configured: boolean;
  secret_configured: boolean;
  secret_hint: string;
  base_url: string;
  model: string;
  source: ConfigSource;
}

export interface AiProviderConfig {
  provider: AiProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  source: ConfigSource;
  base_url: string;
  model: string;
  secret_configured: boolean;
  secret_hint: string;
}

export interface AiServiceTokenStatus {
  configured: boolean;
  source: ConfigSource;
  hint: string;
}

export interface AiConfig {
  provider: AiProviderId | "";
  model: string;
  fallback_enabled: boolean;
  fallback_provider: AiProviderId | "";
  fallback_model: string;
  /** The fallback that would actually be used (configured, and not the primary). */
  effective_fallback_provider: AiProviderId | "";
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  source: "database" | "environment" | "default";
  configured: boolean;
  missing: string[];
  providers: AiProviderConfig[];
  service_token: AiServiceTokenStatus;
}

export interface AiCredentialUpdate {
  provider: AiProviderId;
  /** Omit to keep the stored key; use `clear_api_key` to remove it. */
  api_key?: string;
  base_url?: string;
  model?: string;
  clear_api_key?: boolean;
  enabled?: boolean;
}

export interface AiConfigUpdate {
  provider?: AiProviderId;
  model?: string;
  fallback_enabled?: boolean;
  fallback_provider?: AiProviderId | "";
  fallback_model?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_seconds?: number;
  credentials?: AiCredentialUpdate[];
}

export interface AiModel {
  id: string;
  label: string;
  /** `live` came from the provider; `catalog` is our maintained fallback list. */
  source: "live" | "catalog";
}

export interface AiModelList {
  provider: AiProviderId;
  live: boolean;
  detail: string;
  data: AiModel[];
}

export interface AiTestResult {
  ok: boolean;
  provider: string;
  model: string;
  status: string;
  detail: string;
  latency_ms: number | null;
}

export interface AiHealth {
  status: "online" | "degraded" | "invalid" | "offline" | "not_configured" | "unknown";
  detail: string;
  provider: string;
  model: string;
  latency_ms: number | null;
  fallback_provider: string;
  fallback_status: string;
  error: string;
  cached: boolean;
  checked_at: string;
  /** The last generation that actually fell back, if it was recent. */
  last_fallback: AiFallbackEvent | null;
}

/**
 * A generation that really was served by the fallback. Deliberately separate
 * from health: a 429 ten minutes ago does not make the primary unreachable
 * now, so it is reported alongside the status instead of folded into it.
 */
export interface AiFallbackEvent {
  at: string;
  age_seconds: number;
  primary: string;
  fallback: string;
  reason: string;
}

/* --------------------------- automation results -------------------------- */

/** One module the panel can read results from (`/api/pipelines`). */
export interface PipelineModuleInfo {
  module: string;
  label: string;
  description: string;
  privacy_note: string;
  searchable: string[];
}

/**
 * Results of one automation, already projected and truncated by the backend.
 * `items` carries only whitelisted fields - a correo never brings its body.
 */
export interface PipelineResult {
  module: string;
  label: string;
  description: string;
  privacy_note: string;
  workflow: { id: string; name: string } | null;
  items: Record<string, unknown>[];
  count: number;
  /** Items the inspected executions produced, before `limit`. */
  available: number;
  /** The search term this result was ranked against, if any. */
  query: string;
  /** How many items actually matched that term. */
  matched: number;
  /** True when nothing matched and the most recent items are returned instead. */
  relaxed: boolean;
  executions_inspected: number;
  latest_run_at: string | null;
  source_nodes: string[];
  /** Why there is nothing, when there is nothing. */
  detail: string;
  cached: boolean;
}

/* ------------------------------ generation ------------------------------ */

export type AiChatRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

/**
 * One completion, as `POST /api/ai/generate` accepts it. The caller never says
 * which provider should answer: that is platform configuration.
 */
export interface AiGenerateRequest {
  messages?: AiChatMessage[];
  prompt?: string;
  system?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: Record<string, unknown>;
  json_schema?: Record<string, unknown>;
}

export interface AiGenerateResponse {
  text: string;
  data: unknown | null;
  provider: string;
  model: string;
  latency_ms: number;
  finish_reason: string;
  usage: Record<string, unknown>;
  used_fallback: boolean;
  primary_provider: string;
  primary_error: string;
}

/** The only response that ever carries the token itself - shown once. */
export interface AiServiceTokenCreated {
  token: string;
  hint: string;
  note: string;
}
