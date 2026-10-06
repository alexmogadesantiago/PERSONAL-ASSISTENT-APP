/**
 * Automations.
 *
 * Two kinds, one list:
 *   - yours: built in the panel (or drafted by AI); full control;
 *   - system: the four assistants shipped with the product (n8n workflows).
 * Each card reads as a sentence: when → what → where, its state, its last run
 * and its success rate. n8n vocabulary never appears.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/api";
import type { Automation } from "@/api/platform";
import { QueryBoundary, errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, Menu, PageHeader, Skeleton, Switch, Tabs } from "@/components/ui";
import { useSystemSnapshot } from "@/ai/useSystemSnapshot";
import { useWorkflowMutations } from "@/hooks/queries";
import { useAutomationMutations, useBlockCatalog, useCustomAutomations, useDismissSuggestion, useN8nCenter, useSuggestions } from "@/hooks/platform";
import { AutomationHealth, type HealthStats } from "@/features/automations/Health";
import { useToast } from "@/stores/toast";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { IBolt, ICopy, IEdit, IMore, IPlay, IPlus, ISparkles, ITrash } from "@/components/icons2";
import { FlowChips, describeTrigger, specToFlow, workflowToFlow } from "@/features/automations/flow";
import type { AutomationView } from "@/features/automations/catalog";

type Filter = "all" | "active" | "paused" | "mine" | "system";

function Rate({ value }: { value: number | null }) {
  if (value == null) return <span className="text-subtle">—</span>;
  return <span className={cn("tabular-nums", value >= 95 ? "text-ok" : value >= 80 ? "text-warn" : "text-danger")}>{value}%</span>;
}

function CustomCard({ a, onDelete, stats }: { a: Automation; onDelete: (a: Automation) => void; stats?: HealthStats }) {
  const catalog = useBlockCatalog();
  const m = useAutomationMutations();
  const toast = useToast();
  const navigate = useNavigate();
  const flow = specToFlow(a.spec, catalog.data ?? []);

  async function act(verb: "activate" | "pause" | "duplicate" | "run") {
    try {
      const r = await m.act.mutateAsync({ id: a.id, verb });
      if (verb === "duplicate") {
        toast.success("Duplicated", r.name);
        navigate(`/automations/${r.id}`);
      } else if (verb === "run") toast.success("Running", `${a.name} started in the background.`);
      else toast.success(verb === "activate" ? "Activated" : "Paused", a.name);
    } catch (e) {
      toast.error("Could not do that", errorMessage(e));
    }
  }

  return (
    <article className={cn("card-interactive flex min-w-0 flex-col p-5", a.last_error && "border-danger/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link to={`/automations/${a.id}`} className="truncate text-[15px] font-semibold tracking-tight text-fg hover:underline">
              {a.name}
            </Link>
            {a.origin === "ai" && (
              <Badge tone="accent">
                <ISparkles width={11} height={11} /> AI
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{describeTrigger(a.spec, catalog.data)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Switch
            checked={a.active}
            label={a.active ? `Pause ${a.name}` : `Activate ${a.name}`}
            loading={m.act.isPending && m.act.variables?.id === a.id}
            onChange={(v) => act(v ? "activate" : "pause")}
          />
          <Menu
            trigger={({ toggle }) => (
              <button type="button" aria-label={`Actions for ${a.name}`} onClick={toggle} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                <IMore />
              </button>
            )}
            items={[
              { label: "Run now", icon: <IPlay width={15} height={15} />, onSelect: () => act("run"), disabled: !a.active },
              { label: "Edit", icon: <IEdit width={15} height={15} />, onSelect: () => navigate(`/automations/${a.id}/edit`) },
              { label: "Duplicate", icon: <ICopy width={15} height={15} />, onSelect: () => act("duplicate") },
              "separator",
              { label: "Delete", icon: <ITrash width={15} height={15} />, danger: true, onSelect: () => onDelete(a) },
            ]}
          />
        </div>
      </div>
      <FlowChips items={flow} className="mt-4" />
      {stats && <AutomationHealth stats={stats} />}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", a.active ? "bg-ok" : "bg-subtle")} />
          {a.active ? "Active" : "Paused"}
          {a.deploy.status === "error" && <Badge tone="warning">Not deployed</Badge>}
        </span>
        {a.last_error ? (
          <span className="truncate text-danger">{a.last_error.message}</span>
        ) : (
          <span>Updated {relativeTime(a.updated_at)}</span>
        )}
      </div>
    </article>
  );
}

function SystemCard({ v, busy, onToggle }: { v: AutomationView; busy: boolean; onToggle: () => void }) {
  const wf = v.workflow!;
  return (
    <article className="card-interactive flex min-w-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link to={`/automations/system/${wf.id}`} className="truncate text-[15px] font-semibold tracking-tight text-fg hover:underline">
              {wf.name.replace(/^Asistente - /, "")}
            </Link>
            <Badge>System</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{v.schedule ?? v.blueprint.description}</p>
        </div>
        <Switch checked={!!wf.active} label={wf.active ? `Pause ${wf.name}` : `Activate ${wf.name}`} loading={busy} onChange={onToggle} />
      </div>
      <FlowChips items={workflowToFlow(wf)} className="mt-4" />
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <p className="text-subtle">Last run</p>
          <p className="text-fg">{v.stats.lastRunAt ? relativeTime(v.stats.lastRunAt) : "Never"}</p>
        </div>
        <div>
          <p className="text-subtle">Success</p>
          <p>
            <Rate value={v.stats.successRate} />
          </p>
        </div>
        <div>
          <p className="text-subtle">Runs</p>
          <p className="tabular-nums text-fg">{v.stats.runs}</p>
        </div>
      </div>
    </article>
  );
}

export function AutomationsPage() {
  const snapshot = useSystemSnapshot();
  const custom = useCustomAutomations();
  const wfm = useWorkflowMutations();
  const m = useAutomationMutations();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);

  const customIds = useMemo(() => new Set((custom.data ?? []).map((a) => a.n8n_workflow_id).filter(Boolean)), [custom.data]);
  const system = snapshot.automations.filter(
    (v) => v.workflow && !customIds.has(v.workflow.id) && v.workflow.id !== "pa00errorhandler" && !v.workflow.name.startsWith("PA · "),
  );
  const mine = custom.data ?? [];

  const showMine = filter !== "system";
  const showSystem = filter !== "mine";
  const mineShown = mine.filter((a) => (filter === "active" ? a.active : filter === "paused" ? !a.active : true));
  const systemShown = system.filter((v) => (filter === "active" ? v.workflow!.active : filter === "paused" ? !v.workflow!.active : true));
  const total = mine.length + system.length;
  const active = mine.filter((a) => a.active).length + system.filter((v) => v.workflow!.active).length;

  async function toggleSystem(v: AutomationView) {
    const wf = v.workflow!;
    setBusyId(wf.id);
    try {
      if (wf.active) await wfm.deactivate.mutateAsync(wf.id);
      else await wfm.activate.mutateAsync(wf.id);
      toast.success(wf.active ? "Paused" : "Activated", wf.name);
    } catch (err) {
      toast.error("Could not change state", err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const suggestions = useSuggestions();
  const dismiss = useDismissSuggestion();
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const engine = useN8nCenter();
  const statsFor = (a: Automation): HealthStats | undefined => {
    const w = engine.data?.workflows.find((x) => x.automation_id === a.id);
    return w ? { successRate: w.success_rate_7d, runs: w.runs_7d, lastRunAt: w.last_run_at, avgDurationMs: w.avg_duration_ms } : undefined;
  };
  const n8nDown = snapshot.n8nState === "offline" || snapshot.n8nState === "invalid";

  return (
    <div>
      <PageHeader
        eyebrow="Automations"
        title="What your assistant does for you"
        description="Build one in plain words, start from a template, or tune the assistants that come with it."
        actions={
          <>
            <ButtonLink to="/engine" variant="ghost">
              Engine status
            </ButtonLink>
            <ButtonLink to="/automations/new?mode=templates" variant="secondary">
              Templates
            </ButtonLink>
            <ButtonLink to="/automations/new" variant="primary" icon={<IPlus width={16} height={16} />}>
              New automation
            </ButtonLink>
          </>
        }
      />

      {snapshot.n8nState === "not_configured" && (
        <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm">
          <p className="font-medium text-fg">n8n is not configured</p>
          <p className="text-muted">Automations are saved, but nothing runs until the automation engine is connected in Settings → Advanced.</p>
        </div>
      )}
      {n8nDown && (
        <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="font-medium text-fg">n8n unavailable</p>
          <p className="text-muted">Your saved automations are safe. Some actions are temporarily unavailable; runs resume when the engine is back.</p>
        </div>
      )}

      {(suggestions.data ?? [])
        .filter((sg) => !snoozed.includes(sg.id ?? sg.prompt))
        .map((sg) => (
          <div key={sg.id ?? sg.prompt} className="ai-surface animate-in-up mb-3 flex flex-col gap-3 rounded-2xl border border-brand/20 p-4 sm:flex-row sm:items-center">
            <ISparkles className="shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{sg.title}</p>
              <p className="text-xs text-muted">{sg.detail}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to={`/automations/new?prompt=${encodeURIComponent(sg.prompt)}`} size="sm" variant="ai">
                Create automation
              </ButtonLink>
              <Button size="sm" variant="ghost" onClick={() => setSnoozed((l) => [...l, sg.id ?? sg.prompt])}>
                Not now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => sg.id && dismiss.mutate(sg.id)}>
                Never suggest this
              </Button>
            </div>
          </div>
        ))}

      <Tabs
        label="Filter automations"
        value={filter}
        onChange={setFilter}
        className="mb-5"
        items={[
          { value: "all", label: "All", count: total },
          { value: "active", label: "Active", count: active },
          { value: "paused", label: "Paused", count: total - active },
          { value: "mine", label: "Built by you", count: mine.length },
          { value: "system", label: "System", count: system.length },
        ]}
      />

      <QueryBoundary isLoading={false} isError={custom.isError} error={custom.error} onRetry={() => custom.refetch()}>
        {custom.isLoading || snapshot.workflows.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[190px] rounded-2xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<IBolt />}
            title="No automations yet"
            description="Describe what you want - “every Monday, summarise my important emails” - and the assistant builds it."
            action={
              <>
                <ButtonLink to="/automations/new" variant="primary">
                  Create your first automation
                </ButtonLink>
                <ButtonLink to="/automations/new?mode=templates">Browse templates</ButtonLink>
              </>
            }
          />
        ) : (
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {showMine && mineShown.map((a) => <CustomCard key={a.id} a={a} onDelete={setDeleting} stats={statsFor(a)} />)}
            {showSystem && systemShown.map((v) => <SystemCard key={v.workflow!.id} v={v} busy={busyId === v.workflow!.id} onToggle={() => toggleSystem(v)} />)}
          </div>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        message="It stops running and its configuration is removed. Run history in the engine is kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await m.remove.mutateAsync(deleting.id);
            toast.success("Automation deleted", deleting.name);
          } catch (e) {
            toast.error("Could not delete", errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
