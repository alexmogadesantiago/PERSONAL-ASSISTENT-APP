/**
 * Ctrl/⌘ + K. One box to go anywhere, run anything or ask the assistant.
 *
 * Sources: static pages and actions, the user's automations (panel-built and
 * system ones from n8n), the four integrations and the open errors. Matching
 * is a forgiving word-prefix search; the last row always offers "Ask AI", so a
 * question typed here is never a dead end.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useTheme } from "@/stores/theme";
import { useQuery } from "@tanstack/react-query";
import { assistantApi } from "@/api/platform";
import { useActivityFeed, useCustomAutomations, useDemoMode, useErrorCenter, useIntegrations, useTasks } from "@/hooks/platform";
import { useWorkflows } from "@/hooks/queries";
import {
  IActivity,
  IAlert,
  IArrowRight,
  IBolt,
  ICheck,
  IHome,
  IMail,
  IPlay,
  IMoon,
  IPlug,
  IPlus,
  ISearch,
  ISettings,
  ISparkles,
  IUser,
  ProviderMark,
} from "@/components/icons2";

interface Command {
  id: string;
  group: "Actions" | "Go to" | "Emails" | "Tasks" | "Automations" | "Executions" | "Integrations" | "Errors" | "Settings" | "Assistant";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

function score(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.label} ${cmd.keywords ?? ""} ${cmd.group}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    if (hay.startsWith(w)) s += 3;
    else if (hay.includes(` ${w}`)) s += 2;
    else if (hay.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const custom = useCustomAutomations();
  const system = useWorkflows();
  const integrations = useIntegrations();
  const errors = useErrorCenter();
  const tasks = useTasks("open");
  const feed = useActivityFeed("all");
  const demo = useDemoMode();
  const [term, setTerm] = useState("");
  const googleConnected = (integrations.data?.data ?? []).some((i) => i.key === "google" && i.connected);

  // Email search hits Gmail, so it waits for a pause in typing and for three characters.
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 400);
    return () => window.clearTimeout(t);
  }, [q]);
  const mail = useQuery({
    queryKey: ["palette-mail", term],
    queryFn: () => assistantApi.mail(term, 5),
    enabled: open && term.length >= 3 && (googleConnected || demo),
    staleTime: 60_000,
    retry: 0,
  });

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    const base: Command[] = [
      { id: "new", group: "Actions", label: "Create automation", icon: <IPlus />, keywords: "new build workflow", run: go("/automations/new") },
      { id: "ask", group: "Actions", label: "Ask the assistant", icon: <ISparkles />, keywords: "ai chat question", run: go("/assistant") },
      { id: "inbox", group: "Actions", label: "Open inbox", icon: <IActivity />, keywords: "gmail email mail correo", run: go("/inbox") },
      { id: "tg", group: "Actions", label: "Open Telegram", icon: <ProviderMark provider="telegram" size={16} />, keywords: "bot chat", run: go("/integrations/telegram") },
      { id: "run", group: "Actions", label: "Run an automation", icon: <IBolt />, keywords: "execute start", run: go("/automations") },
      { id: "connect", group: "Actions", label: "Connect a service", icon: <IPlug />, keywords: "integration oauth google telegram", run: go("/integrations") },
      { id: "errors", group: "Actions", label: "View errors", icon: <IAlert />, keywords: "problems failures issues", run: go("/errors") },
      { id: "theme", group: "Actions", label: "Toggle dark / light", icon: <IMoon />, keywords: "theme appearance", run: () => { toggle(); onClose(); } },
      { id: "tasks", group: "Actions", label: "Open tasks", icon: <ICheck />, keywords: "todo deadlines", run: go("/tasks") },
      { id: "briefing", group: "Actions", label: "Prepare my daily briefing", icon: <ISparkles />, keywords: "summary morning", run: go("/assistant?q=Prepare%20my%20daily%20briefing") },
      { id: "present", group: "Actions", label: "Open the presentation view", icon: <IPlay />, keywords: "demo tdr slides", run: go("/presentation") },
      { id: "p-home", group: "Go to", label: "Home", icon: <IHome />, keywords: "dashboard overview", run: go("/dashboard") },
      { id: "p-auto", group: "Go to", label: "Automations", icon: <IBolt />, run: go("/automations") },
      { id: "p-int", group: "Go to", label: "Integrations", icon: <IPlug />, keywords: "credentials connections", run: go("/integrations") },
      { id: "p-act", group: "Go to", label: "Activity", icon: <IActivity />, keywords: "history executions runs log", run: go("/activity") },
      { id: "p-prof", group: "Go to", label: "Profile", icon: <IUser />, keywords: "personalise interests", run: go("/profiles") },
      { id: "p-inbox", group: "Go to", label: "Inbox", icon: <IMail />, keywords: "gmail email correo", run: go("/inbox") },
      { id: "p-tasks", group: "Go to", label: "Tasks", icon: <ICheck />, keywords: "todo deadlines", run: go("/tasks") },
      { id: "p-engine", group: "Go to", label: "Automation engine (n8n)", icon: <IBolt />, keywords: "workflows executions health", run: go("/engine") },
      { id: "p-errors", group: "Go to", label: "Errors", icon: <IAlert />, keywords: "problems diagnose", run: go("/errors") },
      ...(
        [
          ["general", "General", "theme appearance"], ["account", "Account", "password sessions"], ["ai", "AI provider", "model gemini nvidia openrouter"],
          ["memory", "AI memory", "preferences important senders notes briefing time"], ["integrations", "Integrations", "oauth client"],
          ["automations", "Automations", "n8n engine"], ["notifications", "Notifications", "telegram alerts"], ["security", "Security", "password token audit"],
          ["privacy", "Privacy", "data sent to ai stored local"], ["demo", "Demo mode", "sample data presentation"], ["advanced", "Advanced", "system health services"],
        ] as const
      ).map(([k, label, kw]): Command => ({ id: `set-${k}`, group: "Settings", label, icon: <ISettings />, keywords: kw, run: go(`/settings/${k}`) })),
    ];
    for (const t of tasks.data ?? []) {
      base.push({ id: `t-${t.id}`, group: "Tasks", label: t.title, hint: t.due_at ? new Date(t.due_at).toLocaleDateString() : undefined, icon: <ICheck />, run: go("/tasks") });
    }
    for (const m of mail.data?.data ?? []) {
      base.push({ id: `m-${m.id}`, group: "Emails", label: m.subject || "(no subject)", hint: m.from.split("<")[0].trim(), icon: <IMail />, keywords: q, run: go(`/inbox?id=${m.id}`) });
    }
    for (const x of (feed.data?.data ?? []).filter((i) => i.kind === "execution").slice(0, 10)) {
      base.push({ id: `x-${x.id}`, group: "Executions", label: `${x.message} · ${x.title}`, hint: x.result, icon: <IActivity />, keywords: x.service, run: go(x.link ?? "/activity") });
    }
    for (const a of custom.data ?? []) {
      base.push({ id: `a-${a.id}`, group: "Automations", label: a.name, hint: a.active ? "Active" : "Paused", icon: <IBolt />, keywords: a.description, run: go(`/automations/${a.id}`) });
    }
    const customIds = new Set((custom.data ?? []).map((a) => a.n8n_workflow_id));
    for (const w of system.data?.data ?? []) {
      if (customIds.has(w.id) || w.id === "pa00errorhandler") continue;
      base.push({ id: `w-${w.id}`, group: "Automations", label: w.name, hint: w.active ? "Active" : "Paused", icon: <IBolt />, keywords: "system assistant", run: go(`/automations/system/${w.id}`) });
    }
    for (const i of integrations.data?.data ?? []) {
      base.push({ id: `i-${i.key}`, group: "Integrations", label: i.label, hint: i.connected ? "Connected" : "Connect", icon: <ProviderMark provider={i.key} size={16} />, keywords: i.tagline, run: go(`/integrations/${i.key}`) });
    }
    for (const e of (errors.data?.data ?? []).slice(0, 5)) {
      base.push({ id: `e-${e.id}`, group: "Errors", label: e.title, hint: e.automation || e.service, icon: <IAlert />, keywords: e.message, run: go("/errors") });
    }
    return base;
  }, [custom.data, system.data, integrations.data, errors.data, tasks.data, mail.data, feed.data, q, navigate, onClose, toggle]);

  const results = useMemo(() => {
    const ranked = commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 12 : 9)
      .map((r) => r.c);
    if (q.trim()) {
      ranked.push({
        id: "ask-q",
        group: "Assistant",
        label: `Ask: “${q.trim()}”`,
        icon: <ISparkles />,
        run: () => {
          onClose();
          navigate(`/assistant?q=${encodeURIComponent(q.trim())}`);
        },
      });
    }
    return ranked;
  }, [commands, q, navigate, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-palette flex items-start justify-center px-3 pt-[12vh]">
      <div className="animate-in-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-in-scale relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-elev-3"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            results[active]?.run();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <ISearch className="text-subtle" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search, jump, run - or ask your assistant…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] text-fg placeholder:text-subtle focus:outline-none"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div ref={list} id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">No matches.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-subtle">{c.group}</p>}
                <button
                  id={`cmd-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={c.run}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                    i === active ? "bg-surface-2 text-fg" : "text-muted",
                  )}
                >
                  <span className={cn("grid h-7 w-7 place-items-center rounded-lg", i === active ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted")}>
                    {c.icon}
                  </span>
                  <span className="flex-1 truncate text-fg">{c.label}</span>
                  {c.hint && <span className="text-xs text-subtle">{c.hint}</span>}
                  {i === active && <IArrowRight className="text-subtle" width={15} height={15} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-subtle sm:flex">
          <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          <span className="ml-auto">Type a question to ask the assistant</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
