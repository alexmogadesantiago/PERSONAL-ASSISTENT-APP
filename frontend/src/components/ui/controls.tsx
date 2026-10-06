/**
 * Controls and displays: Tabs, Segmented, Switch, Timeline, Steps, Health.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { BadgeTone } from "./primitives";

/* ---------------------------------------------------------------- Tabs */

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Accessible tabs (roving tabindex, arrow keys). Scrolls on small screens. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].value);
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex max-w-full gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]", className)}
    >
      {items.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
              selected ? "border-brand font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  selected ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg font-medium transition",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            o.value === value ? "bg-surface text-fg shadow-elev-1" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  loading,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || loading}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition duration-200",
        checked ? "bg-ok" : "bg-surface-3 ring-1 ring-inset ring-border-strong",
        (disabled || loading) && "opacity-60",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-elev-1 transition duration-200 ease-out",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
          loading && "animate-pulse",
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------- Health */

export type HealthState =
  | "healthy"
  | "degraded"
  | "expired"
  | "auth_required"
  | "error"
  | "not_connected"
  | "pending"
  | "unknown";

export const HEALTH_META: Record<HealthState, { label: string; tone: BadgeTone; dot: string }> = {
  healthy: { label: "Healthy", tone: "success", dot: "bg-ok" },
  degraded: { label: "Degraded", tone: "warning", dot: "bg-warn" },
  expired: { label: "Expired", tone: "danger", dot: "bg-danger" },
  auth_required: { label: "Sign-in required", tone: "danger", dot: "bg-danger" },
  error: { label: "Error", tone: "danger", dot: "bg-danger" },
  not_connected: { label: "Not connected", tone: "neutral", dot: "bg-subtle" },
  pending: { label: "Finish setup", tone: "info", dot: "bg-info" },
  unknown: { label: "Checking…", tone: "neutral", dot: "bg-subtle" },
};

export function HealthBadge({ state, className }: { state: HealthState; className?: string }) {
  const meta = HEALTH_META[state] ?? HEALTH_META.unknown;
  const colour = {
    success: "text-ok bg-ok/10 ring-ok/25",
    warning: "text-warn bg-warn/10 ring-warn/25",
    danger: "text-danger bg-danger/10 ring-danger/25",
    info: "text-info bg-info/10 ring-info/25",
    neutral: "text-muted bg-surface-2 ring-border",
    brand: "text-brand bg-brand/10 ring-brand/25",
    accent: "text-accent bg-accent/10 ring-accent/25",
  }[meta.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        colour,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {state === "healthy" && <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />}
        <span className={cn("relative h-1.5 w-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------ Timeline */

export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("relative space-y-0", className)}>{children}</ol>;
}

export function TimelineItem({
  icon,
  tone = "neutral",
  title,
  meta,
  children,
  last,
}: {
  icon?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand" | "info";
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  const colour = {
    neutral: "bg-surface-2 text-muted ring-border",
    ok: "bg-ok/15 text-ok ring-ok/30",
    warn: "bg-warn/15 text-warn ring-warn/30",
    danger: "bg-danger/15 text-danger ring-danger/30",
    brand: "bg-brand/15 text-brand ring-brand/30",
    info: "bg-info/15 text-info ring-info/30",
  }[tone];
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-border" aria-hidden="true" />}
      <span className={cn("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset", colour)}>
        {icon ?? <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <div className="min-w-0 text-sm text-fg">{title}</div>
          {meta && <div className="shrink-0 text-xs text-subtle">{meta}</div>}
        </div>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- Steps */

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  const id = useId();
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={`${id}-${s}`} className="flex flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition",
                done && "bg-brand text-brand-fg",
                active && "bg-brand/15 text-brand ring-2 ring-brand/40",
                !done && !active && "bg-surface-2 text-subtle ring-1 ring-inset ring-border",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={cn("hidden truncate text-xs md:block", active ? "font-medium text-fg" : "text-muted")}>{s}</span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", done ? "bg-brand/50" : "bg-border")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
