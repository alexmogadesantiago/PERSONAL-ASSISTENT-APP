/**
 * The snapshot the assistant reasons over.
 *
 * Every line comes from an endpoint the signed-in user can already read:
 * /api/health, /api/system/status, /api/n8n/*, /api/ai/health, /api/ai/config,
 * /api/profiles/completeness. Nothing is fetched specially for the model, and
 * nothing secret is included - the AI configuration contributes provider, model
 * and status, never a key or a hint of one.
 */
import type {
  AiConfig,
  AiHealth,
  HealthResponse,
  N8nExecution,
  ProfileCompleteness,
  SystemStatus,
  User,
} from "@/api/types";
import type { AutomationView } from "@/features/automations/catalog";

export interface AssistantContextInput {
  user: User | null;
  health: HealthResponse | undefined;
  status: SystemStatus | undefined;
  automations: AutomationView[];
  executions: N8nExecution[];
  n8nState: string;
  aiHealth: AiHealth | undefined;
  aiConfig: AiConfig | undefined;
  profile: ProfileCompleteness | undefined;
  workflowNames: Map<string, string>;
}

const MAX_EXECUTIONS = 20;

function line(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value === null || value === undefined || value === "" ? "unknown" : value}`;
}

function isoOrDash(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "unknown";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

/** Build the plain-text context block sent as a system message. */
export function buildContext(input: AssistantContextInput): string {
  const {
    user,
    health,
    status,
    automations,
    executions,
    n8nState,
    aiHealth,
    aiConfig,
    profile,
    workflowNames,
  } = input;

  const parts: string[] = [];
  const now = new Date();

  parts.push(
    [
      "SYSTEM CONTEXT",
      line("snapshot taken at", now.toISOString()),
      line("local time for the user", now.toLocaleString()),
      line("signed-in user", user ? `${user.username} (role: ${user.role})` : "unknown"),
    ].join("\n"),
  );

  parts.push(
    [
      "PLATFORM",
      line("backend status", health?.status),
      line("version", health?.version),
      line("environment", health?.environment),
      line("database", health?.database),
      line(
        "configuration warnings",
        health?.problems?.length ? health.problems.join("; ") : "none",
      ),
    ].join("\n"),
  );

  if (status) {
    const rows = status.services.map((s) => {
      const latency = s.latency_ms != null ? `, ${s.latency_ms} ms` : "";
      const detail = s.detail ? ` - ${s.detail}` : "";
      return `- ${s.name}: ${s.status}${latency}${detail}`;
    });
    parts.push(
      [
        "SERVICES",
        line("overall", status.operational ? "all systems operational" : "degraded"),
        line("last probed", isoOrDash(status.checked_at)),
        ...rows,
      ].join("\n"),
    );
  } else {
    parts.push("SERVICES\nthe service probe did not answer for this snapshot");
  }

  const automationRows = automations.map((a) => {
    if (!a.workflow) {
      return `- ${a.blueprint.label}: not deployed in n8n (no workflow matches this name)`;
    }
    const bits = [
      `id=${a.workflow.id}`,
      a.workflow.active ? "active" : "inactive",
      a.schedule ? `schedule: ${a.schedule}` : "schedule: not exposed by n8n",
      `runs in recent history: ${a.stats.runs}`,
      a.stats.successRate != null ? `success rate: ${a.stats.successRate}%` : "success rate: unknown",
      a.stats.lastRunAt ? `last run: ${isoOrDash(a.stats.lastRunAt)} (${a.stats.lastStatus ?? "unknown"})` : "last run: none recorded",
    ];
    // The n8n name is included as well as the label: the owner may refer to
    // either, and the model cannot guess a name it was never shown.
    const named =
      a.workflow.name && a.workflow.name !== a.blueprint.label
        ? `${a.blueprint.label} (workflow "${a.workflow.name}")`
        : a.blueprint.label;
    return `- ${named}: ${bits.join(", ")}`;
  });
  parts.push(["AUTOMATIONS", line("n8n integration", n8nState), ...automationRows].join("\n"));

  const recent = executions.slice(0, MAX_EXECUTIONS).map((e) => {
    const name = workflowNames.get(String(e.workflowId ?? "")) ?? `workflow ${e.workflowId ?? "?"}`;
    const stopped = e.stoppedAt ? `, finished ${isoOrDash(e.stoppedAt)}` : "";
    return `- ${name}: ${e.status ?? "unknown"}, started ${isoOrDash(e.startedAt)}${stopped}`;
  });
  parts.push(
    [
      "RECENT EXECUTIONS",
      recent.length
        ? `the ${recent.length} most recent runs n8n reports:`
        : "n8n reports no executions in the queried window",
      ...recent,
    ].join("\n"),
  );

  parts.push(
    [
      "ARTIFICIAL INTELLIGENCE",
      line("status", aiHealth?.status),
      line("detail", aiHealth?.detail),
      line("provider", aiConfig?.provider || aiHealth?.provider),
      line("model", aiConfig?.model || aiHealth?.model),
      line(
        "fallback",
        aiConfig?.fallback_enabled
          ? `${aiConfig.effective_fallback_provider || "none configured"} (${aiHealth?.fallback_status ?? "unknown"})`
          : "disabled",
      ),
      aiHealth?.last_fallback
        ? line(
            "last fallback used",
            `${aiHealth.last_fallback.primary} -> ${aiHealth.last_fallback.fallback} (${aiHealth.last_fallback.reason})`,
          )
        : line("last fallback used", "none recently"),
    ].join("\n"),
  );

  if (profile) {
    parts.push(
      [
        "USER PROFILE",
        line("configured", profile.configured ? "yes" : "no"),
        line("profiles stored", profile.profile_count),
        line("detail", profile.detail),
        line(
          "missing fields in the best profile",
          profile.best?.missing?.length ? profile.best.missing.join(", ") : "none",
        ),
      ].join("\n"),
    );
  }

  parts.push(
    [
      "WHAT THIS PANEL CANNOT SHOW YOU",
      "- the contents produced by an automation (articles, job offers, drafts) are NOT in this block.",
      "  They are fetched on demand and arrive in a separate block titled",
      "  \"RESULTADOS REALES DE LAS AUTOMATIZACIONES\". If that block is absent, you do not have them:",
      "  say so and invite the user to ask about correos, ofertas, noticias or marca personal.",
      "- the body of an email. Only sender, subject and date are ever read.",
      "- anything older than the executions listed above.",
      "- credentials, API keys or tokens of any kind.",
    ].join("\n"),
  );

  return parts.join("\n\n");
}
