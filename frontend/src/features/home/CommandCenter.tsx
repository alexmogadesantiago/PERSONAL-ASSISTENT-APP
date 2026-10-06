/**
 * The Command Center blocks of Home: the AI command bar, "Today", "Your
 * automations" and "AI insights". Each answers one question and leads to the
 * place where you can act on it.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInsights, useOverview, useSuggestions, useDismissSuggestion, useTodaySnapshot } from "@/hooks/platform";
import { Badge, Button, ButtonLink, Card, CardTitle, Skeleton } from "@/components/ui";
import { IAlert, IBolt, ICalendar, ICheck, IClock, IMail, ISparkles } from "@/components/icons2";
import { formatMs } from "@/features/activity/ActivityList";
import { ApiError } from "@/api";
import { cn } from "@/utils/cn";

export function greeting(hour = new Date().getHours()): string {
  if (hour < 6) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 20) return "Good afternoon";
  return "Good evening";
}

const SUGGESTIONS: { label: string; ask?: string; to?: string }[] = [
  { label: "Summarize my emails", ask: "Summarize my unread emails" },
  { label: "What do I need to do today?", ask: "¿Qué tengo pendiente hoy?" },
  { label: "Create an automation", to: "/automations/new" },
  { label: "What failed today?", ask: "What automations failed today?" },
  { label: "Prepare my daily briefing", ask: "Prepare my daily briefing" },
];

/** "What would you like me to do?" - one box for everything. */
export function CommandBar() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const ask = (q: string) => navigate(`/assistant?q=${encodeURIComponent(q)}`);
  return (
    <section aria-label="Ask your assistant" className="ai-surface relative overflow-hidden rounded-2xl border border-brand/25 p-5 md:p-6">
      <div className="flex items-center gap-2 text-xs font-medium text-brand">
        <ISparkles width={15} height={15} /> Your assistant
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-fg">What would you like me to do?</h2>
      <form
        className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) ask(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask your assistant…"
          aria-label="Ask your assistant"
          className="input h-12 flex-1 bg-surface/80 text-[15px]"
        />
        <Button type="submit" variant="ai" size="lg" disabled={!text.trim()} icon={<ISparkles width={16} height={16} />}>
          Ask
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => (s.to ? navigate(s.to) : ask(s.ask as string))}
            className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted transition hover:border-brand/40 hover:text-fg"
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Tile({ to, icon, value, label, hint, tone }: { to: string; icon: React.ReactNode; value: React.ReactNode; label: string; hint?: string; tone?: "warn" | "danger" | "ok" }) {
  return (
    <Link to={to} className="card-interactive flex min-w-0 flex-col gap-1 p-3.5">
      <span className={cn("grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-muted", tone === "danger" && "bg-danger/10 text-danger", tone === "warn" && "bg-warn/10 text-warn", tone === "ok" && "bg-ok/10 text-ok")}>
        {icon}
      </span>
      <span className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</span>
      <span className="text-xs font-medium text-muted">{label}</span>
      {hint && <span className="truncate text-[11px] text-subtle">{hint}</span>}
    </Link>
  );
}

/** TODAY: important emails, events, deadlines, critical errors. */
export function TodayCard() {
  const t = useTodaySnapshot();
  const o = useOverview();
  const d = t.data;
  const needsGoogle = t.error instanceof ApiError && t.error.status === 409;
  const important = d?.important?.length ?? 0;
  const critical = o.data?.errors.critical;
  return (
    <Card>
      <CardTitle description={d?.demo ? "Demo data" : needsGoogle ? "Connect Google to see your mail and calendar here." : undefined}>Today</CardTitle>
      {t.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading today">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile to="/inbox?filter=action" icon={<IMail width={15} height={15} />} value={needsGoogle ? "–" : important} label="important emails" hint={d ? `${d.emails.length} unread` : undefined} tone={important ? "warn" : undefined} />
          <Tile to="/assistant?q=What%20is%20on%20my%20calendar%20today%3F" icon={<ICalendar width={15} height={15} />} value={needsGoogle ? "–" : d?.events.length ?? "–"} label="calendar events" />
          <Tile to="/tasks" icon={<IClock width={15} height={15} />} value={d?.deadlines?.length ?? "–"} label="deadlines" hint="this week" tone={d?.deadlines?.some((x) => x.overdue) ? "danger" : undefined} />
          <Tile to="/errors" icon={<IAlert width={15} height={15} />} value={critical ?? "–"} label="critical errors" tone={critical ? "danger" : "ok"} />
        </div>
      )}
      {d?.notes.map((n) => (
        <p key={n} className="mt-2 text-xs text-warn">{n}</p>
      ))}
    </Card>
  );
}

/** YOUR AUTOMATIONS: how many run, and how well. */
export function AutomationsCard() {
  const o = useOverview();
  const d = o.data;
  return (
    <Card>
      <CardTitle action={<Link to="/automations" className="text-xs font-medium text-brand hover:underline">Manage</Link>}>Your automations</CardTitle>
      {o.isLoading ? (
        <Skeleton className="h-20" />
      ) : d ? (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-fg">{d.automations.active}</p>
            <p className="text-xs text-muted">active</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-fg">{d.executions.success_rate_7d != null ? `${d.executions.success_rate_7d}%` : "—"}</p>
            <p className="text-xs text-muted">{d.executions.success_rate_7d != null ? "success · 7 days" : "no runs yet"}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-fg">{d.executions.today}</p>
            <p className="text-xs text-muted">
              runs today{d.executions.avg_duration_ms != null ? ` · avg ${formatMs(d.executions.avg_duration_ms)}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Automation status is unavailable right now. Your saved automations are safe.</p>
      )}
    </Card>
  );
}

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-danger",
  high: "border-l-danger",
  medium: "border-l-warn",
  low: "border-l-border-strong",
};

/** AI INSIGHTS: few, useful, each with one action. Also the best automation idea. */
export function InsightsCard() {
  const insights = useInsights();
  const suggestions = useSuggestions();
  const dismiss = useDismissSuggestion();
  const navigate = useNavigate();
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const list = insights.data ?? [];
  const idea = suggestions.data?.find((x) => !snoozed.includes(x.id ?? x.title));
  const loading = insights.isLoading;
  return (
    <Card>
      <CardTitle icon={<ISparkles width={16} height={16} />} description="Things the assistant noticed. Never more than a few.">
        AI insights
      </CardTitle>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : list.length === 0 && !idea ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <ICheck width={15} height={15} className="text-ok" /> Nothing needs you right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((i) => (
            <li key={i.id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border-l-4 bg-surface-2/60 p-3", SEVERITY_BORDER[i.severity])}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{i.title}</p>
                {i.detail && <p className="truncate text-xs text-muted">{i.detail}</p>}
              </div>
              <ButtonLink to={i.action.href} size="xs" variant="secondary">
                {i.action.label}
              </ButtonLink>
              <button
                type="button"
                className="text-xs text-subtle hover:text-fg"
                aria-label={`Hide: ${i.title}`}
                onClick={() => dismiss.mutate(`insight:${i.id}`)}
              >
                Hide
              </button>
            </li>
          ))}
          {idea && (
            <li className="rounded-xl border-l-4 border-l-brand bg-brand/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">
                  <IBolt width={11} height={11} /> automation idea
                </Badge>
              </div>
              <p className="mt-1.5 text-sm font-medium text-fg">{idea.title}</p>
              <p className="text-xs text-muted">{idea.detail}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="xs" variant="primary" onClick={() => navigate(`/automations/new?prompt=${encodeURIComponent(idea.prompt)}`)}>
                  Create automation
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSnoozed((l) => [...l, idea.id ?? idea.title])}>
                  Not now
                </Button>
                <Button size="xs" variant="ghost" onClick={() => idea.id && dismiss.mutate(idea.id)}>
                  Never suggest this
                </Button>
              </div>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** TODAY'S AGENDA: the day's events, or one button to connect the calendar. */
export function AgendaCard() {
  const t = useTodaySnapshot();
  const navigate = useNavigate();
  const needsGoogle = t.error instanceof ApiError && t.error.status === 409;
  const events = t.data?.events ?? [];
  return (
    <Card>
      <CardTitle
        icon={<ICalendar width={16} height={16} />}
        action={
          <Button size="xs" variant="secondary" onClick={() => navigate("/calendar")}>
            Open calendar
          </Button>
        }
      >
        Today's agenda
      </CardTitle>
      {t.isLoading ? (
        <Skeleton className="h-16" />
      ) : events.length > 0 ? (
        <ul className="space-y-1.5">
          {events.slice(0, 5).map((e) => (
            <li key={e.title + e.start} className="flex gap-3 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-muted">{e.start && e.start.length > 10 ? e.start.slice(11, 16) : "all day"}</span>
              <span className="text-fg">{e.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {needsGoogle || (t.data?.notes ?? []).some((n) => /not connected/i.test(n))
              ? "Connect Google to see your events here and add new ones."
              : "No events today."}
          </p>
          <Button size="sm" variant={needsGoogle ? "primary" : "secondary"} onClick={() => navigate(needsGoogle ? "/integrations/google" : "/calendar")}>
            {needsGoogle ? "Connect Google" : "Add an event"}
          </Button>
        </div>
      )}
    </Card>
  );
}
