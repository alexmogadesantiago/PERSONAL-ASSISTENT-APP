/**
 * One integration, as the monitor reports it.
 *
 * `target` is whatever the backend chose to reveal (a host, a queue name); it
 * is never a credential. The panel has no access to secrets at all - the API
 * exposes only `secret_configured` and a four-character hint - so there is
 * nothing here to accidentally print.
 */
import type { ServiceState } from "@/api/types";
import { ServiceStatusBadge } from "@/components/StatusBadge";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

export function ServiceCard({
  service,
  className,
}: {
  service: ServiceState;
  className?: string;
}) {
  const problem =
    service.status === "offline" || service.status === "invalid" || service.status === "degraded";

  return (
    <article className={cn("card p-4", problem && "border-danger/25", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold capitalize text-fg">{service.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted">{service.kind}</p>
        </div>
        <ServiceStatusBadge status={service.status} />
      </div>

      {service.detail && (
        <p className={cn("mt-3 text-xs", problem ? "text-danger" : "text-muted")}>{service.detail}</p>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
        {service.target && (
          <div className="flex gap-1.5">
            <dt className="uppercase tracking-wider">Target</dt>
            <dd className="font-mono text-fg/80">{service.target}</dd>
          </div>
        )}
        {service.latency_ms != null && (
          <div className="flex gap-1.5">
            <dt className="uppercase tracking-wider">Latency</dt>
            <dd className="tabular-nums text-fg/80">{service.latency_ms} ms</dd>
          </div>
        )}
        {service.checked_at && (
          <div className="flex gap-1.5">
            <dt className="uppercase tracking-wider">Checked</dt>
            <dd className="text-fg/80">{relativeTime(service.checked_at)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
