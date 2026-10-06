/**
 * One automation: its flow, its state, its runs.
 *
 * `/automations/:id`          built in the panel (full control)
 * `/automations/system/:id`   a system assistant (n8n workflow; toggle + history)
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { N8N_URL } from "@/config";
import type { RunSummary } from "@/api/platform";
import { useExecutions, useWorkflow, useWorkflowMutations } from "@/hooks/queries";
import {
  useAutomationMutations,
  useAutomationRun,
  useAutomationRuns,
  useBlockCatalog,
  useCustomAutomation,
  useExecutionDetail,
} from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { QueryBoundary, errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, Card, CardTitle, ConfirmDialog, Drawer, EmptyState, Menu, PageHeader, Switch } from "@/components/ui";
import { IActivity, IAlert, ICopy, IEdit, IExternal, IMore, IPlay, IRefresh, ITrash, ProviderMark } from "@/components/icons2";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { FlowPipeline, describeTrigger, specToFlow, workflowToFlow } from "@/features/automations/flow";
import { ExecutionView } from "@/features/activity/ExecutionView";
import { formatMs } from "@/features/activity/ActivityList";
import type { N8nExecution } from "@/api/types";

function RunsList({ runs, onOpen }: { runs: RunSummary[]; onOpen: (id: string) => void }) {
  if (!runs.length) return <EmptyState icon={<IActivity />} title="No runs yet" description="Runs appear here as soon as it starts working." />;
  return (
    <ul className="-mx-2 divide-y divide-border">
      {runs.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2/70">
            <span className={cn("h-2 w-2 rounded-full", r.status === "success" ? "bg-ok" : r.status === "error" ? "bg-danger" : "animate-pulse bg-info")} />
            <span className="flex-1 text-sm text-fg">{r.status === "success" ? "Succeeded" : r.status === "error" ? "Failed" : "Running"}</span>
            <span className="text-xs tabular-nums text-subtle">{formatMs(r.duration_ms)}</span>
            <span className="w-24 text-right text-xs text-muted">{relativeTime(r.started_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Stats({ runs }: { runs: RunSummary[] }) {
  const done = runs.filter((r) => r.status === "success" || r.status === "error");
  const ok = done.filter((r) => r.status === "success").length;
  const durations = runs.map((r) => r.duration_ms).filter((d): d is number => d != null);
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <div>
        <p className="text-xl font-semibold tabular-nums text-fg">{runs.length}</p>
        <p className="text-xs text-muted">recent runs</p>
      </div>
      <div>
        <p className={cn("text-xl font-semibold tabular-nums", done.length ? (ok / done.length >= 0.95 ? "text-ok" : "text-warn") : "text-fg")}>
          {done.length ? `${Math.round((ok / done.length) * 1000) / 10}%` : "—"}
        </p>
        <p className="text-xs text-muted">success</p>
      </div>
      <div>
        <p className="text-xl font-semibold tabular-nums text-fg">{durations.length ? formatMs(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)) : "—"}</p>
        <p className="text-xs text-muted">avg duration</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- custom */

export function AutomationDetailPage() {
  const { id = "" } = useParams();
  const q = useCustomAutomation(id);
  const runs = useAutomationRuns(id);
  const catalog = useBlockCatalog();
  const m = useAutomationMutations();
  const toast = useToast();
  const navigate = useNavigate();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = useAutomationRun(id, openRun ?? undefined);

  async function act(verb: "activate" | "pause" | "duplicate" | "run" | "redeploy") {
    try {
      const r = await m.act.mutateAsync({ id, verb });
      if (verb === "duplicate") navigate(`/automations/${r.id}`);
      toast.success(
        { activate: "Activated", pause: "Paused", duplicate: "Duplicated", run: "Started", redeploy: "Redeployed" }[verb],
        verb === "run" ? "It is running in the background; the run appears below in a moment." : undefined,
      );
      if (verb === "run") window.setTimeout(() => runs.refetch(), 2500);
    } catch (e) {
      toast.error("Could not do that", errorMessage(e));
    }
  }

  const a = q.data;
  const runStatuses: Record<string, "success" | "error" | "skipped"> = {};
  if (run.data && a) {
    const flow = specToFlow(a.spec, catalog.data ?? []);
    run.data.steps.forEach((s, i) => {
      const key = flow[i]?.key;
      if (key) runStatuses[key] = s.status;
    });
  }

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()}>
      {a && (
        <div>
          <PageHeader
            back={{ to: "/automations", label: "Automations" }}
            title={a.name}
            description={a.description || describeTrigger(a.spec, catalog.data)}
            actions={
              <>
                <div className="mr-1 flex items-center gap-2 rounded-xl border border-border px-3 py-1.5">
                  <span className="text-sm text-muted">{a.active ? "Active" : "Paused"}</span>
                  <Switch checked={a.active} label={a.active ? "Pause" : "Activate"} loading={m.act.isPending} onChange={(v) => act(v ? "activate" : "pause")} />
                </div>
                <Button variant="secondary" onClick={() => act("run")} disabled={!a.active} icon={<IPlay width={14} height={14} />}>
                  Run now
                </Button>
                <ButtonLink to={`/automations/${a.id}/edit`} icon={<IEdit width={14} height={14} />}>
                  Edit
                </ButtonLink>
                <Menu
                  trigger={({ toggle }) => (
                    <Button variant="ghost" size="icon" aria-label="More actions" onClick={toggle}>
                      <IMore />
                    </Button>
                  )}
                  items={[
                    { label: "Duplicate", icon: <ICopy width={15} height={15} />, onSelect: () => act("duplicate") },
                    { label: "Redeploy to engine", icon: <IRefresh width={15} height={15} />, onSelect: () => act("redeploy") },
                    "separator",
                    { label: "Delete", icon: <ITrash width={15} height={15} />, danger: true, onSelect: () => setConfirm(true) },
                  ]}
                />
              </>
            }
          />

          {a.deploy.status === "error" && (
            <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-warn/30 bg-warn/5 p-4 sm:flex-row sm:items-center">
              <div className="flex-1 text-sm">
                <p className="font-medium text-fg">Saved, but not deployed to the automation engine</p>
                <p className="text-muted">{a.deploy.error}</p>
              </div>
              <Button size="sm" onClick={() => act("redeploy")} loading={m.act.isPending}>
                Retry
              </Button>
            </div>
          )}
          {a.last_error && (
            <div role="alert" className="mb-4 flex flex-col gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center">
              <IAlert className="shrink-0 text-danger" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-fg">The last run stopped: {a.last_error.message}</p>
                <p className="text-xs text-muted">{relativeTime(a.last_error.at)}</p>
              </div>
              {a.last_error.provider && (
                <ButtonLink to={`/integrations/${a.last_error.provider}`} variant="primary" size="sm">
                  Fix connection
                </ButtonLink>
              )}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <Card>
                <CardTitle description={openRun ? "Showing the selected run" : "Each step runs in order, for every item."}>Flow</CardTitle>
                <FlowPipeline items={specToFlow(a.spec, catalog.data ?? [])} statuses={openRun ? runStatuses : undefined} />
              </Card>
              <Card>
                <CardTitle action={<Button size="xs" variant="ghost" onClick={() => runs.refetch()} icon={<IRefresh width={13} height={13} />}>Refresh</Button>}>
                  Run history
                </CardTitle>
                {runs.isError ? <p className="text-sm text-muted">{errorMessage(runs.error)}</p> : <RunsList runs={runs.data ?? []} onOpen={setOpenRun} />}
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardTitle>Performance</CardTitle>
                <Stats runs={runs.data ?? []} />
              </Card>
              <Card>
                <CardTitle>Details</CardTitle>
                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Starts</dt>
                    <dd className="text-right text-fg">{describeTrigger(a.spec, catalog.data)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Created</dt>
                    <dd className="text-fg">{relativeTime(a.created_at)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Made with</dt>
                    <dd className="text-fg">{{ ai: "AI", template: "Template", builder: "Builder" }[a.origin]}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted">Uses</dt>
                    <dd className="flex gap-1.5">
                      {a.providers.length ? (
                        a.providers.map((p) => (
                          <Link key={p} to={`/integrations/${p}`} className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2" title={p}>
                            <ProviderMark provider={p} size={15} />
                          </Link>
                        ))
                      ) : (
                        <span className="text-fg">AI only</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Engine</dt>
                    <dd>
                      <Badge tone={a.deploy.status === "deployed" ? "success" : "warning"} dot>
                        {a.deploy.status === "deployed" ? "Deployed" : "Not deployed"}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </Card>
            </div>
          </div>

          <Drawer open={!!openRun} onClose={() => setOpenRun(null)} title="Run details" description={a.name}>
            <ExecutionView
              detail={run.data}
              loading={run.isLoading}
              retrying={m.act.isPending}
              onRetry={a.active ? () => { setOpenRun(null); void act("run"); } : undefined}
            />
            {run.isError && <p className="text-sm text-danger">{errorMessage(run.error)}</p>}
          </Drawer>
          <ConfirmDialog
            open={confirm}
            onClose={() => setConfirm(false)}
            title={`Delete “${a.name}”?`}
            message="It stops running and its configuration is removed."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              await m.remove.mutateAsync(a.id);
              toast.success("Deleted", a.name);
              navigate("/automations");
            }}
          />
        </div>
      )}
    </QueryBoundary>
  );
}

/* ------------------------------------------------------------- system */

function toSummary(e: N8nExecution): RunSummary {
  const a = Date.parse(String(e.startedAt ?? ""));
  const b = Date.parse(String(e.stoppedAt ?? ""));
  return {
    id: String(e.id),
    status: String(e.status ?? (e.finished ? "success" : "running")),
    started_at: (e.startedAt as string) ?? null,
    finished_at: (e.stoppedAt as string) ?? null,
    duration_ms: Number.isFinite(a) && Number.isFinite(b) ? b - a : null,
  };
}

export function SystemAutomationPage() {
  const { id = "" } = useParams();
  const wf = useWorkflow(id);
  const executions = useExecutions({ workflow_id: id, limit: 30 });
  const m = useWorkflowMutations();
  const toast = useToast();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const detail = useExecutionDetail(openRun ?? undefined);
  const runs = (executions.data?.data ?? []).map(toSummary);

  return (
    <QueryBoundary isLoading={wf.isLoading} isError={wf.isError} error={wf.error} onRetry={() => wf.refetch()}>
      {wf.data && (
        <div>
          <PageHeader
            back={{ to: "/automations", label: "Automations" }}
            eyebrow="System assistant"
            title={wf.data.name.replace(/^Asistente - /, "")}
            description="Comes with Personal Assistant. Personalise it from your profile; pause it any time."
            actions={
              <>
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5">
                  <span className="text-sm text-muted">{wf.data.active ? "Active" : "Paused"}</span>
                  <Switch
                    checked={!!wf.data.active}
                    label={wf.data.active ? "Pause" : "Activate"}
                    loading={m.activate.isPending || m.deactivate.isPending}
                    onChange={async (v) => {
                      try {
                        if (v) await m.activate.mutateAsync(id);
                        else await m.deactivate.mutateAsync(id);
                        await wf.refetch();
                        toast.success(v ? "Activated" : "Paused");
                      } catch (e) {
                        toast.error("Could not change it", errorMessage(e));
                      }
                    }}
                  />
                </div>
                <ButtonLink to="/profiles" variant="secondary">
                  Personalise
                </ButtonLink>
                <ButtonLink to={`${N8N_URL}/workflow/${id}`} variant="ghost" icon={<IExternal width={14} height={14} />}>
                  Open in engine
                </ButtonLink>
              </>
            }
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <Card>
                <CardTitle>Flow</CardTitle>
                <FlowPipeline items={workflowToFlow(wf.data)} />
              </Card>
              <Card>
                <CardTitle>Run history</CardTitle>
                <RunsList runs={runs} onOpen={setOpenRun} />
              </Card>
            </div>
            <Card>
              <CardTitle>Performance</CardTitle>
              <Stats runs={runs} />
            </Card>
          </div>
          <Drawer open={!!openRun} onClose={() => setOpenRun(null)} title="Run details" description={wf.data.name}>
            <ExecutionView detail={detail.data} loading={detail.isLoading} />
            {detail.isError && <p className="text-sm text-danger">{errorMessage(detail.error)}</p>}
          </Drawer>
        </div>
      )}
    </QueryBoundary>
  );
}

/* ---------------------------------------------------------- execution */

export function ExecutionPage() {
  const { id = "" } = useParams();
  const detail = useExecutionDetail(id);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ to: "/activity", label: "Activity" }}
        eyebrow="Run details"
        title={detail.data?.workflow?.name ?? "Automation run"}
      />
      {detail.isError ? (
        <EmptyState icon={<IAlert />} title="This run is not available" description={errorMessage(detail.error)} />
      ) : (
        <Card>
          <ExecutionView detail={detail.data} loading={detail.isLoading} />
        </Card>
      )}
    </div>
  );
}
