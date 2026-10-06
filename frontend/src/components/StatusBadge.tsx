/**
 * One status vocabulary for the whole product.
 *
 * The backend already speaks it (`ServiceStatus` in app/schemas/system.py), so
 * the panel does not invent labels: it maps each state to a colour and a word,
 * and "not configured" stays grey - nobody asked for that service here, which
 * is not an outage.
 */
import type { ReactNode } from "react";
import type { ServiceStatus } from "@/api/types";
import { cn } from "@/utils/cn";

export type StatusTone = "ok" | "warn" | "danger" | "idle" | "brand";

const TONES: Record<StatusTone, { dot: string; text: string; ring: string }> = {
  ok: { dot: "bg-ok", text: "text-ok", ring: "ring-ok/25" },
  warn: { dot: "bg-warn", text: "text-warn", ring: "ring-warn/25" },
  danger: { dot: "bg-danger", text: "text-danger", ring: "ring-danger/25" },
  idle: { dot: "bg-muted/60", text: "text-muted", ring: "ring-border" },
  brand: { dot: "bg-brand", text: "text-brand", ring: "ring-brand/30" },
};

export const STATUS_TONE: Record<ServiceStatus, StatusTone> = {
  online: "ok",
  configured: "ok",
  degraded: "warn",
  invalid: "danger",
  offline: "danger",
  not_configured: "idle",
  unknown: "idle",
};

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  online: "Operational",
  configured: "Configured",
  degraded: "Degraded",
  invalid: "Invalid credentials",
  offline: "Offline",
  not_configured: "Not configured",
  unknown: "Unknown",
};

export function StatusBadge({
  tone = "idle",
  children,
  pulse = false,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  /** A soft halo for the one badge that reports overall health. */
  pulse?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
        t.text,
        t.ring,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          t.dot,
          pulse && tone === "ok" && "shadow-[0_0_0_3px_rgb(var(--c-ok)/0.18)]",
        )}
      />
      {children}
    </span>
  );
}

/** Convenience wrapper for anything the monitor reports. */
export function ServiceStatusBadge({ status, className }: { status: ServiceStatus; className?: string }) {
  return (
    <StatusBadge tone={STATUS_TONE[status]} className={className}>
      {STATUS_LABEL[status]}
    </StatusBadge>
  );
}
