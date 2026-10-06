import { api } from "./client";
import type {
  AiConfig,
  AiConfigUpdate,
  AiGenerateRequest,
  AiGenerateResponse,
  AiHealth,
  AiModelList,
  AiProviderId,
  AiProviderInfo,
  AiServiceTokenCreated,
  AiServiceTokenStatus,
  AiTestResult,
  Credential,
  CredentialTestResult,
  HealthResponse,
  HostMetrics,
  LogEntry,
  N8nExecution,
  N8nHealth,
  N8nWorkflow,
  PipelineModuleInfo,
  PipelineResult,
  Profile,
  ProfileCatalog,
  ProfileCompleteness,
  ProfileDimensions,
  ServiceConfig,
  ServiceConfigUpdate,
  ServiceTestResult,
  SystemStatus,
  TokenResponse,
  User,
} from "./types";

export const authApi = {
  login: (identifier: string, password: string) =>
    api.post<TokenResponse>("/api/auth/login", { identifier, password }),
  register: (email: string, username: string, password: string) =>
    api.post<TokenResponse>("/api/auth/register", { email, username, password }),
  refresh: (refresh_token: string) => api.post<TokenResponse>("/api/auth/refresh", { refresh_token }),
  logout: (refresh_token: string) => api.post<{ revoked: boolean }>("/api/auth/logout", { refresh_token }),
  me: () => api.get<User>("/api/auth/me"),
};

export const systemApi = {
  health: (signal?: AbortSignal) => api.getPublic<HealthResponse>("/api/health", signal),
  status: (signal?: AbortSignal) => api.getPublic<SystemStatus>("/api/system/status", signal),
  metrics: (signal?: AbortSignal) => api.getPublic<HostMetrics>("/api/system/metrics", signal),
  /** Forced, uncached re-probe of every service (the CHECK SERVICES button). */
  check: () => api.post<SystemStatus>("/api/system/check"),
  logs: (params: { level?: string; limit?: number; source?: string } = {}) =>
    api.get<{ data: LogEntry[]; count: number }>("/api/logs", {
      level: params.level,
      limit: params.limit,
      source: params.source,
    }),
};

export interface ProfileInput {
  name: string;
  description?: string;
  configuration?: Record<string, unknown>;
  make_primary?: boolean;
}

export const profilesApi = {
  list: () => api.get<Profile[]>("/api/profiles"),
  get: (id: string) => api.get<Profile>(`/api/profiles/${id}`),
  dimensions: () => api.get<ProfileDimensions>("/api/profiles/dimensions"),
  completeness: () => api.get<ProfileCompleteness>("/api/profiles/completeness"),
  /** The pickable options the personalisation UI renders (public). */
  catalog: () => api.getPublic<ProfileCatalog>("/api/profiles/catalog"),
  create: (input: ProfileInput) => api.post<Profile>("/api/profiles", input),
  update: (
    id: string,
    input: Partial<Pick<ProfileInput, "name" | "description" | "configuration">> & { is_active?: boolean },
  ) => api.patch<Profile>(`/api/profiles/${id}`, input),
  duplicate: (id: string, name?: string) =>
    api.post<Profile>(`/api/profiles/${id}/duplicate`, name ? { name } : {}),
  remove: (id: string) => api.del<{ deleted: boolean }>(`/api/profiles/${id}`),
  activate: (id: string) => api.post<Profile>(`/api/profiles/${id}/activate`),
  deactivate: (id: string) => api.post<Profile>(`/api/profiles/${id}/deactivate`),
  setPrimary: (id: string) => api.post<Profile>(`/api/profiles/${id}/primary`),
};

export interface CredentialInput {
  provider: string;
  name: string;
  type: string;
  secret: Record<string, string>;
  meta?: Record<string, unknown>;
}

export const credentialsApi = {
  list: () => api.get<Credential[]>("/api/credentials"),
  get: (id: string) => api.get<Credential>(`/api/credentials/${id}`),
  storeStatus: () => api.get<{ configured: boolean }>("/api/credentials/store-status"),
  create: (input: CredentialInput) => api.post<Credential>("/api/credentials", input),
  update: (
    id: string,
    input: { name?: string; secret?: Record<string, string>; meta?: Record<string, unknown>; is_enabled?: boolean },
  ) => api.patch<Credential>(`/api/credentials/${id}`, input),
  remove: (id: string) => api.del<{ deleted: boolean }>(`/api/credentials/${id}`),
  test: (id: string) => api.post<CredentialTestResult>(`/api/credentials/${id}/test`),
};

/**
 * Integration configuration, editable from the panel. Writes are admin-only on
 * the backend; the UI hides the controls for everyone else.
 */
export const servicesApi = {
  list: () => api.get<{ data: ServiceConfig[] }>("/api/services/config"),
  get: (service: string) => api.get<ServiceConfig>(`/api/services/config/${service}`),
  update: (service: string, input: ServiceConfigUpdate) =>
    api.put<ServiceConfig>(`/api/services/config/${service}`, input),
  test: (service: string) => api.post<ServiceTestResult>(`/api/services/config/${service}/test`),
};

/**
 * Artificial Intelligence. The panel picks a provider and a model; the
 * automations never do - they call `/api/ai/generate` and get whatever the
 * platform is configured to use.
 *
 * No response here carries an API key. `serviceToken.rotate` is the single
 * exception: the freshly minted token has to be shown once so it can be pasted
 * into n8n.
 */
export const aiApi = {
  providers: () => api.get<{ data: AiProviderInfo[] }>("/api/ai/providers"),
  config: () => api.get<AiConfig>("/api/ai/config"),
  update: (input: AiConfigUpdate) => api.put<AiConfig>("/api/ai/config", input),
  models: (provider?: AiProviderId, refresh = false) =>
    api.get<AiModelList>("/api/ai/models", { provider, refresh }),
  test: (input: { provider?: AiProviderId; model?: string } = {}) =>
    api.post<AiTestResult>("/api/ai/test", input),
  health: (force = false) => api.get<AiHealth>("/api/ai/health", { force }),
  /**
   * The same door the automations use. A signed-in session is accepted, so the
   * panel's assistant talks to whichever provider the platform is configured
   * with - no second integration, no key in the browser.
   *
   * `signal` aborts it: that is what Stop is wired to.
   */
  generate: (input: AiGenerateRequest, signal?: AbortSignal) =>
    api.post<AiGenerateResponse>("/api/ai/generate", input, signal),
  serviceToken: {
    status: () => api.get<AiServiceTokenStatus>("/api/ai/service-token"),
    rotate: () => api.post<AiServiceTokenCreated>("/api/ai/service-token"),
    revoke: () => api.del<AiServiceTokenStatus>("/api/ai/service-token"),
  },
};

export const n8nApi = {
  health: () => api.get<N8nHealth>("/api/n8n/health"),
  workflows: (params: { active?: boolean; limit?: number } = {}) =>
    api.get<{ data: N8nWorkflow[] }>("/api/n8n/workflows", {
      active: params.active,
      limit: params.limit,
    }),
  workflow: (id: string) => api.get<N8nWorkflow>(`/api/n8n/workflows/${id}`),
  activate: (id: string) => api.post<N8nWorkflow>(`/api/n8n/workflows/${id}/activate`),
  deactivate: (id: string) => api.post<N8nWorkflow>(`/api/n8n/workflows/${id}/deactivate`),
  run: (id: string) => api.post<unknown>(`/api/n8n/workflows/${id}/run`),
  executions: (params: { workflow_id?: string; status?: string; limit?: number } = {}) =>
    api.get<{ data: N8nExecution[] }>("/api/n8n/executions", {
      workflow_id: params.workflow_id,
      status: params.status,
      limit: params.limit,
    }),
  execution: (id: string, includeData = false) =>
    api.get<N8nExecution>(`/api/n8n/executions/${id}`, { include_data: includeData }),
};

/**
 * What the four automations actually produced. The backend reads it out of the
 * n8n execution store, projects a whitelist of fields and truncates - see
 * `services/pipelines.py`. Nothing here is stored anywhere else, so these are
 * the only real results the panel can show.
 */
export const pipelinesApi = {
  modules: () => api.get<{ data: PipelineModuleInfo[] }>("/api/pipelines"),
  get: (
    module: string,
    params: { limit?: number; scan?: number; since?: string; q?: string } = {},
    signal?: AbortSignal,
  ) =>
    api.get<PipelineResult>(
      `/api/pipelines/${module}`,
      { limit: params.limit, scan: params.scan, since: params.since, q: params.q },
      signal,
    ),
};

export { api, ApiError, authEvents } from "./client";
