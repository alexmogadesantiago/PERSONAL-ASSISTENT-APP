import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aiApi,
  credentialsApi,
  n8nApi,
  profilesApi,
  servicesApi,
  systemApi,
  type CredentialInput,
  type ProfileInput,
} from "@/api";
import type { AiConfigUpdate, AiProviderId, N8nHealth, ServiceConfigUpdate } from "@/api/types";

export const qk = {
  health: ["health"] as const,
  systemStatus: ["system", "status"] as const,
  systemMetrics: ["system", "metrics"] as const,
  logs: (params: Record<string, unknown>) => ["logs", params] as const,
  profiles: ["profiles"] as const,
  profile: (id: string) => ["profiles", id] as const,
  profileDimensions: ["profiles", "dimensions"] as const,
  profileCompleteness: ["profiles", "completeness"] as const,
  profileCatalog: ["profiles", "catalog"] as const,
  serviceConfigs: ["services", "config"] as const,
  aiConfig: ["ai", "config"] as const,
  aiProviders: ["ai", "providers"] as const,
  aiModels: (provider: string) => ["ai", "models", provider] as const,
  aiHealth: ["ai", "health"] as const,
  credentials: ["credentials"] as const,
  credentialStore: ["credentials", "store-status"] as const,
  n8nHealth: ["n8n", "health"] as const,
  workflows: ["n8n", "workflows"] as const,
  workflow: (id: string) => ["n8n", "workflows", id] as const,
  executions: (params: Record<string, unknown>) => ["n8n", "executions", params] as const,
};

/* ------------------------------- system ------------------------------- */

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => systemApi.health(signal),
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useSystemStatus(enabled = true) {
  return useQuery({
    queryKey: qk.systemStatus,
    queryFn: ({ signal }) => systemApi.status(signal),
    refetchInterval: 15_000,
    enabled,
    retry: 1,
  });
}

export function useSystemMetrics(enabled = true) {
  return useQuery({
    queryKey: qk.systemMetrics,
    queryFn: ({ signal }) => systemApi.metrics(signal),
    refetchInterval: 15_000,
    enabled,
    retry: 1,
  });
}

/**
 * Forced re-probe. Invalidates the cached status so every consumer (the
 * monitoring page, the dashboard tiles) reflects the fresh result at once.
 */
export function useForceServiceCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => systemApi.check(),
    onSuccess: (data) => {
      qc.setQueryData(qk.systemStatus, data);
      qc.invalidateQueries({ queryKey: qk.serviceConfigs });
      qc.invalidateQueries({ queryKey: qk.n8nHealth });
    },
  });
}

/* ----------------------- service configuration ------------------------ */

export function useServiceConfigs() {
  return useQuery({
    queryKey: qk.serviceConfigs,
    queryFn: async () => (await servicesApi.list()).data,
    staleTime: 10_000,
  });
}

export function useServiceConfigMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.serviceConfigs });
    // configuration changes what the monitor probes, so refresh it too
    qc.invalidateQueries({ queryKey: qk.systemStatus });
    qc.invalidateQueries({ queryKey: qk.n8nHealth });
  };
  return {
    save: useMutation({
      mutationFn: (v: { service: string; input: ServiceConfigUpdate }) =>
        servicesApi.update(v.service, v.input),
      onSuccess: invalidate,
    }),
    test: useMutation({
      mutationFn: (service: string) => servicesApi.test(service),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------ artificial intelligence --------------------- */

export function useAiConfig() {
  return useQuery({ queryKey: qk.aiConfig, queryFn: aiApi.config, staleTime: 10_000 });
}

export function useAiProviders() {
  return useQuery({ queryKey: qk.aiProviders, queryFn: async () => (await aiApi.providers()).data });
}

/**
 * Models for one provider. The backend asks the provider itself and falls back
 * to a maintained catalogue, flagging which it returned - so the selector never
 * presents a stale guess as live data.
 */
export function useAiModels(provider: AiProviderId | "" | undefined) {
  return useQuery({
    queryKey: qk.aiModels(provider ?? ""),
    queryFn: () => aiApi.models(provider as AiProviderId),
    enabled: !!provider,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

export function useAiHealth(enabled = true) {
  return useQuery({
    queryKey: qk.aiHealth,
    queryFn: () => aiApi.health(),
    enabled,
    refetchInterval: 60_000,
    retry: 0,
  });
}

export function useAiMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.aiConfig });
    qc.invalidateQueries({ queryKey: qk.aiProviders });
    qc.invalidateQueries({ queryKey: qk.aiHealth });
    // the AI tile on /monitoring is computed from the same configuration
    qc.invalidateQueries({ queryKey: qk.systemStatus });
    qc.invalidateQueries({ queryKey: qk.serviceConfigs });
  };
  return {
    save: useMutation({ mutationFn: (input: AiConfigUpdate) => aiApi.update(input), onSuccess: invalidate }),
    /**
     * Credentials only. Same endpoint, but the caller sends no `provider`, so
     * giving the fallback a key cannot silently promote it to primary. It is a
     * separate mutation so the two Save buttons have independent pending and
     * error states.
     */
    saveCredentials: useMutation({
      mutationFn: (input: AiConfigUpdate) => aiApi.update(input),
      onSuccess: invalidate,
    }),
    test: useMutation({
      mutationFn: (input: { provider?: AiProviderId; model?: string } = {}) => aiApi.test(input),
      onSuccess: invalidate,
    }),
    rotateToken: useMutation({ mutationFn: () => aiApi.serviceToken.rotate(), onSuccess: invalidate }),
    revokeToken: useMutation({ mutationFn: () => aiApi.serviceToken.revoke(), onSuccess: invalidate }),
  };
}

export function useLogsBacklog(params: { level?: string; limit?: number; source?: string }) {
  return useQuery({
    queryKey: qk.logs(params),
    queryFn: () => systemApi.logs(params),
    retry: 1,
  });
}

/* ------------------------------ profiles ------------------------------ */

export function useProfiles() {
  return useQuery({ queryKey: qk.profiles, queryFn: profilesApi.list });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: qk.profile(id ?? ""),
    queryFn: () => profilesApi.get(id as string),
    enabled: !!id,
  });
}

export function useProfileDimensions() {
  return useQuery({
    queryKey: qk.profileDimensions,
    queryFn: profilesApi.dimensions,
    staleTime: 5 * 60_000,
  });
}

/** The option catalogue the visual profile builder renders. Static, so it is
 *  cached hard: it only changes when the backend ships new options. */
export function useProfileCatalog() {
  return useQuery({
    queryKey: qk.profileCatalog,
    queryFn: profilesApi.catalog,
    staleTime: 60 * 60_000,
  });
}

/** Does the signed-in user have a profile the automations can actually use? */
export function useProfileCompleteness() {
  return useQuery({
    queryKey: qk.profileCompleteness,
    queryFn: profilesApi.completeness,
    staleTime: 30_000,
  });
}

export function useProfileMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.profiles });
    // editing a profile can flip the PROFILE tile on /monitoring
    qc.invalidateQueries({ queryKey: qk.profileCompleteness });
    qc.invalidateQueries({ queryKey: qk.systemStatus });
  };
  return {
    create: useMutation({ mutationFn: (input: ProfileInput) => profilesApi.create(input), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: (v: { id: string; input: Parameters<typeof profilesApi.update>[1] }) =>
        profilesApi.update(v.id, v.input),
      onSuccess: (_d, v) => {
        invalidate();
        qc.invalidateQueries({ queryKey: qk.profile(v.id) });
      },
    }),
    duplicate: useMutation({
      mutationFn: (v: { id: string; name?: string }) => profilesApi.duplicate(v.id, v.name),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => profilesApi.remove(id), onSuccess: invalidate }),
    activate: useMutation({ mutationFn: (id: string) => profilesApi.activate(id), onSuccess: invalidate }),
    deactivate: useMutation({ mutationFn: (id: string) => profilesApi.deactivate(id), onSuccess: invalidate }),
    setPrimary: useMutation({ mutationFn: (id: string) => profilesApi.setPrimary(id), onSuccess: invalidate }),
  };
}

/* ----------------------------- credentials ---------------------------- */

export function useCredentials() {
  return useQuery({ queryKey: qk.credentials, queryFn: credentialsApi.list });
}

export function useCredentialStore() {
  return useQuery({ queryKey: qk.credentialStore, queryFn: credentialsApi.storeStatus, staleTime: 60_000 });
}

export function useCredentialMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.credentials });
  return {
    create: useMutation({ mutationFn: (input: CredentialInput) => credentialsApi.create(input), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: (v: { id: string; input: Parameters<typeof credentialsApi.update>[1] }) =>
        credentialsApi.update(v.id, v.input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => credentialsApi.remove(id), onSuccess: invalidate }),
    test: useMutation({
      mutationFn: (id: string) => credentialsApi.test(id),
      onSuccess: invalidate,
    }),
  };
}

/* -------------------------------- n8n -------------------------------- */

export function useN8nHealth() {
  return useQuery({ queryKey: qk.n8nHealth, queryFn: n8nApi.health, refetchInterval: 30_000, retry: 0 });
}

export type N8nState = "online" | "offline" | "not_configured" | "unknown";

/**
 * Derive the n8n integration state, using the same vocabulary as the service
 * monitor. "not configured" is not an outage: an environment without n8n wired
 * up must not look broken. Falls back to the pre-`status` response shape so an
 * un-upgraded backend still reads correctly.
 */
export function n8nStateOf(data: N8nHealth | undefined, isError = false): N8nState {
  if (!data) return isError ? "offline" : "unknown";
  if (data.status) return data.status;
  if (!data.api_key_configured) return "not_configured";
  return data.reachable === false ? "offline" : "online";
}

export function useWorkflows() {
  return useQuery({ queryKey: qk.workflows, queryFn: () => n8nApi.workflows({ limit: 200 }), retry: 0 });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: qk.workflow(id ?? ""),
    queryFn: () => n8nApi.workflow(id as string),
    enabled: !!id,
    retry: 0,
  });
}

export function useExecutions(params: { workflow_id?: string; status?: string; limit?: number }) {
  return useQuery({
    queryKey: qk.executions(params),
    queryFn: () => n8nApi.executions(params),
    retry: 0,
    refetchInterval: 20_000,
  });
}

export function useWorkflowMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.workflows });
  };
  return {
    activate: useMutation({ mutationFn: (id: string) => n8nApi.activate(id), onSuccess: invalidate }),
    deactivate: useMutation({ mutationFn: (id: string) => n8nApi.deactivate(id), onSuccess: invalidate }),
    run: useMutation({ mutationFn: (id: string) => n8nApi.run(id) }),
  };
}
