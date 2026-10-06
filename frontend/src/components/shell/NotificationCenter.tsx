/**
 * The bell. Actionable notifications: every item that can be fixed carries the
 * button that fixes it (Reconnect Google, Open the run…). Read state is kept
 * by the backend, so it follows the user across devices.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useInsights, useMarkNotificationsRead, useNotifications } from "@/hooks/platform";
import type { NotificationItem } from "@/api/platform";
import { IAlert, IBell, IBolt, ICheck, IPlug, IShield, ISparkles } from "@/components/icons2";
import { relativeTime } from "@/utils/format";

const TONE: Record<NotificationItem["tone"], string> = {
  success: "bg-ok/15 text-ok",
  warning: "bg-warn/15 text-warn",
  error: "bg-danger/15 text-danger",
  security: "bg-info/15 text-info",
  info: "bg-info/15 text-info",
};

function KindIcon({ n }: { n: NotificationItem }) {
  if (n.tone === "error") return <IAlert width={15} height={15} />;
  if (n.kind === "security") return <IShield width={15} height={15} />;
  if (n.kind === "integration") return <IPlug width={15} height={15} />;
  if (n.kind === "ai") return <ISparkles width={15} height={15} />;
  if (n.tone === "success") return <ICheck width={15} height={15} />;
  return <IBolt width={15} height={15} />;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const notes = useNotifications();
  const markRead = useMarkNotificationsRead();
  const insights = useInsights();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const forYou = insights.data ?? [];
  const unread = (notes.data?.unread ?? 0) + forYou.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <IBell />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-brand-fg ring-2 ring-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "animate-in-scale fixed inset-x-3 top-16 z-overlay overflow-hidden rounded-2xl border border-border bg-surface shadow-elev-3",
            "sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[400px] sm:origin-top-right",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            <button
              type="button"
              disabled={!unread || markRead.isPending}
              onClick={() => markRead.mutate()}
              className="text-xs font-medium text-brand transition hover:underline disabled:text-subtle disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notes.isLoading && <p className="px-4 py-8 text-center text-sm text-muted">Loading…</p>}
            {forYou.length > 0 && (
              <div className="border-b border-border/70">
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">For you</p>
                {forYou.map((i) => (
                  <div key={i.id} className="flex gap-3 bg-brand/[0.04] px-4 py-3">
                    <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", i.severity === "low" ? TONE.info : i.severity === "medium" ? TONE.warning : TONE.error)}>
                      {i.kind === "email" ? <IBell width={15} height={15} /> : i.kind === "deadline" ? <ISparkles width={15} height={15} /> : <IAlert width={15} height={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{i.title}</p>
                      {i.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{i.detail}</p>}
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          navigate(i.action.href);
                        }}
                        className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg ring-1 ring-inset ring-border transition hover:bg-surface-3"
                      >
                        {i.action.label}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {notes.data && notes.data.data.length === 0 && forYou.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-fg">You're all caught up</p>
                <p className="mt-1 text-xs text-muted">Failures, new connections and security events appear here.</p>
              </div>
            )}
            {notes.data?.data.map((n) => (
              <div key={n.id} className={cn("flex gap-3 border-b border-border/70 px-4 py-3 last:border-0", n.unread && "bg-brand/[0.04]")}>
                <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", TONE[n.tone])}>
                  <KindIcon n={n} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{n.title}</p>
                    {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="unread" />}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>
                  <div className="mt-2 flex items-center gap-3">
                    {n.action && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          navigate(n.action!.href);
                        }}
                        className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg ring-1 ring-inset ring-border transition hover:bg-surface-3"
                      >
                        {n.action.label}
                      </button>
                    )}
                    {n.at && <span className="text-[11px] text-subtle">{relativeTime(n.at)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
