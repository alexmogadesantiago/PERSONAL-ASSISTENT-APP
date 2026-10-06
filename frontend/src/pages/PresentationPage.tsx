/**
 * Presentation view: a clean walkthrough of the product for the TDR defence.
 *
 * Always sample data (`/api/assistant/demo/showcase`), labelled as such, so it
 * can be shown without exposing a single personal email or credential. It is
 * independent of the demo-mode switch and never touches a real account.
 */
import { Link } from "react-router-dom";
import { useShowcase } from "@/hooks/platform";
import { Badge, Button, Skeleton } from "@/components/ui";
import { IAlert, IBolt, ICalendar, ICheck, IMail, ISparkles } from "@/components/icons2";
import { BrandMark } from "@/layouts/AppLayout";
import { formatMs } from "@/features/activity/ActivityList";

function Slide({ n, title, lead, children }: { n: number; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mx-auto w-full max-w-5xl scroll-mt-6 px-4 py-10 md:py-14">
      <p className="eyebrow">{String(n).padStart(2, "0")}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg md:text-3xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-muted">{lead}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

const FLOW = ["Windows", "Docker", "Backend", "PostgreSQL", "n8n", "Gmail · Gemini · Telegram"];

export function PresentationPage() {
  const q = useShowcase();
  const d = q.data;
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur-md">
        <BrandMark size={28} />
        <span className="text-sm font-semibold text-fg">Personal Assistant</span>
        <Badge tone="accent">Demo data</Badge>
        <span className="flex-1" />
        <Link to="/dashboard" className="text-sm text-muted hover:text-fg">
          Exit presentation
        </Link>
      </header>

      <section className="ai-surface mx-auto mt-6 w-full max-w-5xl rounded-3xl border border-brand/20 px-6 py-14 text-center md:py-20">
        <p className="text-sm font-medium text-brand">Personal Assistant 3.0</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-fg md:text-5xl">
          A personal operating system powered by AI and automation
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          It reads your email, understands what matters, proposes actions and automates your day - local-first, with you always in control.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted">
          {FLOW.map((f, i) => (
            <span key={f} className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-surface px-3 py-1">{f}</span>
              {i < FLOW.length - 1 && <span aria-hidden="true">→</span>}
            </span>
          ))}
        </div>
      </section>

      {q.isLoading || !d ? (
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <Slide n={1} title="It understands your inbox" lead="Gemini reads each email: priority, category, deadline and what to do - and explains why.">
            <ul className="card divide-y divide-border">
              {d.emails.map((m, i) => (
                <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                  <IMail width={16} height={16} className="mt-1 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.subject}</p>
                    <p className="truncate text-xs text-muted">{m.from.split("<")[0]} · {m.snippet}</p>
                  </div>
                  {i === 0 && (
                    <div className="hidden shrink-0 text-right text-xs sm:block">
                      <Badge tone="danger" dot>Priority: urgent</Badge>
                      <ul className="mt-1.5 space-y-0.5 text-left text-muted">
                        <li><ICheck width={11} height={11} className="mr-1 inline text-ok" />Known important sender</li>
                        <li><ICheck width={11} height={11} className="mr-1 inline text-ok" />Deadline within 48 hours</li>
                        <li><ICheck width={11} height={11} className="mr-1 inline text-ok" />Requires a response</li>
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Slide>

          <Slide n={2} title="It knows your day" lead="Calendar, deadlines and a daily briefing that also arrives on Telegram.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="card p-4">
                <p className="eyebrow mb-2">Today</p>
                {d.events.map((e) => (
                  <p key={e.title} className="flex gap-3 py-1 text-sm text-fg">
                    <ICalendar width={15} height={15} className="mt-0.5 text-muted" />
                    <span className="w-11 tabular-nums text-muted">{e.start.slice(11, 16)}</span>
                    {e.title}
                  </p>
                ))}
              </div>
              <div className="card p-4">
                <p className="eyebrow mb-2">Deadlines</p>
                {d.deadlines.map((x) => (
                  <p key={x.title} className="py-1 text-sm text-fg">
                    {x.title} <span className="text-muted">· {new Date(x.due).toLocaleDateString(undefined, { weekday: "long" })}</span>
                  </p>
                ))}
                <p className="mt-3 text-xs text-muted">The assistant detects them in email and reminds you before they pass.</p>
              </div>
            </div>
          </Slide>

          <Slide n={3} title="Automations that actually run" lead="Built in plain language, executed by n8n, monitored without opening it.">
            <ul className="grid gap-3 md:grid-cols-2">
              {d.automations.map((a) => (
                <li key={a.name} className="card p-4">
                  <div className="flex items-center gap-2">
                    <IBolt width={15} height={15} className="text-brand" />
                    <p className="flex-1 text-sm font-semibold text-fg">{a.name}</p>
                    <Badge tone="success" dot>Healthy</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{a.flow}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-subtle">Success</dt><dd className="text-sm tabular-nums text-fg">{a.success_rate}%</dd></div>
                    <div><dt className="text-subtle">Runs</dt><dd className="text-sm tabular-nums text-fg">{a.runs}</dd></div>
                    <div><dt className="text-subtle">Avg</dt><dd className="text-sm tabular-nums text-fg">{formatMs(a.avg_duration_ms)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          </Slide>

          <Slide n={4} title="When something fails, it tells you why" lead="A timeline of every step, the cause, the impact and the one thing to do next.">
            <div className="grid gap-4 md:grid-cols-2">
              {d.executions.map((ex) => (
                <div key={ex.id} className="card p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {ex.automation}
                    <Badge tone={ex.status === "success" ? "success" : "danger"} dot>{ex.status === "success" ? "Completed" : "Failed"}</Badge>
                  </p>
                  <ol className="mt-3 space-y-2">
                    {ex.steps.map((s) => (
                      <li key={s.label} className="flex items-start gap-2 text-sm">
                        <span className="w-12 shrink-0 text-xs tabular-nums text-subtle">{s.at ? s.at.slice(11, 19) : "--:--"}</span>
                        <span className={s.status === "success" ? "text-ok" : s.status === "error" ? "text-danger" : "text-subtle"}>
                          {s.status === "success" ? "✓" : s.status === "error" ? "✕" : "·"}
                        </span>
                        <span className="text-fg">{s.label}{s.error && <span className="block text-xs text-danger">{s.error}</span>}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            {d.errors.map((e) => (
              <div key={e.id} className="mt-4 flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn/5 p-4">
                <IAlert className="mt-0.5 text-warn" />
                <div className="text-sm">
                  <p className="font-semibold text-fg">{e.title}</p>
                  <p className="text-muted">Cause: {e.cause}</p>
                  <p className="text-muted">Suggested: retry the request.</p>
                </div>
              </div>
            ))}
          </Slide>

          <Slide n={5} title="You stay in control" lead="The AI proposes; you confirm; the system executes. Credentials are encrypted and never shown.">
            <ul className="grid gap-3 md:grid-cols-3">
              {[
                ["Human in the loop", "Sending an email, archiving or disconnecting always asks first - on the web and in Telegram."],
                ["OAuth, least privilege", "Gmail read + send, Calendar events. Revocable at any time, with a list of what would stop working."],
                ["Local-first", "Docker on your machine. Your data stays in PostgreSQL; Privacy shows exactly what the AI receives."],
              ].map(([t, b]) => (
                <li key={t} className="card p-4">
                  <ISparkles width={16} height={16} className="text-brand" />
                  <p className="mt-2 text-sm font-semibold text-fg">{t}</p>
                  <p className="mt-1 text-sm text-muted">{b}</p>
                </li>
              ))}
            </ul>
            <div className="mt-8 text-center">
              <Link to="/dashboard"><Button variant="primary">Back to the app</Button></Link>
            </div>
          </Slide>
        </>
      )}
    </div>
  );
}
