/**
 * Error Center. Nothing is hidden: every failure, grouped, with how often it
 * happens, what it affects, a plain-language explanation and the action that
 * fixes it. The assistant can explain any of them in more detail.
 */
import { useNavigate } from "react-router-dom";
import type { ErrorGroup } from "@/api/platform";
import { useErrorCenter, useResolveError } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { QueryBoundary, errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { IAlert, ICheck, ISparkles } from "@/components/icons2";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const SEVERITY: Record<ErrorGroup["severity"], { label: string; tone: "danger" | "warning" | "info" | "neutral"; bar: string }> = {
  critical: { label: "Critical", tone: "danger", bar: "bg-danger" },
  high: { label: "High", tone: "warning", bar: "bg-warn" },
  medium: { label: "Medium", tone: "info", bar: "bg-info" },
  low: { label: "Low", tone: "neutral", bar: "bg-subtle" },
};

function ErrorCard({ e }: { e: ErrorGroup }) {
  const resolve = useResolveError();
  const toast = useToast();
  const navigate = useNavigate();
  const sev = SEVERITY[e.severity];
  const ask = `Explain this error in my automations and how to fix it: "${e.title}". Details: ${e.message || e.explanation}${e.automation ? ` (automation: ${e.automation})` : ""}`;
  return (
    <article className="card relative overflow-hidden p-5 pl-6">
      <span className={cn("absolute inset-y-0 left-0 w-1", sev.bar)} aria-hidden="true" />
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={sev.tone} dot>
              {sev.label}
            </Badge>
            {e.count > 1 && <Badge>×{e.count}</Badge>}
            {e.service && <span className="text-xs text-muted">{e.service}</span>}
          </div>
          <h3 className="mt-2 text-[15px] font-semibold tracking-tight text-fg">{e.title}</h3>
          <p className="mt-1 text-sm text-muted">{e.explanation}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-subtle">Cause</dt>
              <dd className="text-fg">{e.cause || e.explanation}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-subtle">Impact</dt>
              <dd className="text-fg">
                {e.impact && (e.impact.automations > 0 || e.impact.features.length > 0) ? (
                  <>
                    {e.impact.automations > 0 && (
                      <span className="block">
                        {e.impact.automations} automation{e.impact.automations === 1 ? "" : "s"} affected
                      </span>
                    )}
                    {e.impact.features.length > 0 && <span className="block text-xs text-muted">{e.impact.features.slice(0, 3).join(" · ")}</span>}
                  </>
                ) : e.automation ? (
                  <>Affects {e.automation}</>
                ) : (
                  "No automation is affected"
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-subtle">Recommended</dt>
              <dd className="text-fg">{e.action.label}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-subtle">
            Last seen {relativeTime(e.last_seen)}
            {e.count > 1 && <> · first seen {relativeTime(e.first_seen)}</>}
          </p>
          {e.message && e.message !== e.explanation && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-subtle">Technical details</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2 text-[11px] text-muted">{e.message}</pre>
            </details>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-stretch">
          <ButtonLink to={e.action.href} variant="primary" size="sm">
            {e.action.label}
          </ButtonLink>
          <Button variant="subtle" size="sm" icon={<ISparkles width={14} height={14} />} onClick={() => navigate(`/assistant?q=${encodeURIComponent(ask)}`)}>
            Explain with AI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={resolve.isPending && resolve.variables === e.id}
            onClick={async () => {
              try {
                await resolve.mutateAsync(e.id);
                toast.success("Marked as resolved", "It reappears if it happens again.");
              } catch (err) {
                toast.error("Could not update", errorMessage(err));
              }
            }}
          >
            Mark resolved
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ErrorsPage() {
  const q = useErrorCenter();
  const counts = q.data?.counts;
  return (
    <div>
      <PageHeader
        eyebrow="Errors"
        title="What needs fixing"
        description="Failures are grouped, explained and ranked. Fix the critical ones first - most are a connection to renew."
      />
      {counts && q.data!.data.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {(Object.keys(SEVERITY) as ErrorGroup["severity"][]).map((s) =>
            counts[s] ? (
              <Badge key={s} tone={SEVERITY[s].tone} dot>
                {counts[s]} {SEVERITY[s].label.toLowerCase()}
              </Badge>
            ) : null,
          )}
        </div>
      )}
      <QueryBoundary isLoading={false} isError={q.isError} error={q.error} onRetry={() => q.refetch()}>
        {q.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : q.data!.data.length === 0 ? (
          <EmptyState
            icon={<ICheck />}
            title="No errors"
            description="Everything ran cleanly. If something fails, it shows up here with the fix."
          />
        ) : (
          <div className="stagger space-y-3">
            {q.data!.data.map((e) => (
              <ErrorCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </QueryBoundary>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-subtle">
        <IAlert width={13} height={13} /> Failures from every automation are reported here automatically.
      </p>
    </div>
  );
}
