/**
 * One place that gathers the live picture of this installation.
 *
 * The dashboard renders it as cards; the assistant sends it to the model as
 * context. Sharing the source means the sentence the AI writes and the numbers
 * on screen cannot disagree - and it reuses the existing queries, so no extra
 * requests are made for the chat.
 */
import { useCallback, useMemo } from "react";
import { useAuth } from "@/stores/auth";
import {
  n8nStateOf,
  useAiConfig,
  useAiHealth,
  useExecutions,
  useHealth,
  useN8nHealth,
  useProfileCompleteness,
  useSystemStatus,
  useWorkflows,
} from "@/hooks/queries";
import { useCustomAutomations, useErrorCenter, useIntegrations } from "@/hooks/platform";
import { buildAutomationViews } from "@/features/automations/catalog";
import { buildContext } from "./context";
import type { Automation, ErrorGroup, Integration } from "@/api/platform";

/**
 * The product layer the model also needs to know about: connections and their
 * health, open errors with their diagnosis, and the automations built in the
 * panel. Labels and states only - no token, hint or account secret.
 */
export function productContext(integrations: Integration[], errors: ErrorGroup[], custom: Automation[]): string {
  const lines: string[] = ["", "INTEGRATIONS"];
  for (const i of integrations) {
    const who = i.connection?.account?.email || i.connection?.account?.login || "";
    lines.push(
      `- ${i.label}: ${i.connected ? i.status : "not connected"}` +
        (who ? ` (signed in as ${who})` : "") +
        (i.connection ? `; allowed: ${i.connection.services.join(", ") || "none"}` : "") +
        (i.connection?.health_detail ? `; detail: ${i.connection.health_detail}` : ""),
    );
  }
  lines.push("", `OPEN ERRORS (${errors.length})`);
  for (const e of errors.slice(0, 8)) {
    lines.push(`- [${e.severity}] ${e.title}${e.automation ? ` in "${e.automation}"` : ""}, x${e.count}, last ${e.last_seen ?? "unknown"}. Fix: ${e.action.label} (${e.action.href}). ${e.explanation}`);
  }
  lines.push("", `AUTOMATIONS BUILT IN THE PANEL (${custom.length})`);
  for (const a of custom) {
    lines.push(`- "${a.name}" (${a.active ? "active" : "paused"}), uses ${a.providers.join(", ") || "AI only"}${a.last_error ? `; last error: ${a.last_error.message}` : ""}`);
  }
  lines.push(
    "",
    "When the user wants a NEW automation, tell them to describe it on the Automations > New page " +
      "(it drafts it with AI). When a connection is expired, point them to Integrations to reconnect.",
  );
  return lines.join("\n");
}

/** How much run history the snapshot carries. */
const EXECUTION_WINDOW = 60;

export function useSystemSnapshot() {
  const { user } = useAuth();
  const health = useHealth();
  const status = useSystemStatus();
  const workflows = useWorkflows();
  const executions = useExecutions({ limit: EXECUTION_WINDOW });
  const n8n = useN8nHealth();
  const aiHealth = useAiHealth();
  const aiConfig = useAiConfig();
  const profile = useProfileCompleteness();
  const integrations = useIntegrations();
  const errors = useErrorCenter();
  const custom = useCustomAutomations();

  const n8nState = n8nStateOf(n8n.data, n8n.isError);
  const workflowList = useMemo(() => workflows.data?.data ?? [], [workflows.data]);
  const executionList = useMemo(() => executions.data?.data ?? [], [executions.data]);

  const workflowNames = useMemo(
    () => new Map(workflowList.map((w) => [String(w.id), w.name])),
    [workflowList],
  );

  const automations = useMemo(
    () => buildAutomationViews(workflowList, executionList),
    [workflowList, executionList],
  );

  /**
   * Built on demand rather than memoised into a string: a request that goes out
   * now should describe the system now.
   */
  const getContext = useCallback(
    () =>
      buildContext({
        user,
        health: health.data,
        status: status.data,
        automations,
        executions: executionList,
        n8nState,
        aiHealth: aiHealth.data,
        aiConfig: aiConfig.data,
        profile: profile.data,
        workflowNames,
      }) + productContext(integrations.data?.data ?? [], errors.data?.data ?? [], custom.data ?? []),
    [
      integrations.data,
      errors.data,
      custom.data,
      user,
      health.data,
      status.data,
      automations,
      executionList,
      n8nState,
      aiHealth.data,
      aiConfig.data,
      profile.data,
      workflowNames,
    ],
  );

  /**
   * Whether it is worth sending anything at all. We only refuse when the
   * backend has positively said no provider is configured - an unknown health
   * state is not a reason to block the user from trying.
   */
  const aiReady = aiConfig.data ? aiConfig.data.configured : aiHealth.data?.status !== "not_configured";

  /**
   * Enough of the picture has arrived to describe the system. Deliberately
   * based on the platform queries only: n8n may be unreachable and retrying for
   * a while, and "no automations" is itself a fact worth reporting rather than
   * a reason to keep the user waiting.
   */
  const contextReady = !health.isLoading && !status.isLoading;

  return {
    user,
    health,
    status,
    workflows,
    executions,
    executionList,
    workflowList,
    workflowNames,
    automations,
    n8n,
    n8nState,
    aiHealth,
    aiConfig,
    profile,
    getContext,
    aiReady,
    contextReady,
  };
}
