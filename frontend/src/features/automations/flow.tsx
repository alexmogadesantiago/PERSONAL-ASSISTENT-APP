/**
 * How an automation is drawn: a chain of blocks (WHEN → IF → AI → THEN).
 *
 * Panel-built automations come with a spec and the block catalogue; the system
 * assistants are n8n workflows, so their chain is derived from the node graph
 * and node types - users see "Gmail → AI → Telegram", never "httpRequest v4.3".
 */
import type { Block, AutomationSpec } from "@/api/platform";
import type { N8nWorkflow } from "@/api/types";
import { BlockIcon, IChevronRight, ProviderMark } from "@/components/icons2";
import { cn } from "@/utils/cn";

export interface FlowItem {
  key: string;
  label: string;
  icon: string;
  kind: "trigger" | "condition" | "ai" | "action" | "transform";
  provider?: string | null;
  detail?: string;
}

export const KIND_LABEL: Record<FlowItem["kind"], string> = {
  trigger: "When",
  condition: "If",
  ai: "AI",
  action: "Then",
  transform: "Combine",
};

export const KIND_TONE: Record<FlowItem["kind"], string> = {
  trigger: "bg-info/10 text-info ring-info/25",
  condition: "bg-warn/10 text-warn ring-warn/25",
  ai: "bg-accent/10 text-accent ring-accent/25",
  action: "bg-brand/10 text-brand ring-brand/25",
  transform: "bg-surface-2 text-muted ring-border",
};

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function describeTrigger(spec: AutomationSpec, catalog?: Block[]): string {
  const t = spec.trigger;
  const p = t.params as Record<string, string>;
  if (t.block === "schedule") {
    const at = p.at || "08:00";
    switch (p.every) {
      case "hour":
        return `Every hour at :${at.split(":")[1] ?? "00"}`;
      case "weekdays":
        return `Weekdays at ${at}`;
      case "week":
        return `Every ${WEEKDAYS[Number(p.weekday) || 1]} at ${at}`;
      default:
        return `Every day at ${at}`;
    }
  }
  if (t.block === "manual") return "When you press Run";
  if (t.block === "gmail.new_email") return `New Gmail matching “${p.query || "in:inbox"}”`;
  if (t.block === "outlook.new_email") return p.search ? `New Outlook mail containing “${p.search}”` : "New Outlook mail";
  if (t.block === "github.notifications") return "New GitHub notification";
  return catalog?.find((b) => b.key === t.block)?.label ?? t.block;
}

export function specToFlow(spec: AutomationSpec, catalog: Block[] = []): FlowItem[] {
  const byKey = new Map(catalog.map((b) => [b.key, b]));
  const trig = byKey.get(spec.trigger.block);
  const items: FlowItem[] = [
    {
      key: "trigger",
      label: trig?.label ?? spec.trigger.block,
      icon: trig?.icon ?? "clock",
      kind: "trigger",
      provider: trig?.provider,
      detail: describeTrigger(spec, catalog),
    },
  ];
  spec.steps.forEach((s, i) => {
    const b = byKey.get(s.block);
    items.push({
      key: s.id ?? `s${i}`,
      label: s.label || b?.label || s.block,
      icon: b?.icon ?? "bolt",
      kind: (b?.kind as FlowItem["kind"]) ?? "action",
      provider: b?.provider,
    });
  });
  return items;
}

/* ---------------------------------------------------- n8n system flows */

interface N8nNode {
  name: string;
  type: string;
  disabled?: boolean;
  parameters?: Record<string, unknown>;
}

function classify(node: N8nNode): FlowItem | null {
  const t = node.type.toLowerCase();
  const url = String((node.parameters ?? {}).url ?? "");
  if (t.includes("stickynote")) return null;
  if (node.name.toLowerCase().startsWith("comprobar config")) return null;
  if (t.includes("manualtrigger") || t.includes("webhook") || t.includes("errortrigger")) return null;
  if (t.includes("gmailtrigger")) return { key: node.name, label: "Gmail", icon: "mail", kind: "trigger", provider: "google" };
  if (t.includes("scheduletrigger")) return { key: node.name, label: node.name, icon: "clock", kind: "trigger" };
  if (t.includes("googlecalendar")) return { key: node.name, label: "Calendar", icon: "calendar", kind: "action", provider: "google" };
  if (t.includes("gmail")) return null; // the manual test fetch; the trigger already says Gmail
  if (t.includes("rssfeed")) return { key: node.name, label: "News feeds", icon: "doc", kind: "action" };
  if (url.includes("api.telegram.org")) return { key: node.name, label: "Telegram", icon: "send", kind: "action", provider: "telegram" };
  if (url.includes("/api/ai/generate")) return { key: node.name, label: "AI", icon: "sparkles", kind: "ai" };
  if (url.includes("/scrape")) return { key: node.name, label: "Job search", icon: "layers", kind: "action" };
  if (url.includes("/api/profiles/runtime")) return { key: node.name, label: "Your profile", icon: "layers", kind: "transform" };
  if (t.includes(".if")) return { key: node.name, label: "Decide", icon: "filter", kind: "condition" };
  return null;
}

export function workflowToFlow(wf: N8nWorkflow | null | undefined): FlowItem[] {
  const nodes = ((wf?.nodes ?? []) as unknown as N8nNode[]).filter(Boolean);
  const conns = (wf?.connections ?? {}) as Record<string, { main?: { node: string }[][] }>;
  const names = nodes.map((n) => n.name);
  const targets = new Set(Object.values(conns).flatMap((o) => (o.main ?? []).flat().map((l) => l?.node)));
  const order: string[] = [];
  const queue = names.filter((n) => !targets.has(n));
  while (queue.length) {
    const cur = queue.shift()!;
    if (order.includes(cur)) continue;
    order.push(cur);
    for (const branch of conns[cur]?.main ?? []) for (const l of branch ?? []) if (l && !order.includes(l.node)) queue.push(l.node);
  }
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const out: FlowItem[] = [];
  for (const name of order) {
    const node = byName.get(name);
    if (!node || node.disabled) continue;
    const item = classify(node);
    if (!item) continue;
    // collapse repeats (two Telegram nodes on two branches read as one step)
    if (out.some((o) => o.label === item.label && o.kind === item.kind)) continue;
    out.push(item);
  }
  return out;
}

/* ------------------------------------------------------------- render */

export function FlowChips({ items, className }: { items: FlowItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((it, i) => (
        <span key={`${it.key}-${i}`} className="flex items-center gap-1">
          <span
            title={`${KIND_LABEL[it.kind]}: ${it.label}`}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-inset", KIND_TONE[it.kind])}
          >
            {it.provider ? <ProviderMark provider={it.provider} size={13} /> : <BlockIcon name={it.icon} width={13} height={13} />}
            <span className="max-w-[120px] truncate text-fg">{it.label}</span>
          </span>
          {i < items.length - 1 && <IChevronRight width={13} height={13} className="text-subtle" />}
        </span>
      ))}
    </div>
  );
}

export function FlowPipeline({ items, statuses }: { items: FlowItem[]; statuses?: Record<string, "success" | "error" | "skipped" | "running"> }) {
  return (
    <ol className="relative">
      {items.map((it, i) => {
        const st = statuses?.[it.key];
        return (
          <li key={`${it.key}-${i}`} className="relative flex gap-4 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[19px] top-11 h-[calc(100%-36px)] w-px bg-gradient-to-b from-border-strong to-border" aria-hidden="true" />}
            <span
              className={cn(
                "relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-2xl ring-1 ring-inset",
                st === "error" ? "bg-danger/15 text-danger ring-danger/30" : st === "success" ? "bg-ok/15 text-ok ring-ok/30" : KIND_TONE[it.kind],
              )}
            >
              {it.provider ? <ProviderMark provider={it.provider} size={18} /> : <BlockIcon name={it.icon} />}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{KIND_LABEL[it.kind]}</p>
              <p className="text-sm font-medium text-fg">{it.label}</p>
              {it.detail && <p className="text-xs text-muted">{it.detail}</p>}
            </div>
            {st && (
              <span className={cn("self-center text-xs font-medium", st === "success" ? "text-ok" : st === "error" ? "text-danger" : "text-subtle")}>
                {st === "success" ? "✓" : st === "error" ? "Failed" : st === "skipped" ? "Skipped" : "…"}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
