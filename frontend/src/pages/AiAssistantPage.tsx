/**
 * AI Assistant.
 *
 * A real conversation with the provider configured for this platform, through
 * the endpoint the automations already use (`POST /api/ai/generate`). Every
 * request carries a freshly built snapshot of the system, so the answers are
 * about *this* installation rather than about automation in general.
 *
 * Two honest limits are visible in the UI rather than papered over:
 *   - the backend answers in one shot (it exposes no streaming endpoint), so
 *     there is a thinking state and a Stop that really aborts the request;
 *   - there is no conversation API, so history is this browser's and is
 *     labelled as such.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { assistantApi, type AskAction } from "@/api/platform";
import { errorMessage } from "@/components/common";
import { ISparkles, IWand } from "@/components/icons2";
import { useSystemSnapshot } from "@/ai/useSystemSnapshot";
import { useAssistant } from "@/ai/useAssistant";
import { QUICK_PROMPTS } from "@/ai/prompt";
import { ChatMessage, ChatPending } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import { relativeTime } from "@/utils/format";
import { useToast } from "@/stores/toast";

export function AiAssistantPage() {
  const snapshot = useSystemSnapshot();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const assistant = useAssistant({ getContext: snapshot.getContext, ready: snapshot.aiReady });
  const turns = assistant.active?.turns ?? [];
  const empty = turns.length === 0;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState<string | null>(null);

  // `/assistant?q=...` (command palette, "Explain with AI"): ask it in a fresh
  // conversation as soon as the system snapshot is ready.
  useEffect(() => {
    const q = params.get("q");
    if (!q) return;
    params.delete("q");
    setParams(params, { replace: true });
    if (turns.length) assistant.startNew();
    setPending(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pending && snapshot.contextReady && (assistant.active?.turns.length ?? 0) === 0 && !assistant.generating) {
      const q = pending;
      setPending(null);
      void assistant.send(q);
    }
  }, [pending, snapshot.contextReady, assistant]);

  // Keep the newest turn in view, including while one is being generated.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, assistant.generating]);

  function submit(text?: string) {
    const value = (text ?? draft).trim();
    if (!value) return;
    setDraft("");
    void assistant.send(value);
  }

  async function confirm(turnId: string, proposal: Parameters<typeof assistant.confirmAction>[1]) {
    const outcome = await assistant.confirmAction(turnId, proposal);
    if (outcome.ok) {
      toast.success(proposal.title, outcome.message);
      // A run or a state change invalidates what the rest of the panel shows.
      void snapshot.workflows.refetch();
      void snapshot.executions.refetch();
      void snapshot.status.refetch();
    } else {
      toast.error(proposal.title, outcome.message);
    }
  }

  async function runAssistantAction(a: AskAction) {
    if (a.kind === "navigate" && a.href) navigate(a.href);
    else if (a.kind === "external" && a.href) window.open(a.href, "_blank", "noopener");
    else if (a.kind === "briefing") {
      try {
        const b = await assistantApi.briefing(true);
        const lines = [
          `**${b.greeting ?? "Hello"}.** Here is your briefing.`,
          `- **Email:** ${b.emails.length} unread, ${(b.important ?? []).length} important`,
          `- **Calendar:** ${b.events.length} event${b.events.length === 1 ? "" : "s"} today`,
          `- **Deadlines:** ${(b.deadlines ?? []).length}`,
          b.automations?.message ? `- **Automations:** ${b.automations.message}` : "",
          b.summary ? `\n${b.summary}` : "",
        ].filter(Boolean);
        assistant.addAssistantText(lines.join("\n"));
      } catch (e) {
        toast.error("Could not create the briefing", errorMessage(e));
      }
    }
  }

  const aiStatus = snapshot.aiHealth.data?.status;
  const statusTone =
    aiStatus === "online"
      ? "ok"
      : aiStatus === "degraded"
        ? "warn"
        : aiStatus === "offline" || aiStatus === "invalid"
          ? "danger"
          : "idle";

  return (
    <div className="flex h-[calc(100vh-8.25rem)] min-h-[520px] gap-4">
      {/* transcript column */}
      <div className="card flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-glow">
              <ISparkles width={17} height={17} />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-fg">Assistant</h1>
              <p className="truncate text-xs text-muted">Knows your automations, connections and recent runs.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={statusTone}>
              {aiStatus === "online"
                ? "Connected"
                : aiStatus === "not_configured"
                  ? "Not configured"
                  : aiStatus
                    ? aiStatus
                    : "Checking…"}
            </StatusBadge>
            <Button size="sm" variant="outline" onClick={assistant.startNew}>
              New
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              className="lg:hidden"
            >
              History
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            {empty ? (
              <div className="animate-in-up pt-6">
                <h2 className="text-2xl font-semibold tracking-tight text-fg">
                  How can I <span className="ai-text">help</span> today?
                </h2>
                <p className="mt-1 text-sm text-muted">
                  I can read the live state of your automations, services and recent runs, and I can run
                  an automation for you once you confirm it.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/automations/new")}
                  className="ai-surface mt-5 flex w-full items-center gap-3 rounded-2xl border border-brand/20 p-4 text-left transition hover:border-brand/40"
                >
                  <IWand className="text-brand" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-fg">Automate something new</span>
                    <span className="block text-xs text-muted">Describe it in plain words; I'll build it for you to review.</span>
                  </span>
                  <span className="text-xs font-medium text-brand">Start →</span>
                </button>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => submit(prompt)}
                      className="card-interactive px-3.5 py-2.5 text-left text-sm text-fg/90"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                {!snapshot.aiReady && (
                  <p className="mt-5 rounded-lg border border-warn/30 bg-warn/5 px-3.5 py-2.5 text-xs text-warn">
                    No AI provider is configured yet. Add one in Settings → AI — until then this
                    chat cannot answer.
                  </p>
                )}
              </div>
            ) : (
              turns.map((turn) => (
                <ChatMessage
                  key={turn.id}
                  turn={turn}
                  onConfirm={(id, proposal) => void confirm(id, proposal)}
                  onCancel={assistant.cancelAction}
                  onAction={(a) => void runAssistantAction(a)}
                />
              ))
            )}
            {assistant.generating && (
              <ChatPending stage={assistant.stage === "consulting" ? "consulting" : "generating"} />
            )}
          </div>
        </div>

        <ChatInput
          value={draft}
          onChange={setDraft}
          onSend={() => submit()}
          onStop={assistant.stop}
          generating={assistant.generating}
          hint={
            snapshot.contextReady
              ? "Enter to send · Shift+Enter for a new line · answers use live system data"
              : "Loading system data…"
          }
        />
      </div>

      {/* conversation history */}
      <aside
        className={cn(
          "card w-64 shrink-0 flex-col overflow-hidden",
          historyOpen ? "flex" : "hidden lg:flex",
        )}
      >
        <div className="border-b border-border px-3 py-3">
          <p className="eyebrow">Conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {assistant.conversations.map((c) => (
            <div key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  assistant.setActiveId(c.id);
                  setHistoryOpen(false);
                }}
                className={cn(
                  "w-full rounded-lg px-2.5 py-2 pr-7 text-left transition-colors",
                  c.id === assistant.activeId ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
                )}
              >
                <span className="block truncate text-xs font-medium">{c.title}</span>
                <span className="block text-[11px] text-muted">
                  {c.turns.length === 0 ? "Empty" : relativeTime(c.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() => assistant.remove(c.id)}
                className="absolute right-1.5 top-2 rounded p-1 text-muted opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <p className="border-t border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          History is stored in this browser only — the backend has no conversation API.
        </p>
      </aside>
    </div>
  );
}
