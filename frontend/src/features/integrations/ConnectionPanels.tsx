/**
 * Credentials 2.0 building blocks for the connection page.
 *
 *  - ConnectionOverview : account, authentication, permissions, usage, last check
 *  - CredentialHealth   : authentication / API / permissions / token, each ✓ ! ✕
 *  - TestProgress       : the four checks, shown as they run
 *  - PermissionsCenter  : exactly what each service may do, grouped by service
 *  - DisconnectDialog   : what would stop working, before anything is revoked
 *
 * All of it is derived from data the page already has, plus one call for the
 * dependencies. No secret or token is ever part of it.
 */
import { useEffect, useState } from "react";
import type { Integration } from "@/api/platform";
import { useDependencies } from "@/hooks/platform";
import { Badge, Button, Card, CardTitle, HealthBadge, Skeleton } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { ICheck, IShieldCheck } from "@/components/icons2";
import { ServiceIcon, isUnhealthy } from "@/features/integrations/meta";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

export function ConnectionOverview({ i }: { i: Integration }) {
  const c = i.connection;
  if (!c) return null;
  const granted = c.permissions.filter((p) => p.granted).length;
  const account = c.account.email || (c.telegram ? `@${c.telegram.bot.username}` : "") || c.account.login || c.account.name || "—";
  const cells: [string, React.ReactNode][] = [
    ["Account", <span key="a" className="truncate">{account}</span>],
    ["Authentication", c.security.method],
    ["Permissions", i.key === "telegram" ? "Send and receive messages" : `${granted} granted`],
    ["Used by", `${i.used_by.length} automation${i.used_by.length === 1 ? "" : "s"}`],
    ["Last verified", c.last_tested_at ? relativeTime(c.last_tested_at) : "Never"],
  ];
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <HealthBadge state={i.status} />
        <span className="text-sm font-medium text-fg">{i.connected ? "Connected" : "Not connected"}</span>
        {c.health_detail && isUnhealthy(i.status) && <span className="text-xs text-danger">{c.health_detail}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-subtle">{k}</dt>
            <dd className="mt-0.5 truncate text-sm text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

type Mark = "ok" | "warn" | "fail";

export function CredentialHealth({ i }: { i: Integration }) {
  const c = i.connection;
  if (!c) return null;
  const bad = i.status === "expired" || i.status === "auth_required";
  const requested = c.requested_services.length ? c.requested_services : c.services;
  const missing = requested.filter((s) => !c.services.includes(s));
  const rows: { label: string; mark: Mark; text: string }[] = [
    { label: "Authentication", mark: bad ? "fail" : "ok", text: bad ? "Expired - sign in again" : "Valid" },
    {
      label: "API access",
      mark: i.status === "error" ? "fail" : i.status === "degraded" ? "warn" : c.last_test && !c.last_test.ok ? "fail" : "ok",
      text: i.status === "error" ? "Not answering" : i.status === "degraded" ? "Slow or partial" : "Available",
    },
    { label: "Permissions", mark: missing.length ? "warn" : "ok", text: missing.length ? `Missing: ${missing.join(", ")}` : "Valid" },
  ];
  if (i.auth === "oauth2") {
    rows.push({
      label: "Token",
      mark: c.security.refresh ? "ok" : "warn",
      text: c.security.refresh ? "Refreshing automatically" : "Cannot refresh - you will be asked to sign in again",
    });
  }
  return (
    <Card>
      <CardTitle icon={<IShieldCheck width={16} height={16} />} description="Checked every time something uses this connection.">Credential health</CardTitle>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2 rounded-xl bg-surface-2/60 p-3 text-sm">
            <span className={cn("mt-0.5 font-semibold", r.mark === "ok" ? "text-ok" : r.mark === "warn" ? "text-warn" : "text-danger")} aria-label={r.mark}>
              {r.mark === "ok" ? "✓" : r.mark === "warn" ? "!" : "✕"}
            </span>
            <span>
              <span className="block font-medium text-fg">{r.label}</span>
              <span className="block text-xs text-muted">{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STEPS = ["Checking authentication…", "Checking API…", "Checking permissions…", "Checking service…"];

/** The four checks, advancing while the real test runs; replaced by the result when it lands. */
export function TestProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 600);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-border bg-surface-2/50 p-4">
      <ul className="space-y-1.5">
        {STEPS.map((label, n) => (
          <li key={label} className={cn("flex items-center gap-2 text-sm transition", n <= step ? "text-fg" : "text-subtle")}>
            {n < step ? <ICheck width={14} height={14} className="text-ok" /> : n === step ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden="true" /> : <span className="w-3.5" />}
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PermissionsCenter({ i, onManage }: { i: Integration; onManage: () => void }) {
  const c = i.connection;
  if (!c) return null;
  return (
    <Card>
      <CardTitle description="Exactly what each service may do. Nothing more is ever requested silently.">Permissions</CardTitle>
      <div className="space-y-4">
        {i.services.map((s) => {
          const perms = c.permissions.filter((p) => p.service === s.key);
          if (perms.length === 0) return null;
          const on = perms.every((p) => p.granted);
          return (
            <section key={s.key} aria-label={s.label}>
              <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <ServiceIcon service={s.key} size={15} /> {s.label}
                {!on && <Badge tone="neutral">not allowed</Badge>}
              </h4>
              <ul className="mt-1.5 space-y-1">
                {perms.map((p) => (
                  <li key={p.scope} className="flex items-center gap-2 text-sm">
                    <span className={p.granted ? "text-ok" : "text-subtle"} aria-label={p.granted ? "granted" : "not granted"}>{p.granted ? "✓" : "○"}</span>
                    <span className={p.granted ? "text-fg" : "text-subtle"}>{p.label}</span>
                    <Badge tone={p.access === "write" ? "warning" : "neutral"} className="ml-auto">{p.access}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {i.key !== "telegram" && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={onManage}>Change permissions</Button>
          <span className="text-xs text-muted">Untick a service when you reconnect to revoke just that access. Disconnecting revokes everything at the provider.</span>
        </div>
      )}
    </Card>
  );
}

export function DisconnectDialog({ i, open, onClose, onConfirm }: { i: Integration; open: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const deps = useDependencies(i.key, open);
  const [busy, setBusy] = useState(false);
  const d = deps.data;
  const nothing = !!d && d.automations.length === 0 && d.features.length === 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Disconnect ${i.label}?`}
      description="Access is revoked at the provider and the saved tokens are deleted. You can reconnect at any time."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </Button>
        </>
      }
    >
      {deps.isError ? (
        <p className="text-sm text-muted">Could not check what depends on it. Disconnecting stops anything that uses {i.label}.</p>
      ) : !d ? (
        <Skeleton className="h-24" />
      ) : nothing ? (
        <p className="text-sm text-muted">Nothing you have set up uses it right now.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-fg">This will affect:</p>
          <ul className="space-y-1 text-fg">
            <li>• {d.automations.length} automation{d.automations.length === 1 ? "" : "s"}{d.automations.length ? `: ${d.automations.slice(0, 3).map((a) => a.name).join(", ")}${d.automations.length > 3 ? "…" : ""}` : ""}</li>
            <li>• {d.scheduled} scheduled or automatic task{d.scheduled === 1 ? "" : "s"}</li>
            <li>• {d.features.length} assistant feature{d.features.length === 1 ? "" : "s"}</li>
          </ul>
          {d.features.length > 0 && (
            <ul className="rounded-xl bg-surface-2/60 p-3 text-xs text-muted">
              {d.features.map((f) => (
                <li key={f}>– {f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
