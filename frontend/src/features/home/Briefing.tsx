/**
 * Daily briefing (Home) and the "platform" cards: the AI provider and the
 * automation engine, shown next to the integrations because the user thinks of
 * them as services too - "Gemini · connected · 37 requests · 1.8 s".
 */
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { assistantApi } from "@/api/platform";
import { n8nStateOf, useAiConfig, useAiHealth, useN8nHealth } from "@/hooks/queries";
import { useIntegrations, useOverview } from "@/hooks/platform";
import { errorMessage } from "@/components/common";
import { Button, ButtonLink, Card, CardTitle, HealthBadge, Skeleton, type HealthState } from "@/components/ui";
import { useToast } from "@/stores/toast";
import { IBolt, ISparkles, ProviderMark } from "@/components/icons2";
import { cn } from "@/utils/cn";
import { formatMs } from "@/features/activity/ActivityList";

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        {title}
        {count != null && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">{count}</span>}
      </h4>
      <div className="mt-1.5 text-sm">{children}</div>
    </section>
  );
}

/** Daily briefing 2.0: what matters today, in sections, with an AI summary. */
export function BriefingCard() {
  const toast = useToast();
  const b = useMutation({ mutationFn: () => assistantApi.briefing(true) });
  const tg = useMutation({
    mutationFn: assistantApi.briefingToTelegram,
    onSuccess: (r) => (r.sent ? toast.success("Briefing sent to Telegram") : toast.info("Demo mode", r.message)),
    onError: (e) => toast.error("Could not send it", errorMessage(e)),
  });
  const d = b.data;
  const important = d?.important ?? [];
  return (
    <Card className="ai-surface border-brand/20">
      <CardTitle icon={<ISparkles width={16} height={16} />} description="Important mail, your calendar, deadlines and automation health - summarised.">
        Daily briefing
      </CardTitle>
      <div className="-mt-2 mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={d ? "ghost" : "ai"} loading={b.isPending} onClick={() => b.mutate()}>
          {d ? "Refresh" : "Generate my briefing"}
        </Button>
        {d && (
          <Button size="sm" variant="ghost" loading={tg.isPending} onClick={() => tg.mutate()}>
            Send to Telegram
          </Button>
        )}
      </div>
      {!d && !b.isPending && !b.isError && (
        <p className="text-sm text-muted">Press the button and the assistant reads your mail and calendar. It can also arrive on Telegram every morning - set the time in Settings › AI memory.</p>
      )}
      {b.isPending && (
        <div className="space-y-2" aria-busy="true" aria-label="Preparing your briefing">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16" />
          <p className="text-xs text-muted">Reading your mail and calendar…</p>
        </div>
      )}
      {b.isError && <p className="text-sm text-danger">{errorMessage(b.error)}</p>}
      {d && (
        <div className="animate-in-up space-y-3">
          <p className="text-base font-semibold text-fg">
            {d.greeting ?? "Hello"}. <span className="font-normal text-muted">Here is what matters today.</span>
          </p>
          <Section title="Important emails" count={important.length}>
            {important.length === 0 ? (
              <p className="text-muted">{d.emails.length ? `${d.emails.length} unread, none flagged important.` : "Nothing unread."}</p>
            ) : (
              <ul className="space-y-0.5">
                {important.slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <Link to={`/inbox?id=${m.id}`} className="text-fg hover:underline">{m.subject}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Calendar" count={d.events.length}>
            {d.events.length === 0 ? (
              <p className="text-muted">No events today.</p>
            ) : (
              <ul className="space-y-0.5">
                {d.events.slice(0, 5).map((e) => (
                  <li key={e.title + e.start} className="flex gap-2">
                    <span className="w-11 shrink-0 tabular-nums text-muted">{e.start?.slice(11, 16) || "all day"}</span>
                    <span className="text-fg">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Deadlines" count={d.deadlines?.length ?? 0}>
            {(d.deadlines ?? []).length === 0 ? (
              <p className="text-muted">No deadlines this week.</p>
            ) : (
              <ul className="space-y-0.5">
                {d.deadlines!.slice(0, 3).map((x) => (
                  <li key={x.title + x.due}>
                    <Link to={x.href} className="text-fg hover:underline">{x.title}</Link>{" "}
                    <span className="text-muted">· {new Date(x.due).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Automations">
            <p className={d.problems.length ? "text-warn" : "text-muted"}>
              {d.automations?.message || (d.problems.length ? `${d.problems.length} alert(s)` : "All systems healthy.")}
            </p>
          </Section>
          {d.summary && (
            <Section title="AI summary">
              <p className="leading-relaxed text-fg">{d.summary}</p>
            </Section>
          )}
          {d.notes.map((n) => (
            <p key={n} className="text-xs text-warn">{n}</p>
          ))}
          <p className="text-[11px] text-subtle">Generated {new Date(d.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{d.demo ? " · demo data" : ""}</p>
        </div>
      )}
    </Card>
  );
}

/** Gmail · Gemini/AI · Telegram · n8n at a glance. */
export function ServiceStrip() {
  const integrations = useIntegrations();
  const ai = useAiHealth();
  const n8n = useN8nHealth();
  const list = integrations.data?.data ?? [];
  const google = list.find((i) => i.key === "google");
  const tg = list.find((i) => i.key === "telegram");
  const n8nState = n8nStateOf(n8n.data, n8n.isError);
  const items: { key: string; label: string; to: string; mark: string; state: HealthState }[] = [
    { key: "gmail", label: "Gmail", to: "/integrations/google", mark: "google", state: google?.connection?.services.includes("gmail") ? google.status : "not_connected" },
    { key: "ai", label: ai.data?.provider ? `AI · ${ai.data.provider}` : "AI", to: "/settings/ai", mark: "ai", state: ai.data?.status === "online" ? "healthy" : ai.data?.status === "degraded" ? "degraded" : ai.data?.status === "not_configured" ? "not_connected" : ai.data ? "error" : "unknown" },
    { key: "telegram", label: "Telegram", to: "/integrations/telegram", mark: "telegram", state: tg?.status ?? "unknown" },
    { key: "n8n", label: "n8n engine", to: "/settings/automations", mark: "n8n", state: n8nState === "online" ? "healthy" : n8nState === "not_configured" ? "not_connected" : n8nState === "unknown" ? "unknown" : "error" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((s) => (
        <Link key={s.key} to={s.to} className="card-interactive flex items-center gap-3 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2">
            {s.mark === "n8n" ? <IBolt width={17} height={17} className="text-brand" /> : <ProviderMark provider={s.mark} size={18} />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{s.label}</p>
            <HealthBadge state={s.state} />
          </div>
        </Link>
      ))}
    </div>
  );
}

/** AI provider + automation engine, as cards in the Integrations Hub. */
export function PlatformCards() {
  const ai = useAiHealth();
  const cfg = useAiConfig();
  const n8n = useN8nHealth();
  const o = useOverview();
  const n8nState = n8nStateOf(n8n.data, n8n.isError);
  const aiState: HealthState = ai.data?.status === "online" ? "healthy" : ai.data?.status === "not_configured" ? "not_connected" : ai.data?.status === "degraded" ? "degraded" : ai.data ? "error" : "unknown";
  const names: Record<string, string> = { gemini: "Gemini", nvidia_nim: "NVIDIA NIM", openrouter: "OpenRouter" };
  const providerName = names[cfg.data?.provider ?? ""] ?? "AI provider";
  const card = "card flex min-w-0 flex-col p-5";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-accent text-white"><ISparkles /></span>
            <div>
              <h3 className="text-[15px] font-semibold text-fg">{providerName}</h3>
              <p className="text-xs text-muted">The assistant's intelligence</p>
            </div>
          </div>
          <HealthBadge state={aiState} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="min-w-0"><dt className="text-xs text-subtle">Model</dt><dd className="truncate text-fg">{cfg.data?.model || "default"}</dd></div>
          <div><dt className="text-xs text-subtle">Requests today</dt><dd className="tabular-nums text-fg">{o.data?.ai.requests_today ?? "–"}</dd></div>
          <div><dt className="text-xs text-subtle">Avg latency</dt><dd className="tabular-nums text-fg">{o.data?.ai.avg_latency_ms ? formatMs(o.data.ai.avg_latency_ms) : "—"}</dd></div>
          <div><dt className="text-xs text-subtle">Errors today</dt><dd className="tabular-nums text-fg">{o.data?.ai.errors_today ?? 0}</dd></div>
        </dl>
        <div className="mt-4 flex justify-end border-t border-border pt-4">
          <ButtonLink to="/settings/ai" size="sm" variant={aiState === "healthy" ? "secondary" : "primary"}>{aiState === "not_connected" ? "Connect" : "Manage"}</ButtonLink>
        </div>
      </article>
      <article className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-brand ring-1 ring-inset ring-border"><IBolt /></span>
            <div>
              <h3 className="text-[15px] font-semibold text-fg">n8n</h3>
              <p className="text-xs text-muted">Automation engine (runs in the background)</p>
            </div>
          </div>
          <HealthBadge state={n8nState === "online" ? "healthy" : n8nState === "not_configured" ? "not_connected" : n8nState === "unknown" ? "unknown" : "error"} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-subtle">Workflows</dt><dd className="tabular-nums text-fg">{o.data?.automations.total ?? "–"}</dd></div>
          <div><dt className="text-xs text-subtle">Executions today</dt><dd className="tabular-nums text-fg">{o.data?.executions.today ?? "–"}</dd></div>
          <div><dt className="text-xs text-subtle">Success rate</dt><dd className="tabular-nums text-fg">{o.data?.executions.success_rate_7d != null ? `${o.data.executions.success_rate_7d}%` : "—"}</dd></div>
          <div><dt className="text-xs text-subtle">Failed today</dt><dd className="tabular-nums text-fg">{o.data?.executions.failed_today ?? "–"}</dd></div>
        </dl>
        <div className={cn("mt-4 flex justify-end gap-2 border-t border-border pt-4")}>
          <ButtonLink to="/settings/automations" size="sm" variant="ghost">Settings</ButtonLink>
          <ButtonLink to="/engine" size="sm" variant="secondary">Open</ButtonLink>
        </div>
      </article>
    </div>
  );
}
