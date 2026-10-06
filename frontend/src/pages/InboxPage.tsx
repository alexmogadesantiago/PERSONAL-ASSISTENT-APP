/**
 * Inbox - Gmail through the assistant.
 *
 * Search with Gmail syntax, filter by what the AI found (needs action, has a
 * deadline, category, important sender), open a message to see the analysis and
 * its reasons, and act: reply (confirmed), task, calendar, archive, automate.
 * Every action uses the Google connection from the Integrations Hub.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { assistantApi, type MailItem } from "@/api/platform";
import { ApiError } from "@/api";
import { useMail } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { ICalendar, ICheck, IMail, IRefresh, ISearch, ISparkles, ProviderMark } from "@/components/icons2";
import { MailDetail, senderName } from "@/features/assistant/MailDetail";
import { PriorityBadge } from "@/features/assistant/PriorityBadge";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const VIEWS = {
  unread: "in:inbox is:unread",
  inbox: "in:inbox",
  important: "is:important newer_than:14d",
  attachments: "has:attachment newer_than:30d",
} as const;
type View = keyof typeof VIEWS;

type Filter = "action" | "deadline" | "analyzed" | "sender";
const FILTERS: { key: Filter; label: string; test: (m: MailItem) => boolean }[] = [
  { key: "action", label: "Requires action", test: (m) => m.triage?.action_required === true },
  { key: "deadline", label: "Deadline detected", test: (m) => !!m.triage?.deadline },
  { key: "analyzed", label: "AI analyzed", test: (m) => !!m.triage },
  { key: "sender", label: "Important sender", test: (m) => m.important_sender === true },
];

export function InboxPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>("unread");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState<string>(VIEWS.unread);
  const [filters, setFilters] = useState<Filter[]>(() => {
    const f = params.get("filter");
    return f === "action" ? ["action"] : [];
  });
  const [category, setCategory] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const mail = useMail(query);
  const notConnected = mail.error instanceof ApiError && mail.error.status === 409;
  const items = useMemo(() => mail.data?.data ?? [], [mail.data]);
  const demo = mail.data?.demo === true;

  const visible = useMemo(() => {
    let out = items;
    for (const f of filters) out = out.filter(FILTERS.find((x) => x.key === f)!.test);
    if (category !== "all") out = out.filter((m) => m.triage?.category === category);
    return out;
  }, [items, filters, category]);

  const categories = useMemo(() => Array.from(new Set(items.map((m) => m.triage?.category).filter(Boolean))) as string[], [items]);
  const open = items.find((m) => m.id === openId) ?? null;
  const pending = items.filter((m) => !m.triage).slice(0, 6);

  const analyzeVisible = useMutation({
    mutationFn: async () => {
      let done = 0;
      for (const m of pending) {
        await assistantApi.analyze(m.id);
        done += 1;
        await qc.invalidateQueries({ queryKey: ["assistant", "mail"] });
      }
      return done;
    },
    onSuccess: (n) => toast.success(`Analyzed ${n} email${n === 1 ? "" : "s"}`, "Priority and deadlines are now shown in the list."),
    onError: (e) => toast.error("Analysis stopped", errorMessage(e)),
  });

  const toggle = (f: Filter) => setFilters((l) => (l.includes(f) ? l.filter((x) => x !== f) : [...l, f]));

  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title="Your email, with an assistant"
        description="Search, triage with AI, see why something is important, and turn emails into tasks, reminders and automations."
        actions={
          <>
            {pending.length > 0 && !notConnected && (
              <Button
                variant="ai"
                loading={analyzeVisible.isPending}
                icon={<ISparkles width={15} height={15} />}
                onClick={() => analyzeVisible.mutate()}
              >
                {analyzeVisible.isPending ? "Analyzing…" : `Analyze ${pending.length} with AI`}
              </Button>
            )}
            <Button variant="ghost" onClick={() => mail.refetch()} loading={mail.isFetching} icon={<IRefresh width={15} height={15} />}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <Segmented
          label="Mailbox view"
          value={view}
          size="sm"
          onChange={(v) => {
            setView(v);
            setQ("");
            setQuery(VIEWS[v]);
          }}
          options={[
            { value: "unread", label: "Unread" },
            { value: "inbox", label: "Inbox" },
            { value: "important", label: "Important" },
            { value: "attachments", label: "Attachments" },
          ]}
        />
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) setQuery(q.trim());
          }}
        >
          <ISearch className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" width={15} height={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="from:profesor subject:TDR  (Gmail search)" aria-label="Search mail" className="input pl-9" />
        </form>
      </div>

      {!notConnected && items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filters.includes(f.key)}
              onClick={() => toggle(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition",
                filters.includes(f.key) ? "bg-brand/15 text-brand ring-brand/30" : "bg-surface text-muted ring-border hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
          {categories.length > 0 && (
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="input h-8 w-auto py-0 text-xs">
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {notConnected ? (
        <EmptyState
          icon={<ProviderMark provider="google" size={24} />}
          title="Connect Google to use your inbox"
          description={errorMessage(mail.error)}
          action={<ButtonLink to="/integrations/google" variant="primary">Connect Google</ButtonLink>}
        />
      ) : mail.isLoading ? (
        <div className="card space-y-2 p-3" aria-busy="true" aria-label="Loading your email">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : mail.isError ? (
        <EmptyState
          icon={<IMail />}
          title="Your email could not be reached"
          description={`${errorMessage(mail.error)} Your saved automations and tasks are not affected.`}
          action={<Button onClick={() => mail.refetch()}>Try again</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<IMail />} title="Nothing here" description="No email matches this view. Try Inbox or another search." />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IMail />}
          title="No email matches these filters"
          description="Filters use what the AI found, so analyze your emails first."
          action={<Button variant="secondary" onClick={() => { setFilters([]); setCategory("all"); }}>Clear filters</Button>}
        />
      ) : (
        <ul className="card divide-y divide-border overflow-hidden">
          {visible.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpenId(m.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-2/60">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", m.unread ? "bg-brand" : "bg-transparent")} aria-label={m.unread ? "unread" : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn("truncate text-sm", m.unread ? "font-semibold text-fg" : "text-fg")}>{senderName(m.from)}</span>
                    <span className="shrink-0 text-xs text-subtle">{relativeTime(m.date ? new Date(m.date).toISOString() : null)}</span>
                  </span>
                  <span className="block truncate text-sm text-fg">
                    {m.subject}
                    {m.has_attachments && " 📎"}
                  </span>
                  <span className="block truncate text-xs text-muted">{m.snippet}</span>
                  {(m.triage || m.important_sender) && (
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {m.triage?.level && <PriorityBadge level={m.triage.level} />}
                      {m.triage?.category && <Badge tone="brand">{m.triage.category}</Badge>}
                      {m.triage?.action_required && <Badge tone="warning">needs action</Badge>}
                      {m.triage?.deadline && (
                        <Badge tone="info">
                          <ICalendar width={11} height={11} /> deadline
                        </Badge>
                      )}
                      {m.important_sender && (
                        <Badge tone="success">
                          <ICheck width={11} height={11} /> important sender
                        </Badge>
                      )}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {demo && <p className="mt-3 text-center text-xs text-muted">Demo mode: these are sample emails. Nothing is sent or changed.</p>}
      {open && <MailDetail m={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
