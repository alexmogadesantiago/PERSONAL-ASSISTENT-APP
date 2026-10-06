/**
 * Activity Center - everything the assistant and you did, in one timeline:
 * runs, AI, integrations, errors and security events. Filter by kind, search,
 * open any row for its details.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivityCategory, ActivityItem } from "@/api/platform";
import { useActivityFeed } from "@/hooks/platform";
import { QueryBoundary } from "@/components/common";
import { Button, Drawer, EmptyState, PageHeader, Skeleton, Tabs } from "@/components/ui";
import { IActivity, ISearch } from "@/components/icons2";
import { ActivityRow, formatMs } from "@/features/activity/ActivityList";
import { formatDateTime } from "@/utils/format";

const FILTERS: { value: ActivityCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "automations", label: "Automations" },
  { value: "ai", label: "AI" },
  { value: "integrations", label: "Integrations" },
  { value: "errors", label: "Errors" },
  { value: "security", label: "Security" },
];

function dayLabel(iso: string | null): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function ActivityPage() {
  const [category, setCategory] = useState<ActivityCategory>("all");
  const [q, setQ] = useState("");
  const [service, setService] = useState("");
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const feed = useActivityFeed(category);
  const navigate = useNavigate();

  const groups = useMemo(() => {
    const items = (feed.data?.data ?? []).filter(
      (i) =>
        (!q || `${i.title} ${i.message} ${i.service}`.toLowerCase().includes(q.toLowerCase())) &&
        (!service || `${i.service} ${i.message} ${i.kind}`.toLowerCase().includes(service)),
    );
    const out: { day: string; items: ActivityItem[] }[] = [];
    for (const it of items) {
      const day = dayLabel(it.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(it);
      else out.push({ day, items: [it] });
    }
    return out;
  }, [feed.data, q, service]);

  return (
    <div>
      <PageHeader
        eyebrow="Activity"
        title="What happened"
        description="Every run, AI action, connection change and security event - newest first."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs label="Filter activity" value={category} onChange={setCategory} items={FILTERS} className="flex-1 border-b-0" />
        <div className="relative sm:w-64">
          <ISearch className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" width={15} height={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity" aria-label="Search activity" className="input pl-9" />
        </div>
      </div>
      <div className="-mt-1 mb-4 flex flex-wrap gap-1.5">
        {[["", "All services"], ["google", "Gmail"], ["telegram", "Telegram"], ["ai", "AI"], ["asistente", "n8n assistants"]].map(([v, l]) => (
          <button
            key={l}
            type="button"
            onClick={() => setService(v)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset transition ${service === v ? "bg-brand/15 text-brand ring-brand/30" : "text-muted ring-border hover:text-fg"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {feed.data && !feed.data.sources.n8n && (
        <p className="mb-4 rounded-xl bg-surface-2/70 px-3 py-2 text-xs text-muted">
          Run history is not available right now ({feed.data.sources.n8n_error ?? "automation engine unreachable"}). Other activity is shown.
        </p>
      )}
      <QueryBoundary isLoading={false} isError={feed.isError} error={feed.error} onRetry={() => feed.refetch()}>
        {feed.isLoading ? (
          <div className="card space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState icon={<IActivity />} title="Nothing here yet" description={q ? `No activity matches “${q}”.` : "Activity appears as your automations run."} />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.day}>
                <p className="eyebrow mb-2 px-1">{g.day}</p>
                <div className="card p-2">
                  {g.items.map((it) => (
                    <button key={it.id} type="button" className="block w-full text-left" onClick={() => setOpen(it)}>
                      <ActivityRow item={{ ...it, link: null }} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </QueryBoundary>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.title ?? ""}
        description={open?.message}
        footer={
          open?.link ? (
            <Button
              onClick={() => {
                const to = open.link!;
                setOpen(null);
                navigate(to);
              }}
            >
              Open
            </Button>
          ) : undefined
        }
      >
        {open && (
          <dl className="space-y-3 text-sm">
            {[
              ["When", formatDateTime(open.at)],
              ["Category", open.category],
              ["Result", open.result],
              ["Service", open.service || "—"],
              ["Duration", open.duration_ms != null ? formatMs(open.duration_ms) : "—"],
              ...Object.entries(open.details)
                .filter(([, v]) => v != null && v !== "")
                .map(([k, v]) => [k.replace(/_/g, " "), String(v)]),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border/60 pb-2">
                <dt className="capitalize text-muted">{k}</dt>
                <dd className="break-all text-right text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Drawer>
    </div>
  );
}
