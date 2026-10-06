/**
 * Services.
 *
 * What the platform is connected to, as the backend's own probe reports it.
 * Configuration lives in Settings; this page is the operational read, plus the
 * forced re-probe (`POST /api/system/check`).
 *
 * Credentials never reach this page. The configuration API returns
 * `secret_configured` and a four-character hint and nothing else, so there is
 * no key here to hide - and the hint is shown only as evidence that something
 * is stored.
 */
import { Link } from "react-router-dom";
import { ServiceCard } from "@/components/ServiceCard";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { QueryBoundary, errorMessage } from "@/components/common";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { useForceServiceCheck, useServiceConfigs, useSystemStatus } from "@/hooks/queries";
import { useToast } from "@/stores/toast";
import { relativeTime } from "@/utils/format";

export function ServicesPage() {
  const status = useSystemStatus();
  const configs = useServiceConfigs();
  const recheck = useForceServiceCheck();
  const toast = useToast();

  const services = status.data?.services ?? [];
  const problems = services.filter(
    (s) => s.status === "offline" || s.status === "invalid" || s.status === "degraded",
  );
  const healthy = services.filter((s) => s.status === "online" || s.status === "configured").length;

  const tone: StatusTone = status.isError
    ? "danger"
    : status.data?.operational
      ? "ok"
      : status.data
        ? "warn"
        : "idle";

  return (
    <div>
      <PageHeader
        title="Services"
        description="Every integration this assistant depends on."
        actions={
          <Button
            size="sm"
            variant="outline"
            loading={recheck.isPending}
            onClick={() =>
              recheck
                .mutateAsync()
                .then(() => toast.success("Services re-checked"))
                .catch((e) => toast.error("Check failed", errorMessage(e)))
            }
          >
            Check services
          </Button>
        }
      />

      <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <StatusBadge tone={tone} pulse>
          {status.data?.operational
            ? `All systems operational · ${healthy}/${services.length} healthy`
            : status.data
              ? `${problems.length} service${problems.length === 1 ? "" : "s"} need attention`
              : "Checking…"}
        </StatusBadge>
        <p className="text-xs text-muted">
          {status.data?.checked_at ? `Last probe ${relativeTime(status.data.checked_at)}` : "Waiting for the first probe"}
        </p>
      </div>

      <QueryBoundary
        isLoading={status.isLoading}
        isError={status.isError}
        error={status.error}
        onRetry={() => status.refetch()}
        skeletonRows={4}
      >
        {services.length === 0 ? (
          <EmptyState title="No services reported" description="The backend returned an empty probe." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
          </div>
        )}
      </QueryBoundary>

      {(configs.data?.length ?? 0) > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="eyebrow">Configuration</p>
            <Link to="/settings" className="text-xs text-muted transition-colors hover:text-fg">
              Edit in settings →
            </Link>
          </div>
          <div className="card divide-y divide-border">
            {(configs.data ?? []).map((config) => (
              <div key={config.service} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{config.label}</p>
                  <p className="truncate text-xs text-muted">
                    {config.base_url || "no endpoint set"}
                    {config.secret_configured && ` · key stored (${config.secret_hint})`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={config.configured ? (config.enabled ? "ok" : "idle") : "idle"}>
                    {config.configured ? (config.enabled ? "Configured" : "Disabled") : "Not configured"}
                  </StatusBadge>
                  <span className="hidden text-[11px] text-muted sm:inline">from {config.source}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Secrets are never sent to the browser — only whether one is stored, and its last four characters.
          </p>
        </section>
      )}
    </div>
  );
}
