/**
 * Settings, by section: General · Account · AI · Integrations · Automations ·
 * Notifications · Security · Privacy · Advanced.
 *
 * Desktop: section list on the left. Phone: a scrollable tab strip. Each
 * section reuses the component that already owns that configuration (AI
 * settings card, service cards, OAuth app setup) - one way to edit one thing.
 */
import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { accountApi, type Integration } from "@/api/platform";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { useToast } from "@/stores/toast";
import { n8nStateOf, useHealth, useN8nHealth, useServiceConfigs, useSystemStatus } from "@/hooks/queries";
import { useActivityFeed, useIntegrationMutations, useIntegrations } from "@/hooks/platform";
import { QueryBoundary, ServiceRow, errorMessage } from "@/components/common";
import { Avatar, Badge, Button, ButtonLink, Card, CardTitle, CopyField, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import {
  IActivity,
  IBell,
  IBolt,
  IExternal,
  IKey,
  IBrain,
  IPlay,
  ILock,
  IPalette,
  IPlug,
  IServer,
  IShield,
  ISparkles,
  IUser,
  ProviderMark,
} from "@/components/icons2";
import { ServiceConfigCard } from "@/pages/settings/ServiceConfigCard";
import { DemoSection, MemorySection, PrivacySection, SecurityCenter, SystemHealthCard } from "@/pages/settings/AssistantSections";
import { AiPage } from "@/pages/AiPage";
import { RequiredCredentials } from "@/pages/credentials/RequiredCredentials";
import { AdvancedSetupDrawer } from "@/features/integrations/ConnectFlows";
import { ActivityRow } from "@/features/activity/ActivityList";
import { API_URL, APP_ENV, N8N_URL, WS_URL } from "@/config";
import { formatDateTime, relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const SECTIONS = [
  { key: "general", label: "General", icon: IPalette },
  { key: "account", label: "Account", icon: IUser },
  { key: "ai", label: "AI", icon: ISparkles },
  { key: "memory", label: "AI memory", icon: IBrain },
  { key: "integrations", label: "Integrations", icon: IPlug },
  { key: "automations", label: "Automations", icon: IBolt },
  { key: "notifications", label: "Notifications", icon: IBell },
  { key: "security", label: "Security", icon: IShield },
  { key: "privacy", label: "Privacy", icon: ILock },
  { key: "demo", label: "Demo mode", icon: IPlay },
  { key: "advanced", label: "Advanced", icon: IServer },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- sections */

function General() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle description="Dark is the reference skin; light is just as complete.">Appearance</CardTitle>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(v) => setTheme(v)}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
      </Card>
      <Card>
        <CardTitle>Region</CardTitle>
        <dl>
          <Row label="Timezone">{Intl.DateTimeFormat().resolvedOptions().timeZone}</Row>
          <Row label="Language">{navigator.language}</Row>
        </dl>
      </Card>
      <Card>
        <CardTitle description="Work without the mouse.">Keyboard shortcuts</CardTitle>
        <dl>
          <Row label="Search, jump, run or ask">
            <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">K</kbd>
          </Row>
          <Row label="Draft an automation (in the builder)">
            <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">Enter</kbd>
          </Row>
          <Row label="Close any panel">
            <kbd className="kbd">Esc</kbd>
          </Row>
        </dl>
      </Card>
      <Card>
        <CardTitle description="Walk through the first-run setup again.">Welcome tour</CardTitle>
        <Button variant="secondary" onClick={() => navigate("/onboarding")}>
          Open the welcome tour
        </Button>
      </Card>
    </div>
  );
}

function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: accountApi.sessions });
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={user?.username ?? "?"} size={52} />
          <div>
            <p className="text-lg font-semibold text-fg">{user?.username}</p>
            <p className="text-sm text-muted">{user?.email}</p>
          </div>
          <Badge tone={user?.role === "admin" ? "brand" : "neutral"} className="ml-auto">
            {user?.role === "admin" ? "Owner · admin" : "Member"}
          </Badge>
        </div>
        <dl className="mt-4">
          <Row label="Last sign-in">{formatDateTime(user?.last_login_at)}</Row>
        </dl>
      </Card>
      <Card>
        <CardTitle description="Devices currently signed in to this account.">Active sessions</CardTitle>
        {sessions.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="divide-y divide-border">
            {(sessions.data ?? []).map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={cn("h-2 w-2 rounded-full", i === 0 ? "bg-ok" : "bg-subtle")} />
                <span className="min-w-0 flex-1 truncate text-fg">{s.user_agent || "Unknown device"}</span>
                <span className="text-xs text-muted">{s.client_ip}</span>
                <span className="w-28 text-right text-xs text-subtle">{relativeTime(s.created_at)}</span>
              </li>
            ))}
            {sessions.data?.length === 0 && <p className="text-sm text-muted">No active sessions.</p>}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Changing your password (Security) signs every session out.</p>
      </Card>
      <Button
        variant="outline"
        onClick={async () => {
          await logout();
          navigate("/login", { replace: true });
        }}
      >
        Log out of this device
      </Button>
    </div>
  );
}

function OAuthApps() {
  const integrations = useIntegrations();
  const { isAdmin } = useAuth();
  const [target, setTarget] = useState<Integration | null>(null);
  const list = (integrations.data?.data ?? []).filter((i) => i.auth === "oauth2");
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle
          description="Register each provider's OAuth app once; after that, users only see “Continue with Google”."
          action={
            <ButtonLink to="/integrations" size="sm" variant="ghost">
              Open hub
            </ButtonLink>
          }
        >
          OAuth apps
        </CardTitle>
        <ul className="divide-y divide-border">
          {list.map((i) => (
            <li key={i.key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2">
                <ProviderMark provider={i.key} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-fg">{i.label}</p>
                  <Badge tone={i.setup.available ? "success" : "neutral"} dot>
                    {i.setup.available ? `Ready (${i.setup.source})` : "Not set up"}
                  </Badge>
                </div>
                {i.setup.redirect_uri && <CopyField className="mt-2" value={i.setup.redirect_uri} label={`${i.label} redirect URI`} />}
              </div>
              {isAdmin && (
                <Button size="sm" variant={i.setup.available ? "secondary" : "primary"} onClick={() => setTarget(i)}>
                  {i.setup.available ? "Edit" : "Set up"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!isAdmin && <p className="mt-2 text-xs text-muted">Only an administrator can change OAuth apps.</p>}
      </Card>
      <Card>
        <CardTitle description="Older API keys for services without a connection flow.">API keys vault</CardTitle>
        <ButtonLink to="/settings/vault" icon={<IKey width={15} height={15} />}>
          Open the vault
        </ButtonLink>
      </Card>
      {target && <AdvancedSetupDrawer integration={target} open onClose={() => setTarget(null)} />}
    </div>
  );
}

function Automations() {
  const n8n = useN8nHealth();
  const state = n8nStateOf(n8n.data, n8n.isError);
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle
          description="Where your automations run. Normally set up by the installer."
          action={
            <ButtonLink to={N8N_URL} size="sm" variant="ghost" icon={<IExternal width={14} height={14} />}>
              Open engine
            </ButtonLink>
          }
        >
          Automation engine
        </CardTitle>
        <dl>
          <Row label="Status">
            <Badge tone={state === "online" ? "success" : state === "not_configured" ? "warning" : "danger"} dot>
              {state === "online" ? "Running" : state === "not_configured" ? "Not configured" : state === "invalid" ? "API key rejected" : "Offline"}
            </Badge>
          </Row>
          <Row label="Failure alerts">“Sistema - Gestor de errores” reports every failure to the Error Center</Row>
        </dl>
      </Card>
      <div>
        <p className="mb-2 px-1 text-sm font-medium text-fg">System assistants</p>
        <p className="mb-3 px-1 text-sm text-muted">
          The four built-in assistants (Email, Laboral, Noticias, Marca Personal) read a few values from the launcher. This is what they need.
        </p>
        <RequiredCredentials />
      </div>
    </div>
  );
}

function Notifications() {
  const integrations = useIntegrations();
  const m = useIntegrationMutations();
  const toast = useToast();
  const tg = integrations.data?.data.find((i) => i.key === "telegram");
  const chat = tg?.connection?.telegram?.chat;
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle description="Always on.">In the app</CardTitle>
        <p className="text-sm text-muted">
          The bell collects failures (with the fix), new connections, AI fallbacks and security events. Read state follows you across devices.
        </p>
      </Card>
      <Card>
        <CardTitle description="Where automations and alerts reach you.">Telegram</CardTitle>
        {chat ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <ProviderMark provider="telegram" size={24} />
            <div className="flex-1">
              <p className="text-sm font-medium text-fg">{chat.title}</p>
              <p className="text-xs text-muted">via @{tg?.connection?.telegram?.bot.username}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={m.telegramTestMessage.isPending}
              onClick={() =>
                m.telegramTestMessage
                  .mutateAsync()
                  .then(() => toast.success("Test sent", "Check Telegram."))
                  .catch((e) => toast.error("Could not send", errorMessage(e)))
              }
            >
              Send a test
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Not linked yet.</p>
            <ButtonLink to="/integrations/telegram" size="sm" variant="primary">
              Link Telegram
            </ButtonLink>
          </div>
        )}
        <p className="mt-3 text-xs text-subtle">
          The system assistants also send failure alerts through their own bots (or TELEGRAM_TOKEN_ALERTAS), at most once per hour per error.
        </p>
      </Card>
    </div>
  );
}

function Security() {
  const toast = useToast();
  const feed = useActivityFeed("security");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { logout } = useAuth();
  const navigate = useNavigate();
  const change = useMutation({ mutationFn: () => accountApi.changePassword(current, next) });
  const mismatch = confirm.length > 0 && confirm !== next;

  return (
    <div className="space-y-4">
      <SecurityCenter />
      <Card>
        <CardTitle description="All other sessions are signed out when you change it.">Password</CardTitle>
        <form
          className="grid gap-3 sm:max-w-md"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await change.mutateAsync();
              toast.success("Password changed", "Sign in again with the new password.");
              await logout();
              navigate("/login", { replace: true });
            } catch (err) {
              toast.error("Could not change it", errorMessage(err));
            }
          }}
        >
          <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 10 characters, with upper and lower case and a digit." />
          <Input label="Repeat new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? "Passwords do not match" : undefined} />
          <div>
            <Button type="submit" loading={change.isPending} disabled={!current || !next || next !== confirm}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardTitle
          action={
            <Link to="/activity" className="text-xs font-medium text-brand hover:underline">
              All activity
            </Link>
          }
        >
          Recent security events
        </CardTitle>
        {feed.isLoading ? (
          <Skeleton className="h-24" />
        ) : (feed.data?.data.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">No security events yet.</p>
        ) : (
          <div className="-mx-2">
            {feed.data!.data.slice(0, 8).map((i) => (
              <ActivityRow key={i.id} item={i} dense />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Advanced() {
  const { isAdmin } = useAuth();
  const health = useHealth();
  const status = useSystemStatus();
  const serviceConfigs = useServiceConfigs();
  return (
    <div className="space-y-4">
      <SystemHealthCard />
      <Card>
        <CardTitle description="Point the platform at your own engine and scraper. Applies on the next health check.">Services</CardTitle>
        <QueryBoundary isLoading={serviceConfigs.isLoading} isError={serviceConfigs.isError} error={serviceConfigs.error} onRetry={() => serviceConfigs.refetch()} skeletonRows={3}>
          <div className="grid gap-4 lg:grid-cols-2">
            {(serviceConfigs.data ?? [])
              .filter((c) => (c.category ?? "infra") === "infra")
              .map((c) => (
                <ServiceConfigCard key={c.service} config={c} canEdit={isAdmin} />
              ))}
          </div>
        </QueryBoundary>
      </Card>
      <Card>
        <CardTitle
          action={
            <div className="flex gap-1">
              <ButtonLink to="/monitoring" size="xs" variant="ghost" icon={<IActivity width={13} height={13} />}>
                Monitoring
              </ButtonLink>
              <ButtonLink to="/logs" size="xs" variant="ghost">
                Logs
              </ButtonLink>
            </div>
          }
        >
          System
        </CardTitle>
        <dl>
          <Row label="Backend version">{health.data?.version ?? "—"}</Row>
          <Row label="Environment">
            {health.data?.environment ?? "—"} · panel {APP_ENV}
          </Row>
          <Row label="Database">{health.data?.database ?? "—"}</Row>
          <Row label="API">
            <code className="font-mono text-xs">{API_URL}</code>
          </Row>
          <Row label="Live updates">
            <code className="font-mono text-xs">{WS_URL}</code>
          </Row>
        </dl>
        <div className="mt-3 border-t border-border pt-2">
          {status.data?.services?.map((s) => (
            <ServiceRow key={s.name} name={s.name} status={s.status} online={s.online} latency={s.latency_ms} detail={s.detail} checkedAt={s.checked_at} />
          ))}
        </div>
      </Card>
    </div>
  );
}

const RENDER: Record<SectionKey, () => JSX.Element> = {
  general: General,
  account: Account,
  ai: () => <AiPage embedded />,
  integrations: OAuthApps,
  automations: Automations,
  notifications: Notifications,
  security: Security,
  privacy: PrivacySection,
  memory: MemorySection,
  demo: DemoSection,
  advanced: Advanced,
};

export function SettingsPage() {
  const { section = "general" } = useParams();
  const key = (SECTIONS.some((s) => s.key === section) ? section : "general") as SectionKey;
  const Section = RENDER[key];
  const meta = SECTIONS.find((s) => s.key === key)!;
  return (
    <div>
      <PageHeader eyebrow="Settings" title={meta.label} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {SECTIONS.map(({ key: k, label, icon: Icon }) => (
            <NavLink
              key={k}
              to={`/settings/${k}`}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition",
                  isActive || (k === "general" && !section) ? "bg-surface-2 font-medium text-fg ring-1 ring-inset ring-border" : "text-muted hover:bg-surface-2/60 hover:text-fg",
                )
              }
            >
              <Icon width={16} height={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div key={key} className="animate-in-up min-w-0">
          <Section />
        </div>
      </div>
    </div>
  );
}
