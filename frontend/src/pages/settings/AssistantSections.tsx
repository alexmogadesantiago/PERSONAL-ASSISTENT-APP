/**
 * Settings sections that make the assistant inspectable:
 *  - AI memory   : what it remembers - view, edit, delete. Never secrets.
 *  - Privacy     : who has access, what is sent to the AI, what stays local.
 *  - Security    : a live checklist with the fix for every item that fails.
 *  - System health: backend, database, n8n, AI, Gmail and Telegram.
 *  - Demo mode   : sample data for presentations, clearly separate from real use.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useMemoryMutations,
  useMemoryOverview,
  usePrivacy,
  useSecurity,
  useSystemHealth,
} from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, Card, CardTitle, Input, Skeleton, Switch } from "@/components/ui";
import { ICheck, IEdit, IShieldCheck, ISparkles, ITrash } from "@/components/icons2";
import { formatDateTime, relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------- AI memory */

export function MemorySection() {
  const toast = useToast();
  const mem = useMemoryOverview();
  const m = useMemoryMutations();
  const [sender, setSender] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const prefs = mem.data?.preferences ?? {};
  const senders = (mem.data?.items ?? []).filter((i) => i.kind === "sender");
  const notes = (mem.data?.items ?? []).filter((i) => i.kind === "note");
  const hidden = (mem.data?.items ?? []).filter((i) => i.kind === "dismissed");

  const save = (key: string, value: string | boolean) =>
    m.setPreference.mutate({ key, value }, { onError: (e) => toast.error("Could not save", errorMessage(e)) });
  const add = (kind: "sender" | "note", value: string, lbl = "") =>
    m.add.mutate(
      { kind, value, label: lbl },
      {
        onSuccess: () => {
          if (kind === "sender") { setSender(""); setLabel(""); } else setNote("");
        },
        onError: (e) => toast.error("Not saved", errorMessage(e)),
      },
    );

  if (mem.isLoading) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle icon={<ISparkles width={16} height={16} />} description="The assistant uses these to personalise briefings, priority and Telegram.">
          Preferences
        </CardTitle>
        <dl>
          <Row label="Preferred briefing time">
            <input
              type="time"
              aria-label="Preferred briefing time"
              className="input h-9 w-32"
              value={String(prefs.briefing_time ?? "08:00")}
              onChange={(e) => e.target.value && save("briefing_time", e.target.value)}
            />
          </Row>
          <Row label="Send the daily briefing automatically">
            <Switch label="Send the daily briefing automatically" checked={prefs.briefing_auto === true} onChange={(v) => save("briefing_auto", v)} />
          </Row>
          <Row label="Preferred notification channel">
            <select aria-label="Preferred notification channel" className="input h-9 w-40" value={String(prefs.notification_channel ?? "telegram")} onChange={(e) => save("notification_channel", e.target.value)}>
              <option value="telegram">Telegram</option>
              <option value="web">In the app only</option>
            </select>
          </Row>
          <Row label="Email summaries">
            <Switch label="AI email summaries" checked={prefs.email_summaries !== false} onChange={(v) => save("email_summaries", v)} />
          </Row>
          <Row label="Proactive insights">
            <Switch label="Proactive insights" checked={prefs.proactive !== false} onChange={(v) => save("proactive", v)} />
          </Row>
          <Row label="Assistant language">
            <select aria-label="Assistant language" className="input h-9 w-40" value={String(prefs.language ?? "auto")} onChange={(e) => save("language", e.target.value)}>
              <option value="auto">Same as I write</option>
              <option value="es">Español</option>
              <option value="ca">Català</option>
              <option value="en">English</option>
            </select>
          </Row>
        </dl>
      </Card>

      <Card>
        <CardTitle description="Emails from these senders are ranked higher, and shown as important.">Important senders</CardTitle>
        <form
          className="mb-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (sender.trim()) add("sender", sender.trim(), label.trim());
          }}
        >
          <Input aria-label="Sender address or domain" placeholder="marta@school.edu or @school.edu" value={sender} onChange={(e) => setSender(e.target.value)} />
          <Input aria-label="Label" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" disabled={!sender.trim()} loading={m.add.isPending}>Add</Button>
        </form>
        {senders.length === 0 ? (
          <p className="text-sm text-muted">No important senders yet. Add your tutor, your boss or your family.</p>
        ) : (
          <ul className="divide-y divide-border">
            {senders.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{s.key}</span>
                  {s.value && <span className="block text-xs text-muted">{s.value}</span>}
                </span>
                <Button size="xs" variant="ghost" icon={<ITrash width={13} height={13} />} aria-label={`Remove ${s.key}`} onClick={() => m.remove.mutate(s.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle description="Short facts you want it to know. Never passwords, tokens or card numbers - those are refused.">Notes</CardTitle>
        <form
          className="mb-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) add("note", note.trim());
          }}
        >
          <Input aria-label="New note" placeholder="My TDR tutor is Marta Puig" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" disabled={!note.trim()} loading={m.add.isPending}>Remember</Button>
        </form>
        {notes.length === 0 ? (
          <p className="text-sm text-muted">Nothing remembered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center gap-2 py-2">
                {editing?.id === n.id ? (
                  <>
                    <Input aria-label="Edit note" value={editing.value} onChange={(e) => setEditing({ id: n.id, value: e.target.value })} />
                    <Button
                      size="xs"
                      onClick={() =>
                        m.edit.mutate({ id: n.id, value: editing.value }, { onSuccess: () => setEditing(null), onError: (e) => toast.error("Not saved", errorMessage(e)) })
                      }
                    >
                      Save
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-sm text-fg">{n.value}</span>
                    <Button size="xs" variant="ghost" icon={<IEdit width={13} height={13} />} aria-label="Edit note" onClick={() => setEditing({ id: n.id, value: n.value })}>Edit</Button>
                    <Button size="xs" variant="ghost" icon={<ITrash width={13} height={13} />} aria-label="Delete note" onClick={() => m.remove.mutate(n.id)}>Delete</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle description="What else is stored about how you use the assistant.">Other memory</CardTitle>
        <dl>
          <Row label="Hidden suggestions and insights">
            {hidden.length} <Button size="xs" variant="ghost" disabled={!hidden.length} onClick={() => m.forget.mutate("dismissed")}>Show them again</Button>
          </Row>
          <Row label="Priority cache (level and deadline per email, never the text)">
            {mem.data?.counts.triage ?? 0} <Button size="xs" variant="ghost" disabled={!mem.data?.counts.triage} onClick={() => m.forget.mutate("triage")}>Clear</Button>
          </Row>
        </dl>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- privacy */

export function PrivacySection() {
  const p = usePrivacy();
  if (p.isLoading || !p.data) return <Skeleton className="h-64" />;
  const d = p.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle description="Connected services and exactly what each one is allowed to do.">Who has access</CardTitle>
        {d.access.length === 0 ? (
          <p className="text-sm text-muted">Nothing is connected. <Link className="text-brand hover:underline" to="/integrations">Connect a service</Link></p>
        ) : (
          <ul className="space-y-3">
            {d.access.map((a) => (
              <li key={a.key} className="rounded-xl bg-surface-2/60 p-3">
                <p className="text-sm font-medium text-fg">
                  {a.service} {a.account && <span className="font-normal text-muted">· {a.account}</span>}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {a.permissions.map((perm) => (
                    <li key={perm} className="flex items-center gap-2 text-sm text-fg">
                      <ICheck width={13} height={13} className="text-ok" /> {perm}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle description={d.ai.configured ? `Provider: ${d.ai.provider} (${d.ai.model || "default model"})` : "No AI provider is configured."}>
          What is sent to the AI
        </CardTitle>
        <ul className="space-y-2">
          {d.ai.data.map((x) => (
            <li key={x.feature} className="rounded-xl bg-surface-2/60 p-3 text-sm">
              <p className="font-medium text-fg">{x.feature}</p>
              <p className="text-muted">Sends: {x.sent}</p>
              <p className="text-xs text-subtle">{x.when}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-medium text-muted">Never sent</p>
        <ul className="mt-1 space-y-0.5 text-sm text-fg">
          {d.ai.never.map((n) => (
            <li key={n}>✓ {n}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle description="Everything below lives in this installation's database or this browser.">What stays local</CardTitle>
        <dl>
          <Row label="Tasks">{d.stored.tasks}</Row>
          <Row label="Memory items">{d.stored.memory}</Row>
          <Row label="Cached priorities">{d.stored.priority_cache}</Row>
          <Row label="Automations">{d.stored.automations}</Row>
          <Row label="Activity events">{d.stored.activity_events}</Row>
        </dl>
        <ul className="mt-3 space-y-0.5 text-sm text-muted">
          {d.stored.local_only.map((x) => (
            <li key={x}>• {x}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-medium text-muted">Retention</p>
        <ul className="mt-1 space-y-0.5 text-sm text-muted">
          {d.retention.map((x) => (
            <li key={x}>• {x}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-subtle">Telemetry / analytics: none.</p>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- security */

const STATUS_STYLE = { ok: "text-ok", warn: "text-warn", fail: "text-danger" } as const;
const STATUS_MARK = { ok: "✓", warn: "!", fail: "✕" } as const;

export function SecurityCenter() {
  const s = useSecurity();
  return (
    <Card>
      <CardTitle
        icon={<IShieldCheck width={16} height={16} />}
        description={s.data ? `Last security check: ${relativeTime(s.data.checked_at)}` : "Checking…"}
        action={
          s.data && (
            <Badge tone={s.data.status === "ok" ? "success" : s.data.status === "warn" ? "warning" : "danger"} dot>
              {s.data.status === "ok" ? "All good" : "Needs a look"}
            </Badge>
          )
        }
      >
        Security center
      </CardTitle>
      {s.isLoading || !s.data ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-border">
          {s.data.checks.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className={cn("w-4 text-center font-semibold", STATUS_STYLE[c.status])} aria-label={c.status}>{STATUS_MARK[c.status]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{c.label}</span>
                <span className="block text-xs text-muted">{c.detail}</span>
              </span>
              {c.action && (
                <ButtonLink to={c.action.href} size="xs" variant="secondary">
                  {c.action.label}
                </ButtonLink>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* --------------------------------------------------------- system health */

const HEALTH_DOT: Record<string, string> = {
  healthy: "bg-ok", connected: "bg-ok", unhealthy: "bg-danger", offline: "bg-danger", degraded: "bg-warn",
  expired: "bg-danger", auth_required: "bg-danger", error: "bg-danger", not_configured: "bg-subtle", not_connected: "bg-subtle",
};

export function SystemHealthCard() {
  const h = useSystemHealth();
  return (
    <Card>
      <CardTitle description={h.data ? `Checked ${relativeTime(h.data.checked_at)}` : undefined} action={<Button size="xs" variant="ghost" loading={h.isFetching} onClick={() => h.refetch()}>Check again</Button>}>
        System health
      </CardTitle>
      {h.isLoading || !h.data ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-border">
          {h.data.items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[i.status] ?? "bg-warn")} aria-hidden="true" />
              <span className="w-28 shrink-0 text-sm text-fg">{i.label}</span>
              <span className="text-sm capitalize text-muted">{i.status.replace(/_/g, " ")}</span>
              {i.detail && <span className="ml-auto hidden truncate text-xs text-subtle sm:block">{i.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- demo mode */

export function DemoSection() {
  const toast = useToast();
  const mem = useMemoryOverview();
  const m = useMemoryMutations();
  const on = mem.data?.preferences?.demo_mode === true;
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle description="For presentations: show the product without exposing your own mail or accounts.">Demo mode</CardTitle>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-fg">{on ? "Demo mode is ON" : "Demo mode is off"}</p>
            <p className="text-sm text-muted">
              While it is on, Inbox, analysis, briefing, insights and the chat use a sample day: 5 emails, 3 events, 1 deadline, 4 automations, 2 runs and 1 error.
              Nothing is sent, nothing in Google changes, and a banner shows on every screen.
            </p>
          </div>
          <Switch
            label="Demo mode"
            checked={on}
            onChange={(v) => m.setPreference.mutate({ key: "demo_mode", value: v }, { onSuccess: () => toast.info(v ? "Demo mode on" : "Demo mode off", v ? "Showing sample data." : "Showing your real data.") })}
          />
        </div>
      </Card>
      <Card>
        <CardTitle description="A clean, full-screen walkthrough of the main features. Always sample data.">Presentation view</CardTitle>
        <ButtonLink to="/presentation" variant="primary">Open the presentation view</ButtonLink>
      </Card>
      <p className="text-xs text-subtle">Last changed {mem.data ? formatDateTime(new Date().toISOString()) : ""}. Real credentials are never used or shown in demo mode.</p>
    </div>
  );
}
