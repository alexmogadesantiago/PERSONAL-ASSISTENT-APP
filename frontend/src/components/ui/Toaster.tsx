import { createPortal } from "react-dom";
import { useToast, type ToastKind } from "@/stores/toast";
import { cn } from "@/utils/cn";

const accent: Record<ToastKind, string> = {
  success: "text-ok bg-ok/15",
  error: "text-danger bg-danger/15",
  info: "text-info bg-info/15",
  warning: "text-warn bg-warn/15",
};

const glyph: Record<ToastKind, string> = { success: "✓", error: "!", info: "i", warning: "!" };

/** Toasts: bottom-right on desktop, top-centre on phones (clear of the tab bar). */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-3 z-toast flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:w-full sm:max-w-sm"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-in-scale pointer-events-auto flex items-start gap-3 rounded-2xl border border-border bg-surface/95 p-3.5 shadow-elev-3 backdrop-blur"
        >
          <span
            className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", accent[t.kind])}
            aria-hidden="true"
          >
            {glyph[t.kind]}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-fg">{t.title}</p>
            {t.description && <p className="mt-0.5 break-words text-xs text-muted">{t.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded-md p-1 text-subtle transition hover:bg-surface-2 hover:text-fg"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
