/**
 * Integrations Hub.
 *
 * The four pillars as cards: what each one unlocks, whether it is connected and
 * healthy, which permissions it holds, how many automations depend on it, when
 * it last synced - and the one action that matters right now. Credentials are
 * never shown; the security strip says how they are protected.
 */
import { Link, useNavigate } from "react-router-dom";
import type { Integration } from "@/api/platform";
import { useIntegrations, useOverview } from "@/hooks/platform";
import { QueryBoundary } from "@/components/common";
import { Badge, Button, HealthBadge, PageHeader, Skeleton } from "@/components/ui";
import { IArrowRight, IKey, ILock, IRefresh, IShieldCheck, ProviderMark } from "@/components/icons2";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { isUnhealthy, primaryAction, ServiceIcon } from "@/features/integrations/meta";
import { useConnectFlow } from "@/features/integrations/useConnectFlow";

export { useConnectFlow };
import { PlatformCards } from "@/features/home/Briefing";

export function IntegrationCard({ i, onConnect }: { i: Integration; onConnect: (i: Integration) => void }) {
  const navigate = useNavigate();
  const action = primaryAction(i);
  const granted = new Set(i.connection?.services ?? []);
  const lastSync = i.connection?.last_sync_at ?? i.connection?.last_tested_at ?? i.connection?.connected_at;
  const overview = useOverview();
  const messagesToday = overview.data?.telegram?.messages_today;
  return (
    <article
      className={cn(
        "card-interactive group relative flex min-w-0 flex-col overflow-hidden p-5",
        isUnhealthy(i.status) && "border-danger/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 ring-1 ring-inset ring-border">
            <ProviderMark provider={i.key} size={26} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-fg">
              <Link to={`/integrations/${i.key}`} className="hover:underline">
                {i.label}
              </Link>
            </h3>
            <p className="text-xs text-muted">{i.tagline}</p>
          </div>
        </div>
        <HealthBadge state={i.status} />
      </div>

      <p className="mt-4 text-sm text-muted">{i.description}</p>

      {i.connection?.account && (i.connection.account.email || i.connection.account.login || i.connection.account.name) && (
        <p className="mt-3 truncate text-xs text-subtle">
          Signed in as <span className="text-fg">{i.connection.account.email || i.connection.account.login || i.connection.account.name}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {i.services.map((s) => {
          const on = granted.has(s.key);
          return (
            <span
              key={s.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-inset transition",
                on ? "bg-ok/10 text-fg ring-ok/25" : "bg-surface-2 text-subtle ring-border",
              )}
              title={on ? `${s.label}: allowed` : `${s.label}: not allowed`}
            >
              <ServiceIcon service={s.key} size={13} />
              {s.label}
              {on && <span className="text-ok">✓</span>}
            </span>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted">
        <div className="space-y-0.5">
          <p>
            Used by <b className="text-fg">{i.used_by.length}</b> automation{i.used_by.length === 1 ? "" : "s"}
          </p>
          {i.connected && <p className="text-subtle">{lastSync ? `Last sync ${relativeTime(lastSync)}` : "Not used yet"}</p>}
          {i.key === "telegram" && i.connected && messagesToday != null && (
            <p>
              <b className="text-fg">{messagesToday}</b> message{messagesToday === 1 ? "" : "s"} today
            </p>
          )}
        </div>
        {action.intent === "manage" ? (
          <Button variant="secondary" size="sm" onClick={() => navigate(`/integrations/${i.key}`)}>
            Manage <IArrowRight width={14} height={14} />
          </Button>
        ) : (
          <Button
            size="sm"
            variant={action.intent === "reconnect" ? "danger" : "primary"}
            icon={action.intent === "reconnect" ? <IRefresh width={14} height={14} /> : undefined}
            onClick={() => onConnect(i)}
          >
            {action.label}
          </Button>
        )}
      </div>
    </article>
  );
}

export function IntegrationsPage() {
  const q = useIntegrations();
  const flow = useConnectFlow();
  const list = q.data?.data ?? [];
  const connected = list.filter((i) => i.connected).length;
  const attention = list.filter((i) => isUnhealthy(i.status)).length;

  return (
    <div>
      <PageHeader
        eyebrow="Integrations"
        title="Connect your services"
        description="Your assistant works with the accounts you connect here. Sign in once - it keeps the connection healthy for you."
        actions={
          <Link to="/settings/vault" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
            <IKey width={15} height={15} /> API keys vault
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <span className="text-2xl font-semibold tabular-nums text-fg">{q.isLoading ? "–" : connected}</span>
          <span className="text-sm text-muted">of {list.length || 4} connected</span>
        </div>
        <div className={cn("card flex items-center gap-3 p-4", attention && "border-danger/30")}>
          <span className={cn("text-2xl font-semibold tabular-nums", attention ? "text-danger" : "text-fg")}>{q.isLoading ? "–" : attention}</span>
          <span className="text-sm text-muted">need attention</span>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <IShieldCheck className="text-ok" />
          <span className="text-sm text-muted">OAuth 2.0 · encrypted at rest · auto-refresh</span>
        </div>
      </div>

      {q.data && !q.data.store_configured && (
        <div className="mb-5 rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm text-warn">
          The credential store has no encryption key, so connections cannot be saved. Set AC_CREDENTIAL_ENCRYPTION_KEY (the installer does this).
        </div>
      )}

      <QueryBoundary isLoading={false} isError={q.isError} error={q.error} onRetry={() => q.refetch()}>
        <div className="stagger grid gap-4 md:grid-cols-2">
          {q.isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[300px] rounded-2xl" />)
            : list.map((i) => <IntegrationCard key={i.key} i={i} onConnect={flow.open} />)}
        </div>
      </QueryBoundary>

      <section className="mt-8">
        <p className="eyebrow mb-3 px-1">Assistant platform</p>
        <PlatformCards />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {[
          { icon: <ILock />, title: "Nothing to copy", text: "Sign in with the provider. No client secrets, tokens or chat ids to paste." },
          { icon: <IShieldCheck />, title: "Least privilege", text: "Pick the services to allow. Drive only sees files the assistant creates." },
          { icon: <IRefresh />, title: "Always fresh", text: "Tokens refresh automatically. If a provider revokes access, you'll know first." },
        ].map((f) => (
          <div key={f.title} className="flex gap-3 rounded-2xl border border-border p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">{f.icon}</span>
            <div>
              <p className="text-sm font-medium text-fg">{f.title}</p>
              <p className="text-xs text-muted">{f.text}</p>
            </div>
          </div>
        ))}
      </section>
      <p className="mt-6 text-center text-xs text-subtle">
        <Badge tone="neutral">Tip</Badge> Press <kbd className="kbd">Ctrl K</kbd> and type a service name to jump to it.
      </p>
      {flow.drawers}
    </div>
  );
}
