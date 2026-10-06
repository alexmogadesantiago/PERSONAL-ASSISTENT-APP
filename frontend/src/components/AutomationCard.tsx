/**
 * One automation, as the operations view shows it.
 *
 * Every figure comes from n8n: the workflow's own active flag, and the run
 * history behind `/api/n8n/executions`. Where n8n tells us nothing - a workflow
 * with no schedule node, a blueprint with no deployed workflow - the card says
 * so in words instead of filling the slot with a plausible number.
 */
import { Link } from "react-router-dom";
import type { AutomationView } from "@/features/automations/catalog";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { relativeTime } from "@/utils/format";

function Figure({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className={muted ? "truncate text-sm text-muted" : "truncate text-sm font-medium text-fg"}>{value}</p>
    </div>
  );
}

export function AutomationCard({
  view,
  onRun,
  running,
}: {
  view: AutomationView;
  onRun?: (workflowId: string, label: string) => void;
  running?: boolean;
}) {
  const { blueprint, workflow, stats, schedule } = view;

  if (!workflow) {
    return (
      <article className="card p-4 opacity-80">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-fg">{blueprint.label}</h3>
            <p className="mt-0.5 text-xs text-muted">{blueprint.description}</p>
          </div>
          <StatusBadge tone="idle">Not deployed</StatusBadge>
        </div>
        <p className="mt-4 text-xs text-muted">
          No workflow in n8n matches this name. Import or rename it in n8n and it appears here.
        </p>
      </article>
    );
  }

  const lastFailed = (stats.lastStatus ?? "").toLowerCase();
  const failing = lastFailed === "error" || lastFailed === "failed" || lastFailed === "crashed";

  return (
    <article className="card-interactive p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{blueprint.label}</h3>
          <p className="mt-0.5 truncate text-xs text-muted">{blueprint.description}</p>
        </div>
        <StatusBadge tone={workflow.active ? (failing ? "warn" : "ok") : "idle"}>
          {workflow.active ? (failing ? "Last run failed" : "Active") : "Inactive"}
        </StatusBadge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          label="Last run"
          value={stats.lastRunAt ? relativeTime(stats.lastRunAt) : "No runs recorded"}
          muted={!stats.lastRunAt}
        />
        <Figure label="Next run" value={schedule ?? "Not scheduled in n8n"} muted={!schedule} />
        <Figure label="Runs" value={stats.runs > 0 ? String(stats.runs) : "—"} muted={stats.runs === 0} />
        <Figure
          label="Success rate"
          value={stats.successRate != null ? `${stats.successRate}%` : "Not enough history"}
          muted={stats.successRate == null}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to={`/automations/${workflow.id}`}>
          <Button size="sm" variant="outline">
            View details
          </Button>
        </Link>
        {onRun && (
          <Button
            size="sm"
            variant="ghost"
            loading={running}
            onClick={() => onRun(workflow.id, blueprint.label)}
          >
            Run now
          </Button>
        )}
        <Link
          to={`/activity?workflow_id=${workflow.id}`}
          className="ml-auto text-xs text-muted transition-colors hover:text-fg"
        >
          Activity →
        </Link>
      </div>
    </article>
  );
}
