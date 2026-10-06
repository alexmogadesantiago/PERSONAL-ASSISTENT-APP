/**
 * The four automations this assistant is built around, resolved against the
 * workflows n8n actually reports.
 *
 * Nothing here invents a workflow: a blueprint with no match is rendered as
 * "not deployed" rather than as a card with plausible-looking numbers. Every
 * statistic below is derived from `/api/n8n/executions`, which is the only
 * place the platform keeps run history.
 */
import type { N8nExecution, N8nWorkflow } from "@/api/types";

export type AutomationKey = "agenda" | "laboral" | "noticias" | "marca-personal";

export interface AutomationBlueprint {
  key: AutomationKey;
  label: string;
  description: string;
  /** Lowercase fragments that identify this automation in a workflow name. */
  aliases: string[];
}

export const AUTOMATION_BLUEPRINTS: AutomationBlueprint[] = [
  {
    key: "agenda",
    label: "Agenda",
    description: "Calendar and daily planning.",
    aliases: ["agenda", "calendar", "calendario"],
  },
  {
    key: "laboral",
    label: "Laboral",
    description: "Job opportunities, screened and ranked.",
    aliases: ["laboral", "job", "empleo", "trabajo", "career"],
  },
  {
    key: "noticias",
    label: "Noticias",
    description: "News monitoring and summaries.",
    aliases: ["noticia", "noticias", "news", "rss"],
  },
  {
    key: "marca-personal",
    label: "Marca Personal",
    description: "Personal brand and publishing.",
    aliases: ["marca", "brand", "personal brand", "linkedin", "social"],
  },
];

export interface ExecutionStats {
  runs: number;
  succeeded: number;
  failed: number;
  /** null when no finished run is known — never shown as 0 %. */
  successRate: number | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface AutomationView {
  blueprint: AutomationBlueprint;
  /** The n8n workflow backing it, or null when nothing matches. */
  workflow: N8nWorkflow | null;
  stats: ExecutionStats;
  /** Human description of the trigger schedule, when the workflow exposes one. */
  schedule: string | null;
}

const EMPTY_STATS: ExecutionStats = {
  runs: 0,
  succeeded: 0,
  failed: 0,
  successRate: null,
  lastRunAt: null,
  lastStatus: null,
};

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchWorkflow(
  blueprint: AutomationBlueprint,
  workflows: N8nWorkflow[],
): N8nWorkflow | null {
  const candidates = workflows.filter((w) => {
    const name = normalise(w.name ?? "");
    return blueprint.aliases.some((alias) => name.includes(normalise(alias)));
  });
  if (candidates.length === 0) return null;
  // An active workflow is the better representative when a name matches twice
  // (a "Noticias" and a "Noticias (old)", say).
  return candidates.find((w) => w.active) ?? candidates[0];
}

const SUCCESS = new Set(["success", "succeeded", "ok"]);
const FAILURE = new Set(["error", "failed", "crashed", "canceled", "cancelled"]);

export function statsFor(workflowId: string | undefined, executions: N8nExecution[]): ExecutionStats {
  if (!workflowId) return EMPTY_STATS;
  const mine = executions.filter((e) => String(e.workflowId ?? "") === String(workflowId));
  if (mine.length === 0) return EMPTY_STATS;

  let succeeded = 0;
  let failed = 0;
  for (const e of mine) {
    const status = String(e.status ?? "").toLowerCase();
    if (SUCCESS.has(status)) succeeded += 1;
    else if (FAILURE.has(status)) failed += 1;
  }
  const finished = succeeded + failed;
  const latest = [...mine].sort((a, b) => timeOf(b.startedAt) - timeOf(a.startedAt))[0];

  return {
    runs: mine.length,
    succeeded,
    failed,
    successRate: finished > 0 ? Math.round((succeeded / finished) * 100) : null,
    lastRunAt: (latest?.startedAt as string | undefined) ?? null,
    lastStatus: (latest?.status as string | undefined) ?? null,
  };
}

function timeOf(value: unknown): number {
  const t = new Date(String(value ?? "")).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Read the trigger schedule off the workflow definition when n8n includes the
 * nodes in its response. Returns null rather than a guess: "next run" is only
 * shown when the workflow really says so.
 */
export function describeSchedule(workflow: N8nWorkflow | null): string | null {
  const nodes = workflow?.nodes;
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    const type = String((node as Record<string, unknown>).type ?? "").toLowerCase();
    if (!type.includes("scheduletrigger") && !type.includes("cron") && !type.includes("interval")) {
      continue;
    }
    const params = ((node as Record<string, unknown>).parameters ?? {}) as Record<string, unknown>;
    const rule = (params.rule ?? {}) as Record<string, unknown>;
    const intervals = Array.isArray(rule.interval) ? (rule.interval as Record<string, unknown>[]) : [];
    const first = intervals[0] ?? (params as Record<string, unknown>);

    const expression = first?.cronExpression ?? params.cronExpression ?? params.expression;
    if (typeof expression === "string" && expression.trim()) return `cron ${expression.trim()}`;

    const field = String(first?.field ?? first?.triggerInterval ?? "").toLowerCase();
    const hour = first?.triggerAtHour ?? first?.hour;
    const minute = first?.triggerAtMinute ?? first?.minute ?? 0;
    if (field === "days" || field === "day") {
      if (hour != null) return `Daily at ${pad(hour)}:${pad(minute)}`;
      return "Daily";
    }
    if (field === "hours" || field === "hour") return "Hourly";
    if (field === "minutes" || field === "minute") return "Every few minutes";
    if (field === "weeks" || field === "week") return "Weekly";
    return "Scheduled";
  }
  return null;
}

function pad(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n).padStart(2, "0") : "00";
}

export function buildAutomationViews(
  workflows: N8nWorkflow[],
  executions: N8nExecution[],
): AutomationView[] {
  const views = AUTOMATION_BLUEPRINTS.map((blueprint) => {
    const workflow = matchWorkflow(blueprint, workflows);
    return {
      blueprint,
      workflow,
      stats: statsFor(workflow?.id, executions),
      schedule: describeSchedule(workflow),
    };
  });

  // Workflows that match no blueprint are still the user's automations; show
  // them rather than pretend the instance only runs these four.
  const claimed = new Set(views.map((v) => v.workflow?.id).filter(Boolean));
  const extras = workflows
    .filter((w) => !claimed.has(w.id))
    .map<AutomationView>((workflow) => ({
      blueprint: {
        key: "agenda",
        label: workflow.name,
        description: "Workflow deployed in n8n.",
        aliases: [],
      },
      workflow,
      stats: statsFor(workflow.id, executions),
      schedule: describeSchedule(workflow),
    }));

  // What exists comes first. A blueprint nobody deployed is still worth showing
  // - it tells the owner the automation is missing - but it must not push a
  // workflow that really runs off the end of a four-card dashboard.
  return [...views.filter((v) => v.workflow), ...extras, ...views.filter((v) => !v.workflow)];
}
