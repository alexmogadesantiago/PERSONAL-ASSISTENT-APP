import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { serviceRank, useMonitorWebSocket } from "@/hooks/useMonitorWebSocket";
import { useForceServiceCheck, useSystemStatus } from "@/hooks/queries";
import { Badge, Button, Card, CardTitle, PageHeader, Sparkline, StatusDot } from "@/components/ui";
import { STATUS_META, StatCard, errorMessage } from "@/components/common";
import { formatUptime, pct, relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { ServiceStatus } from "@/api/types";
import type { SocketStatus } from "@/websocket/socket";

const liveBadge: Record<SocketStatus, { tone: "success" | "warning" | "neutral"; label: string }> = {
  open: { tone: "success", label: "LIVE" },
  connecting: { tone: "warning", label: "CONNECTING" },
  reconnecting: { tone: "warning", label: "RECONNECTING" },
  closed: { tone: "neutral", label: "OFFLINE" },
};

/** Human labels. The keys are the backend service names. */
const SERVICE_LABEL: Record<string, string> = {
  postgres: "PostgreSQL",
  n8n: "n8n",
  playwright: "Playwright",
  profile: "Profile",
  ai: "AI",
};

/** Where a user goes to fix each service. */
const FIX_LINK: Record<string, { to: string; label: string }> = {
  n8n: { to: "/settings", label: "Configure" },
  playwright: { to: "/settings", label: "Configure" },
  ai: { to: "/settings", label: "Configure" },
  profile: { to: "/profiles", label: "Complete profile" },
};

interface Row {
  name: string;
  status: ServiceStatus;
  online: boolean | null;
  latency_ms: number | null;
  detail: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

/**
 * The second line under a service name. Only the AI row has one today: which
 * provider and model are actually answering, and - when the primary is down -
 * which fallback is carrying the load.
 */
function subLabel(row: Row): string {
  const meta = row.meta ?? {};
  if (row.name !== "ai") return "";
  const provider = String(meta.provider_label ?? meta.provider ?? "");
  if (!provider) return "";
  const model = String(meta.model ?? "");
  const fallback = String(meta.fallback_label ?? meta.fallback_provider ?? "");
  const head = model ? `${provider} · ${model}` : provider;
  return row.status === "degraded" && fallback ? `${head} → serving from ${fallback}` : head;
}

function ServiceTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-medium">Service</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 text-right font-medium">Latency</th>
            <th className="py-2 pr-3 font-medium">Last check</th>
            <th className="py-2 font-medium">Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = STATUS_META[row.status] ?? STATUS_META.unknown;
            const isProblem =
              row.status === "offline" || row.status === "invalid" || row.status === "degraded";
            const fix = FIX_LINK[row.name];
            return (
              <tr key={row.name} className="border-b border-border last:border-0 align-top">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot online={meta.dot} />
                    <div>
                      <span className="font-medium text-fg">
                        {SERVICE_LABEL[row.name] ?? row.name}
                      </span>
                      {subLabel(row) && (
                        <span className="block text-xs text-muted">{subLabel(row)}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <span className={cn("text-xs font-semibold uppercase", meta.className)}>
                    {meta.label}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted">
                  {row.latency_ms != null ? `${row.latency_ms} ms` : "—"}
                </td>
                <td className="py-2.5 pr-3 tabular-nums text-muted">
                  {row.updatedAt ? relativeTime(row.updatedAt) : "—"}
                </td>
                <td className="py-2.5 text-xs">
                  <span className={isProblem ? "text-danger" : "text-muted"}>{row.detail || "—"}</span>
                  {fix && row.status === "not_configured" && (
                    <>
                      {" "}
                      <Link className="text-brand underline underline-offset-2" to={fix.to}>
                        {fix.label}
                      </Link>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MonitoringPage() {
  const monitor = useMonitorWebSocket();
  // The REST snapshot is the fallback while the socket is still connecting, and
  // the target of the forced CHECK SERVICES re-probe.
  const fallbackStatus = useSystemStatus(!monitor.live || monitor.services.length === 0);
  const forceCheck = useForceServiceCheck();
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const badge = liveBadge[monitor.status];

  const cpu = useMemo(() => monitor.history.map((p) => p.cpu), [monitor.history]);
  const mem = useMemo(() => monitor.history.map((p) => p.memory), [monitor.history]);
  const disk = useMemo(() => monitor.history.map((p) => p.disk), [monitor.history]);

  const rows: Row[] = useMemo(() => {
    if (monitor.services.length > 0) {
      return monitor.services.map((s) => ({
        name: s.name,
        status: s.status,
        online: s.online,
        latency_ms: s.latency_ms,
        detail: s.detail,
        updatedAt: s.updatedAt,
        meta: s.meta,
      }));
    }
    const snapshot = fallbackStatus.data;
    return (snapshot?.services ?? [])
      .map((s) => ({
        name: s.name,
        status: s.status,
        online: s.online,
        latency_ms: s.latency_ms,
        detail: s.detail,
        updatedAt: s.checked_at ?? snapshot?.checked_at ?? "",
        meta: s.meta,
      }))
      .sort((a, b) => serviceRank(a.name) - serviceRank(b.name));
  }, [monitor.services, fallbackStatus.data]);

  const problems = rows.filter(
    (r) => r.status === "offline" || r.status === "invalid" || r.status === "degraded",
  );
  const pending = rows.filter((r) => r.status === "not_configured");
  const m = monitor.latest;

  const runCheck = () => {
    forceCheck.mutate(undefined, {
      onSuccess: () => setCheckedAt(new Date().toISOString()),
    });
  };

  return (
    <div>
      <PageHeader
        title="Monitoring"
        description="Real health of every service. Every state below comes from a live probe."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={badge.tone}>
              <span
                className={
                  "mr-1 inline-block h-2 w-2 rounded-full " +
                  (monitor.live ? "animate-pulse bg-ok" : "bg-warn")
                }
              />
              {badge.label}
            </Badge>
            {monitor.lastEventAt && (
              <span className="text-xs text-muted">updated {relativeTime(monitor.lastEventAt)}</span>
            )}
            <Button size="sm" onClick={runCheck} loading={forceCheck.isPending}>
              {forceCheck.isPending ? "Checking…" : "Check services"}
            </Button>
          </div>
        }
      />

      {forceCheck.isError && (
        <p className="mb-3 text-sm text-danger">{errorMessage(forceCheck.error)}</p>
      )}
      {checkedAt && !forceCheck.isPending && !forceCheck.isError && (
        <p className="mb-3 text-xs text-muted">Forced check completed {relativeTime(checkedAt)}.</p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="CPU" value={pct(m?.cpu_percent)} accent={(m?.cpu_percent ?? 0) > 85 ? "danger" : "ok"} />
        <StatCard label="Memory" value={pct(m?.memory_percent)} accent={(m?.memory_percent ?? 0) > 90 ? "danger" : "ok"} />
        <StatCard label="Disk" value={pct(m?.disk_percent)} accent={(m?.disk_percent ?? 0) > 90 ? "danger" : "ok"} />
        <StatCard
          label="Load / Uptime"
          value={m?.load_avg_1m != null ? m.load_avg_1m.toFixed(2) : "—"}
          sub={m ? formatUptime(m.uptime_seconds) : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <Sparkline values={cpu} label="CPU" unit="%" />
        </Card>
        <Card>
          <Sparkline values={mem} label="Memory" unit="%" />
        </Card>
        <Card>
          <Sparkline values={disk} label="Disk" unit="%" />
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Services</CardTitle>
          <p className="text-xs text-muted">
            {problems.length > 0
              ? `${problems.length} needing attention`
              : pending.length > 0
                ? `${pending.length} not configured yet`
                : "all services healthy"}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Waiting for the first monitoring frame…</p>
        ) : (
          <ServiceTable rows={rows} />
        )}
        <p className="mt-3 text-xs text-muted">
          <strong>not configured</strong> means nothing is set up for this environment — it is not an
          outage. <strong>degraded</strong> means the service answers but is only partly usable.
        </p>
      </Card>
    </div>
  );
}
