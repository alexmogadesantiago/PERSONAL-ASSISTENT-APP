/**
 * An automation's health in one glance: ● Healthy · success rate · runs ·
 * last run · average duration. "No runs yet" is shown as such - a rate is never
 * invented when nothing has run.
 */
import { Badge } from "@/components/ui";
import { formatMs } from "@/features/activity/ActivityList";
import { relativeTime } from "@/utils/format";

export interface HealthStats {
  successRate: number | null;
  runs: number;
  failed?: number;
  lastRunAt: string | null;
  avgDurationMs?: number | null;
}

export function healthOf(s: HealthStats): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (s.runs === 0 || s.successRate == null) return { label: "No runs yet", tone: "neutral" };
  if (s.successRate >= 95) return { label: "Healthy", tone: "success" };
  if (s.successRate >= 80) return { label: "Degraded", tone: "warning" };
  return { label: "Failing", tone: "danger" };
}

export function AutomationHealth({ stats, period = "7 days" }: { stats: HealthStats; period?: string }) {
  const h = healthOf(stats);
  return (
    <div className="mt-4 border-t border-border pt-3" aria-label="Health">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={h.tone} dot>{h.label}</Badge>
        <span className="text-[11px] text-subtle">last {period}</span>
      </div>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div>
          <dt className="text-subtle">Success</dt>
          <dd className="tabular-nums text-fg">{stats.successRate != null ? `${stats.successRate}%` : "—"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Runs</dt>
          <dd className="tabular-nums text-fg">{stats.runs}</dd>
        </div>
        <div>
          <dt className="text-subtle">Last run</dt>
          <dd className="truncate text-fg">{stats.lastRunAt ? relativeTime(stats.lastRunAt) : "never"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Avg time</dt>
          <dd className="tabular-nums text-fg">{stats.avgDurationMs != null ? formatMs(stats.avgDurationMs) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
