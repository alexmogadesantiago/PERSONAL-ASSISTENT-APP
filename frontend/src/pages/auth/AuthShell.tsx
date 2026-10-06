/**
 * The frame both auth screens share.
 *
 * On a wide screen the left half states what the product is; the right half is
 * the form and nothing else. On a phone the statement collapses to a line above
 * the form. The backend indicator stays, because "cannot sign in" and "cannot
 * reach the server" are different problems and the user deserves to know which.
 */
import type { ReactNode } from "react";
import { useHealth } from "@/hooks/queries";
import { StatusBadge } from "@/components/StatusBadge";
import { API_URL, API_URL_IS_DEFAULT } from "@/config";

function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

const CAPABILITIES = [
  "Talk to an assistant that reads your live system state",
  "Watch every automation, run and failure in one timeline",
  "Keep providers, services and credentials in one place",
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const health = useHealth();
  const reachable = !health.isError;

  return (
    <div className="flex min-h-screen bg-bg">
      {/* statement */}
      <section className="relative hidden w-[46%] max-w-xl flex-col justify-between border-r border-border bg-surface px-10 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
            <Mark />
          </span>
          <p className="text-sm font-semibold tracking-tight text-fg">Personal Assistant</p>
        </div>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-fg">
            Your intelligent automation center.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            One place to see what your assistant is doing, what it has done, and to ask it directly.
          </p>
          <ul className="mt-7 space-y-3">
            {CAPABILITIES.map((line) => (
              <li key={line} className="flex gap-3 text-sm text-muted">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted">Private by design — this panel runs on your own infrastructure.</p>
      </section>

      {/* form */}
      <section className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="animate-in-up w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
                <Mark />
              </span>
              <p className="text-sm font-semibold tracking-tight text-fg">Personal Assistant</p>
            </div>
            <p className="mt-2 text-sm text-muted">Your intelligent automation center.</p>
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>

          <div className="mt-6">{children}</div>

          <div className="mt-6 space-y-3">
            {footer}
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <StatusBadge tone={reachable ? "ok" : "danger"}>
                {reachable ? "Backend reachable" : "Backend unreachable"}
              </StatusBadge>
              <span className="truncate" title={API_URL}>
                {API_URL}
              </span>
            </div>
            {API_URL_IS_DEFAULT && (
              <p className="text-[11px] text-muted">
                Using the local-dev default. Set <code>VITE_API_URL</code> for other environments.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
