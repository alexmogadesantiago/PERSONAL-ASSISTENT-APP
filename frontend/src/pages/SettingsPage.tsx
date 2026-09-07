import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { n8nStateOf, useHealth, useN8nHealth, useServiceConfigs, useSystemStatus } from "@/hooks/queries";
import { Badge, Card, CardTitle, PageHeader, Select } from "@/components/ui";
import { QueryBoundary, ServiceRow } from "@/components/common";
import { ServiceConfigCard } from "@/pages/settings/ServiceConfigCard";
import { AiSettingsCard } from "@/pages/settings/AiSettingsCard";
import { API_URL, APP_ENV, WS_URL } from "@/config";
import { formatDateTime } from "@/utils/format";

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const health = useHealth();
  const status = useSystemStatus();
  const n8n = useN8nHealth();
  const n8nState = n8nStateOf(n8n.data, n8n.isError);
  const serviceConfigs = useServiceConfigs();
  const canEdit = user?.role === "admin";

  return (
    <div>
      <PageHeader title="Settings" description="Preferences and connections. No secret is ever shown here." />

      <div className="mb-4">
        <AiSettingsCard canEdit={!!canEdit} />
      </div>

      <Card className="mb-4">
        <CardTitle>Services</CardTitle>
        <p className="mb-3 text-xs text-muted">
          Point the platform at your own n8n and scraper. Saved here, these values take precedence
          over the server environment and apply on the next health check — no redeploy, no{" "}
          <code>.env</code> editing. AI providers live in their own section above.
        </p>
        <QueryBoundary
          isLoading={serviceConfigs.isLoading}
          isError={serviceConfigs.isError}
          error={serviceConfigs.error}
          onRetry={() => serviceConfigs.refetch()}
          skeletonRows={3}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {(serviceConfigs.data ?? [])
              // AI providers and the internal settings row are owned by the
              // Artificial Intelligence card above; showing them again as
              // generic URL + key cards would be two ways to edit one thing.
              .filter((config) => (config.category ?? "infra") === "infra")
              .map((config) => (
                <ServiceConfigCard key={config.service} config={config} canEdit={!!canEdit} />
              ))}
          </div>
        </QueryBoundary>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>General</CardTitle>
          <div className="space-y-3">
            <Select
              label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
            <div className="text-sm">
              <p className="label">Timezone</p>
              <p className="text-fg">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            </div>
            <div className="text-sm">
              <p className="label">Language</p>
              <p className="text-fg">{navigator.language}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Account & security</CardTitle>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Username</dt>
              <dd className="text-fg">{user?.username}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Email</dt>
              <dd className="text-fg">{user?.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge tone={user?.role === "admin" ? "brand" : "neutral"}>{user?.role}</Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Last login</dt>
              <dd className="text-fg">{formatDateTime(user?.last_login_at)}</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
            Password change and 2FA are managed by your administrator in this release.
          </p>
        </Card>

        <Card>
          <CardTitle>Integrations</CardTitle>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Backend API</dt>
              <dd className="truncate font-mono text-xs text-fg">{API_URL}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">WebSocket</dt>
              <dd className="truncate font-mono text-xs text-fg">{WS_URL}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">n8n</dt>
              <dd>
                <Badge
                  tone={
                    n8nState === "offline"
                      ? "danger"
                      : n8nState === "not_configured"
                        ? "warning"
                        : n8nState === "online"
                          ? "success"
                          : "neutral"
                  }
                >
                  {n8nState === "not_configured" ? "not configured" : n8nState}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">n8n base URL</dt>
              <dd className="truncate font-mono text-xs text-fg">{n8n.data?.base_url ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>System</CardTitle>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Frontend env</dt>
              <dd className="text-fg">{APP_ENV}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Backend version</dt>
              <dd className="text-fg">{health.data?.version ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Backend env</dt>
              <dd className="text-fg">{health.data?.environment ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Database</dt>
              <dd className="text-fg">{health.data?.database ?? "—"}</dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-border pt-2">
            {status.data?.services.map((s) => (
              <ServiceRow
                key={s.name}
                name={s.name}
                status={s.status}
                online={s.online}
                latency={s.latency_ms}
                detail={s.detail}
                checkedAt={s.checked_at}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
