/**
 * "Get your assistant ready" - the setup checklist shared by Home and the
 * onboarding flow. Every step is derived from real state (a connection that
 * exists, an AI provider that is configured…), never from a "done" flag.
 */
import { Link } from "react-router-dom";
import { n8nStateOf, useAiConfig, useHealth, useN8nHealth, useProfileCompleteness } from "@/hooks/queries";
import { useCustomAutomations, useIntegrations } from "@/hooks/platform";
import { cn } from "@/utils/cn";
import { ICheck, IArrowRight } from "@/components/icons2";

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

export function useSetupProgress() {
  const integrations = useIntegrations();
  const ai = useAiConfig();
  const automations = useCustomAutomations();
  const profile = useProfileCompleteness();
  const n8n = useN8nHealth();
  const health = useHealth();
  const list = integrations.data?.data ?? [];
  const google = list.some((i) => i.key === "google" && i.connected);
  const telegram = list.some((i) => i.key === "telegram" && i.status === "healthy");
  const steps: SetupStep[] = [
    { key: "services", title: "Start services", description: "The backend and database are answering.", href: "/settings/advanced", cta: "Check", done: health.data?.status === "ok" && health.data?.database === "ok" },
    { key: "connect", title: "Connect Google", description: "Gmail and Calendar - sign in once.", href: "/integrations/google", cta: "Connect", done: google },
    { key: "ai", title: "Connect your AI (Gemini or another)", description: "Pick a provider and model for the assistant.", href: "/settings/ai", cta: "Choose", done: !!ai.data?.configured },
    { key: "telegram", title: "Connect Telegram", description: "Where your assistant talks to you.", href: "/integrations/telegram", cta: "Link", done: telegram },
    { key: "n8n", title: "Verify n8n", description: "The engine that runs your automations in the background.", href: "/settings/advanced", cta: "Verify", done: n8nStateOf(n8n.data, n8n.isError) === "online" },
    { key: "automation", title: "Run your first automation", description: "From a template, or just describe it.", href: "/automations/new", cta: "Create", done: (automations.data?.length ?? 0) > 0 },
    { key: "profile", title: "Tell it about you", description: "Interests, language and tone.", href: "/profiles", cta: "Personalise", done: !!profile.data?.configured },
  ];
  const done = steps.filter((s) => s.done).length;
  const loading = integrations.isLoading || ai.isLoading || automations.isLoading;
  return { steps, done, total: steps.length, complete: done === steps.length, loading };
}

export function SetupChecklist({ compact }: { compact?: boolean }) {
  const { steps, done, total, loading } = useSetupProgress();
  const pct = Math.round((done / total) * 100);
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all duration-700" style={{ width: `${loading ? 0 : pct}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted">
          {done}/{total}
        </span>
      </div>
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              to={s.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-2 py-2 transition",
                s.done ? "opacity-70" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ring-inset transition",
                  s.done ? "bg-ok text-white ring-ok" : "text-transparent ring-border-strong group-hover:ring-brand",
                )}
              >
                <ICheck width={13} height={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", s.done ? "text-muted line-through decoration-subtle" : "font-medium text-fg")}>{s.title}</span>
                {!compact && !s.done && <span className="block text-xs text-muted">{s.description}</span>}
              </span>
              {!s.done && <IArrowRight width={15} height={15} className="text-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
