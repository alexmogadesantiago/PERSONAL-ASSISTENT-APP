/**
 * Overlays: Drawer (side panel on desktop, bottom sheet on phones), Menu
 * (dropdown with keyboard support) and Tooltip. All of them trap Escape,
 * restore focus to the trigger and lock page scroll while open.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

export function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

function useRestoreFocus(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [active]);
}

/* --------------------------------------------------------------- Drawer */

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  useLockScroll(open);
  useEscape(open, onClose);
  useRestoreFocus(open);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-overlay">
      <div className="animate-in-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "absolute flex flex-col bg-surface shadow-elev-3 outline-none",
          // phone: bottom sheet
          "animate-sheet inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl border-t border-border",
          // tablet+: right drawer
          "sm:animate-drawer sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0",
          width === "sm" && "sm:w-[380px]",
          width === "md" && "sm:w-[480px]",
          width === "lg" && "sm:w-[640px]",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------------- Menu */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function Menu({
  trigger,
  items,
  align = "right",
  label = "More actions",
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  items: (MenuItem | "separator")[];
  align?: "left" | "right";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const real = items.filter((i): i is MenuItem => i !== "separator");
  const close = useCallback(() => setOpen(false), []);
  useEscape(open, close);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      setActive(0);
      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus());
    }
  }, [open]);

  function onKey(e: ReactKeyboardEvent) {
    if (!open) return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      setActive(next);
      buttons[next]?.focus();
    }
  }

  let idx = -1;
  return (
    <div ref={root} className="relative inline-block" onKeyDown={onKey}>
      {trigger({ open, toggle: () => setOpen((v) => !v), id })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          id={id}
          className={cn(
            "animate-in-scale absolute z-tabbar mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-elev-3",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          )}
        >
          {items.map((item, i) => {
            if (item === "separator") return <div key={`sep-${i}`} className="my-1 h-px bg-border" />;
            idx += 1;
            const me = idx;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={me === active ? 0 : -1}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition focus:outline-none",
                  "disabled:opacity-40",
                  item.danger ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "text-fg hover:bg-surface-2 focus:bg-surface-2",
                )}
              >
                {item.icon && <span className={item.danger ? "text-danger" : "text-muted"}>{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="text-xs text-subtle">{item.hint}</span>}
              </button>
            );
          })}
          {real.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">Nothing to do here.</p>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Tooltip */

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex" aria-describedby={id}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-overlay -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-3 px-2 py-1 text-xs text-fg opacity-0 shadow-elev-2 transition duration-150",
          "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
