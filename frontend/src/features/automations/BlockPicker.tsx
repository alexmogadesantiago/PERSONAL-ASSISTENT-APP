import { useMemo, useState } from "react";
import type { Block, BlockKind, Integration } from "@/api/platform";
import { Drawer } from "@/components/ui";
import { BlockIcon, ISearch, ProviderMark } from "@/components/icons2";
import { cn } from "@/utils/cn";
import { KIND_LABEL, KIND_TONE } from "./flow";

const GROUPS: { kind: BlockKind; title: string; hint: string }[] = [
  { kind: "trigger", title: "When", hint: "What starts the automation" },
  { kind: "condition", title: "If", hint: "Keep only what matters" },
  { kind: "ai", title: "AI", hint: "Let the assistant read, decide or write" },
  { kind: "action", title: "Then", hint: "Do something in a connected service" },
  { kind: "transform", title: "Combine", hint: "Reshape the items" },
];

export function BlockPicker({
  open,
  onClose,
  blocks,
  kinds,
  integrations,
  onPick,
  title,
}: {
  open: boolean;
  onClose: () => void;
  blocks: Block[];
  kinds: BlockKind[];
  integrations: Integration[];
  onPick: (b: Block) => void;
  title: string;
}) {
  const [q, setQ] = useState("");
  const connected = useMemo(() => new Map(integrations.map((i) => [i.key, i])), [integrations]);
  const filtered = blocks.filter(
    (b) => kinds.includes(b.kind) && (!q || `${b.label} ${b.description} ${b.provider ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <Drawer open={open} onClose={onClose} title={title} width="md">
      <div className="relative mb-4">
        <ISearch className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" width={16} height={16} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search blocks…"
          aria-label="Search blocks"
          className="input pl-9"
        />
      </div>
      <div className="space-y-6">
        {GROUPS.filter((g) => kinds.includes(g.kind)).map((g) => {
          const items = filtered.filter((b) => b.kind === g.kind);
          if (!items.length) return null;
          return (
            <section key={g.kind}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset", KIND_TONE[g.kind])}>
                  {KIND_LABEL[g.kind]}
                </span>
                <span className="text-xs text-muted">{g.hint}</span>
              </div>
              <div className="grid gap-2">
                {items.map((b) => {
                  const i = b.provider ? connected.get(b.provider) : undefined;
                  const needs = b.provider && !(i?.connected && (!b.service || i.connection?.services.includes(b.service) || i.key === "telegram"));
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => onPick(b)}
                      className="flex items-center gap-3 rounded-2xl border border-border p-3 text-left transition hover:border-brand/40 hover:bg-brand/[0.04]"
                    >
                      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset", KIND_TONE[b.kind])}>
                        {b.provider ? <ProviderMark provider={b.provider} size={17} /> : <BlockIcon name={b.icon} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{b.label}</span>
                        <span className="block truncate text-xs text-muted">{b.description}</span>
                      </span>
                      {needs && <span className="shrink-0 rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn">Connect {i?.label.split(" ")[0] ?? b.provider}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">No block matches “{q}”.</p>}
      </div>
    </Drawer>
  );
}
