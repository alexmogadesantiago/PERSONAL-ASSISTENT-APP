/**
 * The automation builder.
 *
 *   1. Start: describe it (AI drafts it), pick a template, or start blank.
 *   2. Build: a vertical WHEN → IF → AI → THEN pipeline of blocks; each block
 *      is a small form; text fields offer the fields earlier blocks produce.
 *   3. Check: requirements (which connections are needed and whether they are
 *      ready) and a real test run, reported step by step.
 *   4. Save (and optionally activate). The backend validates, stores and
 *      deploys it to the engine.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AutomationSpec, Block, BlockKind, DraftResult, SpecStep, Template, TestStepReport } from "@/api/platform";
import {
  useAutomationMutations,
  useBlockCatalog,
  useCustomAutomation,
  useIntegrations,
  useTemplates,
} from "@/hooks/platform";
import { ApiError } from "@/api";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui";
import {
  BlockIcon,
  IArrowDown,
  ICheck,
  IChevronDown,
  IPlay,
  IPlus,
  ISparkles,
  ITrash,
  IWand,
  IX,
  ProviderMark,
} from "@/components/icons2";
import { cn } from "@/utils/cn";
import { BlockPicker } from "@/features/automations/BlockPicker";
import { ParamField } from "@/features/automations/ParamField";
import { KIND_LABEL, KIND_TONE, describeTrigger } from "@/features/automations/flow";
import { formatMs } from "@/features/activity/ActivityList";
import { useConnectFlow } from "./IntegrationsPage";

const EXAMPLES = [
  "When I receive an email with an invoice, save it in Drive and notify me on Telegram.",
  "Every Monday at 8:00 send me a summary of my important emails.",
  "If I receive an urgent email, alert me.",
  "Find the emails waiting for my reply every weekday morning.",
  "Every weekday at 9:00 tell me which pull requests are waiting for my review.",
];

const BLANK: AutomationSpec = {
  name: "",
  description: "",
  trigger: { block: "schedule", params: { every: "day", at: "08:00", weekday: "1" } },
  steps: [],
};

function defaults(b: Block): Record<string, unknown> {
  return Object.fromEntries(b.params.map((p) => [p.key, p.default ?? ""]));
}

type EditStep = SpecStep & { id: string };
type EditSpec = Omit<AutomationSpec, "steps"> & { steps: EditStep[] };

let stepSeq = 0;
const newId = () => `n${Date.now().toString(36).slice(-4)}${(stepSeq++).toString(36)}`;

/* ---------------------------------------------------------------- start */

function Start({
  onSpec,
  autoPrompt,
  initialMode,
}: {
  onSpec: (spec: AutomationSpec, origin: "builder" | "ai" | "template", draft?: DraftResult) => void;
  autoPrompt: string;
  initialMode: "describe" | "templates";
}) {
  const [mode, setMode] = useState<"describe" | "templates">(initialMode);
  const [prompt, setPrompt] = useState(autoPrompt);
  const templates = useTemplates();
  const m = useAutomationMutations();
  const toast = useToast();
  const fired = useRef(false);

  async function draft(text: string) {
    try {
      const r = await m.draft.mutateAsync(text);
      if (r.spec) onSpec(r.spec, "ai", r);
      else toast.error("The assistant could not draft it", r.error ?? r.problems.join("; "));
    } catch (e) {
      toast.error("The assistant could not draft it", errorMessage(e));
    }
  }

  useEffect(() => {
    if (autoPrompt && !fired.current) {
      fired.current = true;
      void draft(autoPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt]);

  const categories = useMemo(() => Array.from(new Set((templates.data ?? []).map((t) => t.category))), [templates.data]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex justify-center">
        <Segmented
          label="How to start"
          value={mode}
          onChange={setMode}
          options={[
            { value: "describe", label: "Describe it" },
            { value: "templates", label: "Templates" },
          ]}
        />
      </div>

      {mode === "describe" ? (
        <div className="ai-surface rounded-3xl border border-brand/20 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm font-medium text-brand">
            <ISparkles width={16} height={16} /> Build with AI
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Tell me what to automate</h2>
          <p className="mt-1 text-sm text-muted">Plain words are fine. I'll turn it into steps you can review before anything runs.</p>
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim().length > 3) void draft(prompt.trim());
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && prompt.trim().length > 3) void draft(prompt.trim());
              }}
              rows={3}
              placeholder="When I receive an email with an invoice, save it in Drive and notify me on Telegram."
              aria-label="Describe the automation"
              className="input min-h-[96px] resize-none bg-surface/80 text-[15px]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-subtle">Ctrl + Enter to draft</p>
              <Button type="submit" variant="ai" size="lg" loading={m.draft.isPending} disabled={prompt.trim().length <= 3} icon={<IWand width={16} height={16} />}>
                {m.draft.isPending ? "Designing your automation…" : "Draft it"}
              </Button>
            </div>
          </form>
          {m.draft.isPending && (
            <div className="mt-5 space-y-2" aria-live="polite">
              {["Understanding your request", "Choosing the right services", "Wiring the steps"].map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-sm text-muted" style={{ animation: `pa-in-up 300ms ${i * 600}ms both` }}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> {s}…
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-subtle">Try one of these</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted transition hover:border-brand/40 hover:text-fg"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {templates.isLoading && <Skeleton className="h-48" />}
          {categories.map((c) => (
            <section key={c}>
              <p className="eyebrow mb-2">{c}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(templates.data ?? [])
                  .filter((t) => t.category === c)
                  .map((t: Template) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onSpec(t.spec, "template")}
                      className="card-interactive flex flex-col items-start p-4 text-left"
                    >
                      <div className="flex gap-1">
                        {t.providers.map((p) => (
                          <span key={p} className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2">
                            <ProviderMark provider={p} size={15} />
                          </span>
                        ))}
                      </div>
                      <p className="mt-3 text-sm font-semibold text-fg">{t.title}</p>
                      <p className="mt-1 text-xs text-muted">{t.description}</p>
                      <span className="mt-3 text-xs font-medium text-brand">Use template →</span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        or{" "}
        <button type="button" className="font-medium text-brand hover:underline" onClick={() => onSpec(BLANK, "builder")}>
          start from scratch
        </button>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ step card */

function StepCard({
  index,
  block,
  step,
  fields,
  report,
  missing,
  onChange,
  onRemove,
  onMove,
  canUp,
  canDown,
  onReplace,
}: {
  index: number;
  block: Block | undefined;
  step: { block: string; params: Record<string, unknown>; label?: string };
  fields: string[];
  report?: TestStepReport;
  missing: string[];
  onChange: (params: Record<string, unknown>) => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  canUp?: boolean;
  canDown?: boolean;
  onReplace: () => void;
}) {
  const [open, setOpen] = useState(index === 0 || missing.length > 0);
  const kind = (block?.kind ?? "action") as BlockKind;
  const summary = block?.params
    .filter((p) => p.type !== "bool")
    .map((p) => step.params[p.key])
    .filter((v) => v != null && String(v).trim())
    .slice(0, 2)
    .map(String)
    .join(" · ");

  return (
    <div className={cn("card relative overflow-hidden transition", missing.length > 0 && "border-warn/40", report && !report.ok && "border-danger/40")}>
      <div className="flex items-center gap-3 p-4">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl ring-1 ring-inset", KIND_TONE[kind])}>
          {block?.provider ? <ProviderMark provider={block.provider} size={18} /> : <BlockIcon name={block?.icon ?? "bolt"} />}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{KIND_LABEL[kind]}</p>
          <p className="truncate text-sm font-medium text-fg">{block?.label ?? step.block}</p>
          {!open && summary && <p className="truncate text-xs text-muted">{summary}</p>}
        </button>
        {report && (
          <span className={cn("hidden text-xs sm:block", report.ok ? "text-ok" : "text-danger")}>
            {report.ok ? (report.skipped ? "skipped" : `✓ ${report.items} item${report.items === 1 ? "" : "s"}`) : "failed"}
          </span>
        )}
        <div className="flex items-center">
          {onMove && (
            <>
              <button type="button" disabled={!canUp} onClick={() => onMove(-1)} aria-label="Move up" className="rounded-lg p-1.5 text-subtle transition hover:bg-surface-2 hover:text-fg disabled:opacity-30">
                <IArrowDown width={15} height={15} className="rotate-180" />
              </button>
              <button type="button" disabled={!canDown} onClick={() => onMove(1)} aria-label="Move down" className="rounded-lg p-1.5 text-subtle transition hover:bg-surface-2 hover:text-fg disabled:opacity-30">
                <IArrowDown width={15} height={15} />
              </button>
            </>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label="Remove step" className="rounded-lg p-1.5 text-subtle transition hover:bg-danger/10 hover:text-danger">
              <ITrash width={15} height={15} />
            </button>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="rounded-lg p-1.5 text-subtle transition hover:bg-surface-2 hover:text-fg">
            <IChevronDown width={16} height={16} className={cn("transition", open && "rotate-180")} />
          </button>
        </div>
      </div>
      {open && block && (
        <div className="animate-in-fade space-y-3 border-t border-border bg-surface-2/30 p-4">
          <p className="text-xs text-muted">{block.description}</p>
          {block.params.length === 0 && <p className="text-sm text-muted">Nothing to configure.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {block.params.map((p) => (
              <div key={p.key} className={cn((p.type === "textarea" || p.templated) && "sm:col-span-2")}>
                <ParamField
                  id={`p-${index}-${p.key}`}
                  param={p}
                  value={step.params[p.key]}
                  invalid={missing.includes(p.key)}
                  fields={fields}
                  onChange={(v) => onChange({ ...step.params, [p.key]: v })}
                />
              </div>
            ))}
          </div>
          {block.outputs.length > 0 && (
            <p className="text-xs text-subtle">
              Adds: {block.outputs.map((o) => <code key={o} className="mr-1 rounded bg-surface-2 px-1 font-mono">{o}</code>)}
            </p>
          )}
          <button type="button" onClick={onReplace} className="text-xs font-medium text-brand hover:underline">
            Change block
          </button>
        </div>
      )}
      {report && !report.ok && report.error && (
        <div className="border-t border-danger/20 bg-danger/5 px-4 py-2.5 text-sm text-danger">{report.error.message}</div>
      )}
    </div>
  );
}

function Connector({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center py-1">
      <span className="h-3 w-px bg-border-strong" />
      <button
        type="button"
        onClick={onAdd}
        aria-label="Add a step here"
        className="grid h-7 w-7 place-items-center rounded-full border border-border-strong bg-surface text-subtle transition hover:scale-110 hover:border-brand hover:text-brand"
      >
        <IPlus width={14} height={14} />
      </button>
      <span className="h-3 w-px bg-border-strong" />
    </div>
  );
}

/* -------------------------------------------------------------- page */

export function AutomationBuilderPage() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const catalog = useBlockCatalog();
  const integrations = useIntegrations();
  const existing = useCustomAutomation(id, editing);
  const m = useAutomationMutations();
  const flow = useConnectFlow();

  const [spec, setSpec] = useState<EditSpec | null>(null);
  const [origin, setOrigin] = useState<"builder" | "ai" | "template">("builder");
  const [draftInfo, setDraftInfo] = useState<DraftResult | null>(null);
  const [picker, setPicker] = useState<{ at: number; replace?: boolean; trigger?: boolean } | null>(null);
  const [report, setReport] = useState<{ ok: boolean; steps: TestStepReport[] } | null>(null);
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const blocks = useMemo(() => catalog.data ?? [], [catalog.data]);
  const byKey = useMemo(() => new Map(blocks.map((b) => [b.key, b])), [blocks]);

  useEffect(() => {
    if (existing.data && !spec) {
      setSpec({ ...existing.data.spec, steps: existing.data.spec.steps.map((s) => ({ ...s, id: s.id ?? newId() })) });
      setOrigin(existing.data.origin);
    }
  }, [existing.data, spec]);

  function load(s: AutomationSpec, o: typeof origin, d?: DraftResult) {
    setSpec({ ...s, steps: s.steps.map((st) => ({ ...st, id: st.id ?? newId() })) });
    setOrigin(o);
    setDraftInfo(d ?? null);
    setReport(null);
    setServerProblems([]);
  }

  // ---- derived -------------------------------------------------------
  const fieldsAt = (index: number): string[] => {
    if (!spec) return [];
    let fields: string[] = [...(byKey.get(spec.trigger.block)?.outputs ?? [])];
    for (let i = 0; i < index; i++) {
      const b = byKey.get(spec.steps[i].block);
      if (!b) continue;
      fields = b.key === "transform.combine" ? [...b.outputs] : Array.from(new Set([...fields, ...b.outputs]));
    }
    return fields.filter((f) => f !== "items");
  };

  const missingFor = (blockKey: string, p: Record<string, unknown>) =>
    (byKey.get(blockKey)?.params ?? []).filter((x) => x.required && (p[x.key] == null || String(p[x.key]).trim() === "")).map((x) => x.key);

  const needed = useMemo(() => {
    if (!spec) return [] as { key: string; services: string[] }[];
    const map = new Map<string, Set<string>>();
    for (const k of [spec.trigger.block, ...spec.steps.map((s) => s.block)]) {
      const b = byKey.get(k);
      if (b?.provider) {
        if (!map.has(b.provider)) map.set(b.provider, new Set());
        if (b.service) map.get(b.provider)!.add(b.service);
      }
    }
    return Array.from(map, ([key, s]) => ({ key, services: Array.from(s) }));
  }, [spec, byKey]);

  const integrationList = integrations.data?.data ?? [];
  const blockers = needed.filter(({ key, services }) => {
    const i = integrationList.find((x) => x.key === key);
    if (!i?.connected) return true;
    if (key === "telegram") return !i.connection?.telegram?.chat;
    return services.some((s) => !i.connection?.services.includes(s));
  });
  const incomplete =
    !spec ||
    !spec.name.trim() ||
    spec.steps.length === 0 ||
    missingFor(spec.trigger.block, spec.trigger.params).length > 0 ||
    spec.steps.some((s) => missingFor(s.block, s.params).length > 0);

  // ---- actions -------------------------------------------------------
  function pick(b: Block) {
    if (!spec || !picker) return;
    if (picker.trigger) setSpec({ ...spec, trigger: { block: b.key, params: defaults(b) } });
    else if (picker.replace)
      setSpec({ ...spec, steps: spec.steps.map((s, i) => (i === picker.at ? { ...s, block: b.key, params: defaults(b), label: undefined } : s)) });
    else {
      const steps = [...spec.steps];
      steps.splice(picker.at, 0, { id: newId(), block: b.key, params: defaults(b) });
      setSpec({ ...spec, steps });
    }
    setPicker(null);
    setReport(null);
  }

  function cleanSpec(): AutomationSpec {
    return {
      name: spec!.name.trim(),
      description: spec!.description.trim(),
      trigger: spec!.trigger,
      steps: spec!.steps.map(({ block, params: p, label }) => ({ block, params: p, ...(label ? { label } : {}) })),
    };
  }

  async function test() {
    try {
      setReport(await m.test.mutateAsync(cleanSpec()));
    } catch (e) {
      toast.error("Test could not run", errorMessage(e));
    }
  }

  async function save(activate: boolean) {
    setServerProblems([]);
    try {
      const saved = editing ? await m.update.mutateAsync({ id: id!, spec: cleanSpec() }) : await m.create.mutateAsync({ spec: cleanSpec(), origin });
      if (activate) {
        try {
          await m.act.mutateAsync({ id: saved.id, verb: "activate" });
        } catch (e) {
          toast.error("Saved, but not activated", errorMessage(e));
          navigate(`/automations/${saved.id}`);
          return;
        }
      }
      toast.success(editing ? "Automation saved" : activate ? "Automation is live" : "Automation saved", saved.name);
      navigate(`/automations/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const d = (e.detail as { detail?: { problems?: string[] } } | null)?.detail;
        setServerProblems(d?.problems ?? [e.message]);
      }
      toast.error("Could not save", errorMessage(e));
    }
  }

  // ---- render --------------------------------------------------------
  if (editing && existing.isLoading) return <Skeleton className="h-96" />;

  if (!spec) {
    return (
      <div>
        <PageHeader back={{ to: "/automations", label: "Automations" }} eyebrow="New automation" title="Create an automation" />
        <Start onSpec={load} autoPrompt={params.get("prompt") ?? ""} initialMode={params.get("mode") === "templates" ? "templates" : "describe"} />
      </div>
    );
  }

  const reportFor = (sid: string) => report?.steps.find((r) => r.step === sid);
  const triggerBlock = byKey.get(spec.trigger.block);

  return (
    <div>
      <PageHeader
        back={{ to: editing ? `/automations/${id}` : "/automations", label: editing ? "Back to automation" : "Automations" }}
        eyebrow={editing ? "Edit automation" : origin === "ai" ? "Drafted by AI - review and save" : "New automation"}
        title={
          <input
            value={spec.name}
            onChange={(e) => setSpec({ ...spec, name: e.target.value })}
            placeholder="Name your automation"
            aria-label="Automation name"
            className="w-full min-w-0 bg-transparent text-[22px] font-semibold tracking-tight text-fg placeholder:text-subtle focus:outline-none"
          />
        }
        description={
          <input
            value={spec.description}
            onChange={(e) => setSpec({ ...spec, description: e.target.value })}
            placeholder="Add a short description (optional)"
            aria-label="Automation description"
            className="w-full bg-transparent text-sm text-muted placeholder:text-subtle focus:outline-none"
          />
        }
        actions={
          <>
            <Button variant="secondary" onClick={test} loading={m.test.isPending} disabled={incomplete} icon={<IPlay width={14} height={14} />}>
              Test run
            </Button>
            <Button variant="outline" onClick={() => save(false)} loading={m.create.isPending || m.update.isPending} disabled={incomplete}>
              Save
            </Button>
            {!editing && (
              <Button onClick={() => save(true)} loading={m.act.isPending} disabled={incomplete || blockers.length > 0}>
                Save & activate
              </Button>
            )}
          </>
        }
      />

      {draftInfo && (
        <div className="ai-surface animate-in-up mb-5 flex gap-3 rounded-2xl border border-brand/20 p-4">
          <ISparkles className="mt-0.5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{draftInfo.explanation || "Here is a first version. Review each step before saving."}</p>
            {draftInfo.problems.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs text-warn">
                {draftInfo.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setDraftInfo(null)} className="self-start rounded-lg p-1 text-subtle hover:text-fg">
            <IX width={15} height={15} />
          </button>
        </div>
      )}
      {serverProblems.length > 0 && (
        <div role="alert" className="mb-5 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <ul className="list-disc pl-4">
            {serverProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="hairline-grid -m-2 rounded-3xl p-2 sm:p-4">
          <StepCard
            index={0}
            block={triggerBlock}
            step={spec.trigger}
            fields={[]}
            report={reportFor("trigger")}
            missing={missingFor(spec.trigger.block, spec.trigger.params)}
            onChange={(p) => setSpec({ ...spec, trigger: { ...spec.trigger, params: p } })}
            onReplace={() => setPicker({ at: 0, trigger: true })}
          />
          {spec.steps.map((s, i) => (
            <div key={s.id}>
              <Connector onAdd={() => setPicker({ at: i })} />
              <StepCard
                index={i + 1}
                block={byKey.get(s.block)}
                step={s}
                fields={fieldsAt(i)}
                report={reportFor(s.id)}
                missing={missingFor(s.block, s.params)}
                onChange={(p) => setSpec({ ...spec, steps: spec.steps.map((x) => (x.id === s.id ? { ...x, params: p } : x)) })}
                onRemove={() => setSpec({ ...spec, steps: spec.steps.filter((x) => x.id !== s.id) })}
                onMove={(dir) => {
                  const steps = [...spec.steps];
                  const [it] = steps.splice(i, 1);
                  steps.splice(i + dir, 0, it);
                  setSpec({ ...spec, steps });
                }}
                canUp={i > 0}
                canDown={i < spec.steps.length - 1}
                onReplace={() => setPicker({ at: i, replace: true })}
              />
            </div>
          ))}
          <div className="flex flex-col items-center py-1">
            <span className="h-4 w-px bg-border-strong" />
            <Button variant="secondary" onClick={() => setPicker({ at: spec.steps.length })} icon={<IPlus width={15} height={15} />}>
              Add a step
            </Button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardTitle description={describeTrigger(spec, blocks)}>Summary</CardTitle>
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between">
                <span className="text-muted">Steps</span>
                <span className="text-fg">{spec.steps.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted">Status after saving</span>
                <span className="text-fg">{editing ? (existing.data?.active ? "Active" : "Paused") : "Paused until activated"}</span>
              </li>
            </ul>
            {incomplete && (
              <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
                {!spec.name.trim() ? "Give it a name. " : ""}
                {spec.steps.length === 0 ? "Add at least one step. " : ""}
                Fill the fields marked *.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle description="Connections this automation uses.">Requirements</CardTitle>
            {needed.length === 0 ? (
              <p className="text-sm text-muted">No connected service needed.</p>
            ) : (
              <ul className="space-y-2">
                {needed.map(({ key, services }) => {
                  const i = integrationList.find((x) => x.key === key);
                  const blocked = blockers.some((b) => b.key === key);
                  return (
                    <li key={key} className="flex items-center gap-3 rounded-xl bg-surface-2/60 p-2.5">
                      <ProviderMark provider={key} size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg">{i?.label ?? key}</p>
                        <p className="truncate text-xs text-muted">{services.join(", ") || "messages"}</p>
                      </div>
                      {blocked ? (
                        i ? (
                          <Button size="xs" onClick={() => flow.open(i)}>
                            {i.connected ? "Allow" : "Connect"}
                          </Button>
                        ) : null
                      ) : (
                        <ICheck className="text-ok" width={16} height={16} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle description="Runs every step for real, once, right now.">Test run</CardTitle>
            {!report ? (
              <EmptyState
                className="py-6"
                title="Not tested yet"
                description="A test performs the real actions (a test message is really sent)."
                action={
                  <Button size="sm" variant="secondary" onClick={test} loading={m.test.isPending} disabled={incomplete}>
                    Run test
                  </Button>
                }
              />
            ) : (
              <div>
                <Badge tone={report.ok ? "success" : "danger"} dot>
                  {report.ok ? "Test passed" : "Test failed"}
                </Badge>
                <ol className="mt-3 space-y-2">
                  {report.steps.map((r) => (
                    <li key={r.step} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className={r.ok ? "text-ok" : "text-danger"}>{r.ok ? (r.skipped ? "–" : "✓") : "✕"}</span>
                        <span className="flex-1 truncate text-fg">{r.label}</span>
                        <span className="text-xs text-subtle">{formatMs(r.duration_ms)}</span>
                      </div>
                      {r.ok && !r.skipped && <p className="ml-5 text-xs text-muted">{r.items} item(s)</p>}
                      {r.sample && (
                        <details className="ml-5 mt-1">
                          <summary className="cursor-pointer text-xs text-brand">Preview</summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] text-muted">{JSON.stringify(r.sample, null, 2)}</pre>
                        </details>
                      )}
                      {r.error && (
                        <div className="ml-5 mt-1 text-xs text-danger">
                          {r.error.message}
                          {r.error.provider && (
                            <Link to={`/integrations/${r.error.provider}`} className="ml-1 font-medium underline">
                              Fix
                            </Link>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        </aside>
      </div>

      <BlockPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        title={picker?.trigger ? "Choose what starts it" : picker?.replace ? "Replace this step" : "Add a step"}
        blocks={blocks}
        kinds={picker?.trigger ? ["trigger"] : ["condition", "ai", "action", "transform"]}
        integrations={integrationList}
        onPick={pick}
      />
      {flow.drawers}
    </div>
  );
}
