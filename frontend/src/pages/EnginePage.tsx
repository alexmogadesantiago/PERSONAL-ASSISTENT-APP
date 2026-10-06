/**
 * Automation engine (n8n) control center.
 *
 * The user should never need to open n8n to know whether it is working:
 * workflows, which are active, how many ran today, how many failed, the success
 * rate and the last execution - each workflow with its own health.
 */
import { Link } from "react-router-dom";
import { useN8nCenter } from "@/hooks/platform";
import { Badge, Button, ButtonLink, Card, CardTitle, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui";
import { IAlert, IBolt, IClock, IActivity, ICheck } from "@/components/icons2";
import { formatMs } from "@/features/activity/ActivityList";
import { N8N_URL } from "@/config";
import { relativeTime } from "@/utils/format";

function rateTone(rate: number | null): "success" | "warning" | "danger" | "neutral" {
  if (rate == null) return "neutral";
  return rate >= 95 ? "success" : rate >= 80 ? "warning" : "danger";
}

export function EnginePage() {
  const q = useN8nCenter();
  const d = q.data;
  const t = d?.totals;
  const state = !d ? "checking" : d.available ? (d.state === "operational" ? "Operational" : "Degraded") : "Unavailable";
  return (
    <div>
      <PageHeader
        eyebrow="Automation engine"
        title="n8n, without opening n8n"
        description="The engine that runs your automations in the background: what is installed, what ran and how it went."
        back={{ to: "/automations", label: "Automations" }}
        actions={
          <>
            <Button variant="ghost" loading={q.isFetching} onClick={() => q.refetch()}>
              Refresh
            </Button>
            {N8N_URL && (
              <ButtonLink to={N8N_URL} variant="secondary" size="md">
                Open n8n editor
              </ButtonLink>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Loading the automation engine">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState icon={<IAlert />} title="The engine status could not be read" description="The backend did not answer. Your saved automations are safe." action={<Button onClick={() => q.refetch()}>Try again</Button>} />
      ) : !d?.available ? (
        <EmptyState
          icon={<IAlert />}
          title={d?.state === "not_configured" ? "n8n is not connected" : "n8n unavailable"}
          description={d?.message ?? "Your saved automations are safe. Some actions are temporarily unavailable."}
          action={<ButtonLink to="/settings/automations" variant="primary">Open engine settings</ButtonLink>}
        />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <Badge tone={state === "Operational" ? "success" : "warning"} dot>
              {state}
            </Badge>
            {t?.last_execution && (
              <span className="text-xs text-muted">
                Last execution {relativeTime(t.last_execution.at)} · {t.last_execution.workflow} ·{" "}
                <Link className="text-brand hover:underline" to={`/executions/${t.last_execution.id}`}>
                  {t.last_execution.status}
                </Link>
              </span>
            )}
          </div>
          <section className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Workflows" value={t?.workflows ?? "–"} hint={`${t?.active ?? 0} active`} icon={<IBolt width={15} height={15} />} tone="brand" />
            <Stat label="Executions today" value={t?.executions_today ?? 0} icon={<IActivity width={15} height={15} />} />
            <Stat label="Failed today" value={t?.failed_today ?? 0} icon={<IAlert width={15} height={15} />} tone={t?.failed_today ? "danger" : "ok"} to="/errors" />
            <Stat label="Success · today" value={t?.success_rate_today != null ? `${t.success_rate_today}%` : "—"} hint={t?.success_rate_today == null ? "no runs yet" : undefined} icon={<ICheck width={15} height={15} />} tone="ok" />
            <Stat label="Success · 7 days" value={t?.success_rate_7d != null ? `${t.success_rate_7d}%` : "—"} icon={<IClock width={15} height={15} />} />
          </section>

          <Card padded={false}>
            <div className="p-4 pb-0 md:p-5 md:pb-0">
              <CardTitle description="Each workflow's last seven days.">Workflows</CardTitle>
            </div>
            {d.workflows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No workflows yet" description="Create your first automation and it will appear here." action={<ButtonLink to="/automations/new" variant="primary">Create automation</ButtonLink>} />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {d.workflows.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate text-sm font-medium text-fg">
                        {w.automation_id ? <Link to={`/automations/${w.automation_id}`} className="hover:underline">{w.name}</Link> : w.name}
                      </p>
                      <p className="text-xs text-muted">
                        {w.kind === "custom" ? "Built by you" : w.kind === "error_handler" ? "Failure reporting" : "Built-in assistant"} ·{" "}
                        {w.active ? "active" : "paused"}
                      </p>
                    </div>
                    <Badge tone={rateTone(w.success_rate_7d)} dot>
                      {w.success_rate_7d != null ? `${w.success_rate_7d}% success` : "no runs"}
                    </Badge>
                    <span className="w-20 text-xs tabular-nums text-muted">{w.runs_7d} runs</span>
                    <span className="w-24 text-xs tabular-nums text-muted">{w.avg_duration_ms != null ? `avg ${formatMs(w.avg_duration_ms)}` : "—"}</span>
                    <span className="w-28 text-xs text-muted">{w.last_run_at ? relativeTime(w.last_run_at) : "never run"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
