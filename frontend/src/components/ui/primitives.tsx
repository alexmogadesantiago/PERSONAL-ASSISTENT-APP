import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

/* ------------------------------- Button -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "subtle" | "ai";
type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg shadow-elev-1 hover:brightness-110 active:brightness-95",
  secondary: "bg-surface-2 text-fg ring-1 ring-inset ring-border hover:bg-surface-3",
  outline: "border border-border-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-fg",
  subtle: "bg-brand/10 text-brand hover:bg-brand/15",
  danger: "bg-danger text-brand-fg hover:brightness-110",
  ai: "bg-gradient-to-r from-brand to-accent text-brand-fg shadow-glow hover:brightness-110",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs gap-1 rounded-lg",
  sm: "h-8 px-2.5 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
};

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 select-none items-center justify-center font-medium transition duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    sizes[size],
    variants[variant],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, icon, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  );
});

/** A router link that looks like a button. External URLs open in a new tab. */
export function ButtonLink({
  to,
  children,
  variant = "secondary",
  size = "md",
  className,
  icon,
}: {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: ReactNode;
}) {
  const cls = buttonClass(variant, size, className);
  if (/^https?:\/\//.test(to)) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

/* ------------------------------- Spinner ------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M22 12a10 10 0 0 0-10-10" />
    </svg>
  );
}

/* -------------------------------- Card -------------------------------- */

export function Card({
  children,
  className,
  as: Tag = "div",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
  padded?: boolean;
}) {
  return <Tag className={cn("card", padded && "p-4 md:p-5", className)}>{children}</Tag>;
}

export function CardTitle({
  children,
  action,
  description,
  icon,
}: {
  children: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  if (!icon && !description) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-fg">{children}</h3>
        {action}
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-muted">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{children}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------- Badge -------------------------------- */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand" | "accent";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted ring-border",
  success: "bg-ok/10 text-ok ring-ok/25",
  warning: "bg-warn/10 text-warn ring-warn/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  info: "bg-info/10 text-info ring-info/25",
  brand: "bg-brand/10 text-brand ring-brand/25",
  accent: "bg-accent/10 text-accent ring-accent/25",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ------------------------------ StatusDot ----------------------------- */

export function StatusDot({
  online,
  className,
  pulse,
}: {
  online: boolean | null;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)} aria-hidden="true">
      {pulse && online && <span className="absolute inset-0 animate-ping rounded-full bg-ok/50" />}
      <span
        className={cn(
          "relative inline-block h-2.5 w-2.5 rounded-full",
          online == null ? "bg-subtle" : online ? "bg-ok" : "bg-danger",
        )}
      />
    </span>
  );
}

/* ------------------------------ Skeleton ----------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-lg", className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/* ------------------------- Empty / Error states --------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-border-strong/70 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted ring-1 ring-inset ring-border">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-danger/25 bg-danger/5 px-6 py-10 text-center"
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Retry
        </Button>
      )}
    </div>
  );
}

/* ----------------------------- PageHeader --------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-xs text-muted transition hover:text-fg">
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------- Avatar ----------------------------- */

export function Avatar({ name, src, size = 32 }: { name: string; src?: string; size?: number }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return src ? (
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-1 ring-border" />
  ) : (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-accent/70 text-[11px] font-semibold text-white"
    >
      {initials || "?"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* -------------------------------- Stat ------------------------------ */

export function Stat({
  label,
  value,
  hint,
  icon,
  tone,
  loading,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "ok" | "warn" | "danger" | "brand";
  loading?: boolean;
  to?: string;
}) {
  const body = (
    <div className={cn("card h-full p-4", to && "card-interactive")}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && (
          <span
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-muted",
              tone === "ok" && "bg-ok/10 text-ok",
              tone === "warn" && "bg-warn/10 text-warn",
              tone === "danger" && "bg-danger/10 text-danger",
              tone === "brand" && "bg-brand/10 text-brand",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      )}
      {hint && <p className="mt-1 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}
