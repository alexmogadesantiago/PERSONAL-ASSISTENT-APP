/**
 * Execution history as a timeline.
 *
 * The rows are n8n executions, grouped by day and ordered newest first. n8n
 * reports when a run started, when it stopped and how it ended - not what it
 * produced - so the timeline shows exactly that. "312 opportunities processed"
 * would have to come from the workflow's own output, which this API does not
 * return; inventing it would be worse than omitting it.
 */
import { Link } from "react-router-dom";
import type { N8nExecution } from "@/api/types";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { formatDuration, formatTime } from "@/utils/format";

export interface TimelineEntry {
  execution: N8nExecution;
  workflowName: string;
}

function toneFor(status: string): StatusTone {
  const s = status.toLowerCase();
  if (s === "success" || s === "succeeded" || s === "ok") return "ok";
  if (s === "error" || s === "failed" || s === "crashed") return "danger";
  if (s === "running" || s === "waiting" || s === "new") return "brand";
  if (s === "canceled" || s === "cancelled") return "warn";
  return "idle";
}

function dayLabel(iso: string | undefined): string {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long" });
}

function durationOf(e: N8nExecution): number | null {
  const start = new Date(String(e.startedAt ?? "")).getTime();
  const stop = new Date(String(e.stoppedAt ?? "")).getTime();
  if (Number.isNaN(start) || Number.isNaN(stop)) return null;
  return Math.max(0, (stop - start) / 1000);
}

export function ActivityTimeline({ entries }: { entries: TimelineEntry[] }) {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const key = dayLabel(entry.execution.startedAt as string | undefined);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([day, rows]) => (
        <section key={day}>
          <p className="eyebrow mb-3">{day}</p>
          <ol className="relative space-y-0 border-l border-border pl-0">
            {rows.map(({ execution, workflowName }) => {
              const status = String(execution.status ?? "unknown");
              const seconds = durationOf(execution);
              return (
                <li key={String(execution.id)} className="relative flex gap-4 pb-5 pl-5 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-border"
                  />
                  <time className="w-12 shrink-0 pt-px font-mono text-xs tabular-nums text-muted">
                    {formatTime(execution.startedAt as string)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-fg">{workflowName}</p>
                      <StatusBadge tone={toneFor(status)}>{status}</StatusBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {seconds != null ? `Ran for ${formatDuration(seconds)}` : "Still running or interrupted"}
                      {execution.mode ? ` · triggered ${String(execution.mode)}` : ""}
                      {" · "}
                      <Link
                        to={`/executions?workflow_id=${String(execution.workflowId ?? "")}`}
                        className="text-muted underline decoration-border underline-offset-2 hover:text-fg"
                      >
                        run #{String(execution.id)}
                      </Link>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
