/**
 * React Query hooks for the product layer. Polling is deliberate and modest:
 * the overview and notifications refresh every 30 s, everything else on focus
 * or after a mutation. No WebSocket is needed for data that changes per run.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  automationsApi,
  integrationsApi,
  observabilityApi,
  type ActivityCategory,
  type Automation,
  type AutomationSpec,
} from "@/api/platform";

export const pk = {
  integrations: ["integrations"] as const,
  integration: (key: string) => ["integrations", key] as const,
  oauthApp: (key: string) => ["integrations", key, "app"] as const,
  catalog: ["automations", "catalog"] as const,
  templates: ["automations", "templates"] as const,
  automations: ["automations", "list"] as const,
  automation: (id: string) => ["automations", "one", id] as const,
  runs: (id: string) => ["automations", "runs", id] as const,
  run: (id: string, ex: string) => ["automations", "run", id, ex] as const,
  overview: ["overview"] as const,
  activity: (c: string) => ["activity", c] as const,
  errors: ["errors"] as const,
  notifications: ["notifications"] as const,
  execution: (id: string) => ["execution", id] as const,
};

/* --------------------------------------------------------- integrations */

export function useIntegrations() {
  return useQuery({ queryKey: pk.integrations, queryFn: integrationsApi.list, staleTime: 15_000 });
}

export function useIntegration(key: string | undefined) {
  return useQuery({
    queryKey: pk.integration(key ?? ""),
    queryFn: () => integrationsApi.get(key as string),
    enabled: !!key,
  });
}

export function useOAuthApp(key: string | undefined, enabled = true) {
  return useQuery({
    queryKey: pk.oauthApp(key ?? ""),
    queryFn: () => integrationsApi.app(key as string),
    enabled: !!key && enabled,
    retry: 0,
  });
}

export function useIntegrationMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: pk.integrations });
    qc.invalidateQueries({ queryKey: pk.overview });
    qc.invalidateQueries({ queryKey: pk.errors });
    qc.invalidateQueries({ queryKey: pk.notifications });
  };
  return {
    connect: useMutation({
      mutationFn: (v: { key: string; services: string[]; returnTo?: string }) =>
        integrationsApi.connect(v.key, v.services, v.returnTo),
    }),
    test: useMutation({ mutationFn: (key: string) => integrationsApi.test(key), onSuccess: refresh }),
    disconnect: useMutation({ mutationFn: (key: string) => integrationsApi.disconnect(key), onSuccess: refresh }),
    telegramToken: useMutation({ mutationFn: (t: string) => integrationsApi.telegramToken(t), onSuccess: refresh }),
    telegramLink: useMutation({ mutationFn: () => integrationsApi.telegramLink(), onSuccess: refresh }),
    telegramLinkReset: useMutation({ mutationFn: () => integrationsApi.telegramLinkReset(), onSuccess: refresh }),
    telegramTestMessage: useMutation({ mutationFn: () => integrationsApi.telegramTestMessage() }),
    saveApp: useMutation({
      mutationFn: (v: { key: string; clientId: string; clientSecret?: string }) =>
        integrationsApi.saveApp(v.key, v.clientId, v.clientSecret),
      onSuccess: (_d, v) => {
        refresh();
        qc.invalidateQueries({ queryKey: pk.oauthApp(v.key) });
      },
    }),
  };
}

/* ---------------------------------------------------------- automations */

export function useBlockCatalog() {
  return useQuery({
    queryKey: pk.catalog,
    queryFn: async () => (await automationsApi.catalog()).data,
    staleTime: Infinity,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: pk.templates,
    queryFn: async () => (await automationsApi.templates()).data,
    staleTime: Infinity,
  });
}

export function useCustomAutomations() {
  return useQuery({ queryKey: pk.automations, queryFn: async () => (await automationsApi.list()).data });
}

export function useCustomAutomation(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: pk.automation(id ?? ""),
    queryFn: () => automationsApi.get(id as string),
    enabled: !!id && enabled,
    retry: 0,
  });
}

export function useAutomationRuns(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: pk.runs(id ?? ""),
    queryFn: async () => (await automationsApi.runs(id as string)).data,
    enabled: !!id && enabled,
    retry: 0,
    refetchInterval: 30_000,
  });
}

export function useAutomationRun(id: string | undefined, executionId: string | undefined) {
  return useQuery({
    queryKey: pk.run(id ?? "", executionId ?? ""),
    queryFn: () => automationsApi.run(id as string, executionId as string),
    enabled: !!id && !!executionId,
    retry: 0,
  });
}

export function useAutomationMutations() {
  const qc = useQueryClient();
  const refresh = (a?: Automation) => {
    qc.invalidateQueries({ queryKey: pk.automations });
    qc.invalidateQueries({ queryKey: pk.overview });
    qc.invalidateQueries({ queryKey: pk.integrations });
    if (a?.id) qc.setQueryData(pk.automation(a.id), a);
  };
  return {
    create: useMutation({
      mutationFn: (v: { spec: AutomationSpec; origin?: Automation["origin"] }) =>
        automationsApi.create(v.spec, v.origin),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; spec: AutomationSpec }) => automationsApi.update(v.id, v.spec),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => automationsApi.remove(id), onSuccess: () => refresh() }),
    act: useMutation({
      mutationFn: (v: { id: string; verb: "activate" | "pause" | "duplicate" | "redeploy" | "run" }) =>
        automationsApi.act(v.id, v.verb),
      onSuccess: (a, v) => {
        if (v.verb === "run") qc.invalidateQueries({ queryKey: pk.runs(v.id) });
        else refresh(a);
      },
    }),
    test: useMutation({ mutationFn: (spec: AutomationSpec) => automationsApi.test(spec) }),
    draft: useMutation({ mutationFn: (prompt: string) => automationsApi.draft(prompt) }),
  };
}

/* -------------------------------------------------------- observability */

export function useOverview() {
  return useQuery({ queryKey: pk.overview, queryFn: observabilityApi.overview, refetchInterval: 30_000 });
}

export function useActivityFeed(category: ActivityCategory) {
  return useQuery({
    queryKey: pk.activity(category),
    queryFn: () => observabilityApi.activity(category, 150),
    refetchInterval: 30_000,
  });
}

export function useErrorCenter() {
  return useQuery({ queryKey: pk.errors, queryFn: observabilityApi.errors, refetchInterval: 60_000 });
}

export function useResolveError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => observabilityApi.resolve(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.errors });
      qc.invalidateQueries({ queryKey: pk.overview });
    },
  });
}

export function useNotifications() {
  return useQuery({ queryKey: pk.notifications, queryFn: observabilityApi.notifications, refetchInterval: 30_000 });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => observabilityApi.markRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: pk.notifications }),
  });
}

export function useExecutionDetail(id: string | undefined) {
  return useQuery({
    queryKey: pk.execution(id ?? ""),
    queryFn: () => observabilityApi.execution(id as string),
    enabled: !!id,
    retry: 0,
  });
}

/* ------------------------------------------------------------ assistant */

import {
  assistantApi,
  type MailAction,
  type Task,
  type Tone,
} from "@/api/platform";

export const ak = {
  mail: (q: string) => ["assistant", "mail", q] as const,
  briefing: ["assistant", "briefing"] as const,
  insights: ["assistant", "insights"] as const,
  suggestions: ["assistant", "suggestions"] as const,
  tasks: (s: string) => ["assistant", "tasks", s] as const,
  memory: ["assistant", "memory"] as const,
  privacy: ["assistant", "privacy"] as const,
  security: ["assistant", "security"] as const,
  health: ["assistant", "health"] as const,
  showcase: ["assistant", "showcase"] as const,
  n8n: ["n8n-center"] as const,
  deps: (k: string) => ["integrations", k, "deps"] as const,
};

/** Mail is fetched on demand and cached for a minute: Gmail is the slow call. */
export function useMail(q: string, enabled = true) {
  return useQuery({
    queryKey: ak.mail(q),
    queryFn: async () => assistantApi.mail(q, 20),
    enabled,
    staleTime: 60_000,
    retry: 0,
  });
}

export function useInsights() {
  return useQuery({
    queryKey: ak.insights,
    queryFn: async () => (await assistantApi.insights()).data,
    staleTime: 120_000,
    retry: 0,
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ak.suggestions,
    queryFn: async () => (await assistantApi.suggestions()).data,
    staleTime: 300_000,
    retry: 0,
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assistantApi.dismiss(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ak.suggestions });
      qc.invalidateQueries({ queryKey: ak.insights });
    },
  });
}

export function useTasks(status: "open" | "done" | "all" = "open") {
  return useQuery({ queryKey: ak.tasks(status), queryFn: async () => (await assistantApi.tasks(status)).data });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["assistant", "tasks"] });
    qc.invalidateQueries({ queryKey: ak.insights });
  };
  return {
    create: useMutation({ mutationFn: assistantApi.createTask, onSuccess: refresh }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: Parameters<typeof assistantApi.updateTask>[1] }) =>
        assistantApi.updateTask(v.id, v.patch),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => assistantApi.deleteTask(id), onSuccess: refresh }),
  };
}

export type { Task };

export function useMemoryOverview() {
  return useQuery({ queryKey: ak.memory, queryFn: assistantApi.memory });
}

export function useMemoryMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ak.memory });
    qc.invalidateQueries({ queryKey: ak.insights });
    qc.invalidateQueries({ queryKey: ["assistant", "mail"] });
    qc.invalidateQueries({ queryKey: ak.briefing });
  };
  return {
    setPreference: useMutation({
      mutationFn: (v: { key: string; value: string | boolean }) => assistantApi.setPreference(v.key, v.value),
      onSuccess: refresh,
    }),
    add: useMutation({
      mutationFn: (v: { kind: "sender" | "note"; value: string; label?: string }) =>
        assistantApi.addMemory(v.kind, v.value, v.label),
      onSuccess: refresh,
    }),
    edit: useMutation({
      mutationFn: (v: { id: string; value: string }) => assistantApi.editMemory(v.id, v.value),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => assistantApi.deleteMemory(id), onSuccess: refresh }),
    forget: useMutation({ mutationFn: (kind: string) => assistantApi.forget(kind), onSuccess: refresh }),
  };
}

/** True while demo mode is on: every screen shows the banner. */
export function useDemoMode(): boolean {
  const q = useMemoryOverview();
  return q.data?.preferences?.demo_mode === true;
}

export function usePrivacy() {
  return useQuery({ queryKey: ak.privacy, queryFn: assistantApi.privacy, staleTime: 60_000 });
}

export function useSecurity() {
  return useQuery({ queryKey: ak.security, queryFn: assistantApi.security, staleTime: 60_000 });
}

export function useSystemHealth() {
  return useQuery({ queryKey: ak.health, queryFn: assistantApi.health, staleTime: 30_000 });
}

export function useShowcase() {
  return useQuery({ queryKey: ak.showcase, queryFn: assistantApi.showcase, staleTime: Infinity });
}

export function useN8nCenter() {
  return useQuery({ queryKey: ak.n8n, queryFn: observabilityApi.n8nCenter, staleTime: 20_000, retry: 0 });
}

export function useDependencies(key: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ak.deps(key ?? ""),
    queryFn: () => integrationsApi.dependencies(key as string),
    enabled: !!key && enabled,
    staleTime: 0,
  });
}

export type { MailAction, Tone };


/** The "Today" numbers: mail, events, deadlines. No AI call, cached for two minutes. */
export function useTodaySnapshot() {
  return useQuery({
    queryKey: ["assistant", "briefing", "lite"],
    queryFn: () => assistantApi.briefing(false),
    staleTime: 120_000,
    retry: 0,
  });
}


export function useCalendar(days = 7) {
  return useQuery({ queryKey: ["assistant", "calendar", days], queryFn: () => assistantApi.calendar(days), staleTime: 60_000, retry: 0 });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assistantApi.createEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assistant", "calendar"] });
      qc.invalidateQueries({ queryKey: ["assistant", "briefing"] });
    },
  });
}
