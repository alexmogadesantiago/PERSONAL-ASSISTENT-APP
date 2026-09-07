import { useAiHealth, useAiProviders } from "@/hooks/queries";
import { Card, CardTitle } from "@/components/ui";
import { STATUS_META } from "@/components/common";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { ServiceStatus } from "@/api/types";

/**
 * The AI layer as `/api/ai/health` reports it.
 *
 * The services table already carries an AI row, but that row is a snapshot the
 * monitor computes for every service alike. This card exists for the two things
 * only the AI endpoint knows: whether the *fallback* is itself usable, and
 * which generation last really fell back. Both are read from the backend - no
 * health check is recomputed here, and nothing is inferred from configuration.
 *
 * It renders nothing until the backend answers, so a panel talking to an older
 * API simply keeps the table it already had.
 */
export function AiStatusCard() {
  const health = useAiHealth();
  const providers = useAiProviders();

  if (!health.data) return null;
  const data = health.data;

  const label = (id: string) => providers.data?.find((p) => p.id === id)?.label || id;
  const meta = STATUS_META[data.status as ServiceStatus] ?? STATUS_META.unknown;
  const fallbackMeta = data.fallback_status
    ? (STATUS_META[data.fallback_status as ServiceStatus] ?? STATUS_META.unknown)
    : null;

  return (
    <Card className="mt-4">
      <CardTitle
        action={
          <span
            className={cn("text-xs font-semibold uppercase", meta.className)}
            data-testid="ai-health-status"
          >
            {meta.label}
          </span>
        }
      >
        AI provider
      </CardTitle>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Provider</dt>
          <dd className="text-fg">{data.provider ? label(data.provider) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Model</dt>
          <dd className="break-all text-fg">{data.model || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Latency</dt>
          <dd className="tabular-nums text-fg">
            {data.latency_ms != null ? `${Math.round(data.latency_ms)} ms` : "—"}
          </dd>
        </div>
      </dl>

      {data.detail && <p className="mt-2 text-xs text-muted">{data.detail}</p>}
      {data.error && data.error !== data.detail && (
        <p className="mt-1 text-xs text-danger">{data.error}</p>
      )}

      <div className="mt-3 border-t border-border pt-3 text-xs">
        {data.fallback_provider ? (
          <p className="text-muted">
            Fallback: <span className="text-fg">{label(data.fallback_provider)}</span>
            {fallbackMeta && (
              <>
                {" — "}
                <span className={cn("font-semibold uppercase", fallbackMeta.className)}>
                  {fallbackMeta.label}
                </span>
              </>
            )}
            . Used only when the primary itself fails; never called alongside it.
          </p>
        ) : (
          <p className="text-muted">
            No fallback available — give a second provider a key in Settings.
          </p>
        )}

        {data.last_fallback && (
          <p className="mt-1 text-warn">
            Last fallback {relativeTime(data.last_fallback.at)}:{" "}
            {label(data.last_fallback.primary)} → {label(data.last_fallback.fallback)}
            {data.last_fallback.reason && ` (${data.last_fallback.reason})`}
          </p>
        )}

        {data.checked_at && (
          <p className="mt-1 text-muted">
            Checked {relativeTime(data.checked_at)}
            {data.cached && " (cached)"}
          </p>
        )}
      </div>
    </Card>
  );
}
