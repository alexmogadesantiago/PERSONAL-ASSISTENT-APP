/**
 * One run as a timeline: when each step happened, what it did, how long it took
 * and - if it failed - exactly where, why, and whether retrying can help.
 *
 * "Retry" is never blind. The backend says whether the failure is temporary (a
 * timeout, a rate limit) or needs you first (an expired sign-in, a missing
 * setting); the card shows the cause and the right button for each case.
 * Only step names, counts and durations are shown - never the data in a step,
 * so nothing sensitive can leak through this view.
 */
import type { RunDetail } from "@/api/platform";
import { Button, ButtonLink, Skeleton } from "@/components/ui";
import { IAlert, ICheck, IX } from "@/components/icons2";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";
import { formatMs } from "./ActivityList";

function clock(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function ExecutionView({ detail, loading, onRetry, retrying }: { detail?: RunDetail; loading?: boolean; onRetry?: () => void; retrying?: boolean }) {
  if (loading || !detail) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the run">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const ok = detail.status === "success";
  const failed = detail.status === "error";
  const failedStep = detail.steps.find((s) => s.status === "error");
  const advice = detail.retry_advice;
  return (
    <div className="space-y-5">
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border p-4",
          ok && "border-ok/30 bg-ok/[0.06]",
          failed && "border-danger/30 bg-danger/[0.06]",
          !ok && !failed && "border-info/30 bg-info/[0.06]",
        )}
      >
        <span className={cn("grid h-10 w-10 place-items-center rounded-full", ok ? "bg-ok/20 text-ok" : failed ? "bg-danger/20 text-danger" : "bg-info/20 text-info")}>
          {ok ? <ICheck /> : failed ? <IX /> : <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-info" />}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-fg">{ok ? "Completed" : failed ? "Failed" : "Running"}</p>
          <p className="text-xs text-muted">
            {formatDateTime(detail.started_at)}
            {detail.mode ? ` · ${detail.mode === "trigger" ? "scheduled" : detail.mode}` : ""}
          </p>
        </div>
        {detail.duration_ms != null && (
          <div className="text-right">
            <p className="text-xs text-muted">Duration</p>
            <p className="text-sm font-semibold tabular-nums text-fg">{formatMs(detail.duration_ms)}</p>
          </div>
        )}
      </div>

      {failed && (detail.diagnosis || failedStep) && (
        <div className="rounded-2xl border border-danger/25 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <IAlert className="text-danger" width={16} height={16} />
            {detail.diagnosis?.title ?? `Failed at “${failedStep?.label}”`}
          </div>
          {advice ? (
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-subtle">What happened</dt>
                <dd className="text-fg">{advice.cause}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-subtle">Suggested action</dt>
                <dd className="text-fg">{advice.suggestion}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-1 text-sm text-muted">{detail.diagnosis?.explanation ?? failedStep?.error}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(advice?.action ?? detail.diagnosis?.action) && (
              <ButtonLink to={(advice?.action ?? detail.diagnosis!.action).href} variant="primary" size="sm">
                {(advice?.action ?? detail.diagnosis!.action).label}
              </ButtonLink>
            )}
            {onRetry && (
              <Button size="sm" variant={advice && !advice.retry ? "ghost" : "secondary"} onClick={onRetry} loading={retrying}>
                {advice && !advice.retry ? "Retry anyway" : "Retry"}
              </Button>
            )}
          </div>
        </div>
      )}

      <ol className="relative" aria-label="Steps">
        {detail.steps.map((s, i) => (
          <li key={`${s.node}-${i}`} className="relative flex gap-3 pb-4">
            <span className="mt-1 w-[60px] shrink-0 text-right text-[11px] tabular-nums text-subtle">{clock(s.at)}</span>
            <span className="absolute left-[72px] top-7 h-[calc(100%-20px)] w-px bg-border" aria-hidden="true" />
            <span
              className={cn(
                "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                s.status === "success" && "bg-ok/15 text-ok ring-ok/30",
                s.status === "error" && "bg-danger/15 text-danger ring-danger/30",
                s.status === "skipped" && "bg-surface-2 text-subtle ring-border",
              )}
            >
              {s.status === "success" ? <ICheck width={13} height={13} /> : s.status === "error" ? <IX width={13} height={13} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("text-sm", s.status === "skipped" ? "text-subtle" : "text-fg")}>{s.label}</p>
                <span className="shrink-0 text-xs tabular-nums text-subtle">{formatMs(s.duration_ms)}</span>
              </div>
              <p className="text-xs text-muted">
                {s.status === "skipped" ? "Not reached" : s.status === "error" ? s.error : `${s.items} item${s.items === 1 ? "" : "s"}`}
              </p>
            </div>
          </li>
        ))}
        {detail.steps.length > 0 && !ok && !failed ? null : detail.steps.length > 0 && (
          <li className="relative flex gap-3">
            <span className="mt-1 w-[60px] shrink-0 text-right text-[11px] tabular-nums text-subtle">{clock(detail.finished_at)}</span>
            <span className={cn("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset", ok ? "bg-ok/15 text-ok ring-ok/30" : "bg-danger/15 text-danger ring-danger/30")}>
              {ok ? <ICheck width={13} height={13} /> : <IX width={13} height={13} />}
            </span>
            <p className="pt-1 text-sm text-fg">{ok ? "Automation completed" : "Automation stopped"}</p>
          </li>
        )}
        {detail.steps.length === 0 && <p className="text-sm text-muted">No step details were recorded for this run.</p>}
      </ol>
    </div>
  );
}
