/**
 * Home - the Command Center.
 *
 * Answers, in order: what is happening (Today), what is the assistant doing
 * (automations, services), what should I do (AI insights) and - front and
 * centre - what would you like it to do (the command bar). Every number comes
 * from `/api/overview` (n8n runs, connections, the error centre, AI usage);
 * when a source is missing the card says so instead of showing a zero.
 */
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHealth } from "@/hooks/queries";
import { useActivityFeed, useOverview } from "@/hooks/platform";
import { useAuth } from "@/stores/auth";
import { ButtonLink, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui";
import { IActivity, IAlert, IArrowRight, ProviderMark } from "@/components/icons2";
import { cn } from "@/utils/cn";
import { WeekChart } from "@/features/home/WeekChart";
import { SetupChecklist, useSetupProgress } from "@/features/home/setup";
import { ActivityRow } from "@/features/activity/ActivityList";
import { BriefingCard, ServiceStrip } from "@/features/home/Briefing";
import { AutomationsCard, CommandBar, InsightsCard, TodayCard, greeting } from "@/features/home/CommandCenter";
import { wasOnboarded } from "./OnboardingPage";

export function DashboardPage() {
  const { user } = useAuth();
  const health = useHealth();
  const o = useOverview();
  const feed = useActivityFeed("all");
  const setup = useSetupProgress();
  const navigate = useNavigate();
  const d = o.data;

  // A brand-new installation starts with the welcome tour, once.
  useEffect(() => {
    if (!setup.loading && setup.done === 0 && !wasOnboarded()) navigate("/onboarding", { replace: true });
  }, [setup.loading, setup.done, navigate]);
  const stateTone = d?.system.state === "operational" ? "bg-ok" : d?.system.state === "degraded" ? "bg-warn" : "bg-danger";

  return (
    <div className="space-y-6">
      {health.isError && (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Unable to connect to the Automation Center backend.
        </div>
      )}

      <section className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">
          {greeting()}, {user?.username ?? "there"}
        </h1>
        <p className="flex items-center gap-2 text-sm text-muted">
          {o.isLoading ? (
            <Skeleton className="h-4 w-56" />
          ) : (
            <>
              <span className={cn("h-2 w-2 rounded-full", stateTone)} />
              {d ? (d.system.state === "operational" ? "Your assistant is ready." : d.system.message) : "Status unavailable."}
            </>
          )}
        </p>
      </section>

      <CommandBar />

      <div className="grid gap-4 lg:grid-cols-2">
        <TodayCard />
        <AutomationsCard />
      </div>

      <ServiceStrip />

      <InsightsCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <BriefingCard />

          <Card>
            <CardTitle
              description={
                d?.n8n.available === false ? `Run history unavailable: ${d.n8n.error}` : "Runs per day · AI requests in teal"
              }
              action={
                d && (
                  <span className="text-xs text-muted">
                    <b className="text-fg">{d.ai.requests_today}</b> AI requests today
                  </span>
                )
              }
            >
              This week
            </CardTitle>
            {o.isLoading ? <Skeleton className="h-[170px] w-full" /> : d && <WeekChart series={d.executions.series} ai={d.ai.series} />}
          </Card>

          <Card>
            <CardTitle
              action={
                <Link to="/activity" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                  All activity <IArrowRight width={13} height={13} />
                </Link>
              }
            >
              Today's activity
            </CardTitle>
            {feed.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (feed.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                icon={<IActivity />}
                title="Quiet so far"
                description="Runs, connections and AI actions will show up here as they happen."
              />
            ) : (
              <div className="-mx-2">
                {feed.data!.data.slice(0, 8).map((item) => (
                  <ActivityRow key={item.id} item={item} dense />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {(d?.errors.top.length ?? 0) > 0 && (
            <Card className="border-danger/25">
              <CardTitle icon={<IAlert width={16} height={16} />} description="Fixing these keeps your automations running.">
                Needs your attention
              </CardTitle>
              <ul className="space-y-3">
                {d!.errors.top.map((e) => (
                  <li key={e.id} className="rounded-xl bg-surface-2/60 p-3">
                    <p className="text-sm font-medium text-fg">{e.title}</p>
                    {e.automation && <p className="text-xs text-muted">{e.automation}</p>}
                    <ButtonLink to={e.action.href} size="xs" variant="primary" className="mt-2">
                      {e.action.label}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!setup.complete && (
            <Card>
              <CardTitle description="A few minutes and your assistant is ready.">Get set up</CardTitle>
              <SetupChecklist compact />
            </Card>
          )}

          <Card>
            <CardTitle
              action={
                <Link to="/integrations" className="text-xs font-medium text-brand hover:underline">
                  Manage
                </Link>
              }
            >
              Integrations
            </CardTitle>
            {d ? (
              <>
                <p className="text-sm text-muted">
                  <b className="text-2xl font-semibold text-fg">{d.integrations.connected}</b> of {d.integrations.total} connected
                </p>
                <div className="mt-3 flex gap-2">
                  {(["google", "telegram", "microsoft", "github"] as const).map((p) => {
                    const bad = d.integrations.unhealthy.find((u) => u.key === p);
                    return (
                      <Link
                        key={p}
                        to={`/integrations/${p}`}
                        title={bad ? `${bad.label}: ${bad.health}` : p}
                        className={cn(
                          "relative grid h-10 w-10 place-items-center rounded-xl bg-surface-2 ring-1 ring-inset ring-border transition hover:ring-border-strong",
                        )}
                      >
                        <ProviderMark provider={p} size={20} />
                        {bad && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface" />}
                      </Link>
                    );
                  })}
                </div>
              </>
            ) : (
              <Skeleton className="h-16" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
