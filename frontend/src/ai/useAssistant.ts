/**
 * The chat state machine.
 *
 * One in-flight generation at a time, cancellable: Stop aborts the actual HTTP
 * request through `AbortController`, it does not merely hide the spinner.
 *
 * Answers stream (`/api/ai/generate/stream`): the turn appears with the first
 * token and grows as the rest arrives. Stop keeps what had arrived, marked as
 * stopped; a provider failure part-way keeps it too, with the reason. A backend
 * without the streaming route (an older install) is answered in one shot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiApi, AiStreamError, ApiError } from "@/api";
import type { AiGenerateRequest, AiGenerateResponse } from "@/api/types";
import { assistantApi, type AskResult } from "@/api/platform";
import type { AiChatMessage } from "@/api/types";
import { errorMessage } from "@/components/common";
import { runAction, parseReply, visibleWhileStreaming, type ActionProposal } from "./actions";
import { SYSTEM_PROMPT } from "./prompt";
import { lookup, planLookup } from "./pipelines";
import {
  emptyConversation,
  loadConversations,
  newId,
  saveConversations,
  titleFor,
  type ChatTurn,
  type Conversation,
} from "./conversations";

/** How many previous turns travel with each request. */
const HISTORY_DEPTH = 12;
/** Re-render a growing answer at most this often (ms). */
const STREAM_FLUSH_MS = 60;

/** Stream when the backend can; answer in one shot when it predates streaming. */
async function generateReply(
  input: AiGenerateRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<AiGenerateResponse> {
  try {
    return await aiApi.generateStream(input, { signal, onText });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      return aiApi.generate(input, signal);
    }
    throw err;
  }
}

export interface UseAssistantOptions {
  /** Built fresh for every request, so the model always sees current data. */
  getContext: () => string;
  /** False while the panel knows AI is not configured - send is then refused. */
  ready: boolean;
}

export function useAssistant({ getContext, ready }: UseAssistantOptions) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadConversations();
    return stored.length ? stored : [emptyConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => "");
  const [generating, setGenerating] = useState(false);
  /** What the assistant is busy with, so the UI can say which. */
  const [stage, setStage] = useState<"idle" | "consulting" | "generating" | "streaming">("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!activeId && conversations.length) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  // Not while an answer is arriving: every flush would rewrite the saved
  // transcript.
  // The finished turn is saved the moment generation ends.
  useEffect(() => {
    if (!generating) saveConversations(conversations);
  }, [conversations, generating]);

  // A pending request must not outlive the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  /** `conversationId` pins the change to the conversation a request started in,
   *  so switching conversations while an answer streams cannot misfile it. */
  const appendTurn = useCallback(
    (turn: ChatTurn, conversationId?: string) => {
      setConversations((list) => {
        const target = conversationId || activeId || list[0]?.id;
        return list.map((c) =>
          c.id === target
            ? {
                ...c,
                title: c.turns.length === 0 && turn.role === "user" ? titleFor(turn.content) : c.title,
                updatedAt: new Date().toISOString(),
                turns: [...c.turns, turn],
              }
            : c,
        );
      });
    },
    [activeId],
  );

  /** Turn ids are unique, so the turn is found wherever it lives. */
  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setConversations((list) =>
      list.map((c) =>
        c.turns.some((t) => t.id === id)
          ? { ...c, updatedAt: new Date().toISOString(), turns: c.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
          : c,
      ),
    );
  }, []);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || generating) return;

      const current = conversations.find((c) => c.id === (activeId || conversations[0]?.id));
      const conversationId = current?.id ?? "";
      const history: AiChatMessage[] = (current?.turns ?? [])
        .filter((t) => !t.failed)
        .slice(-HISTORY_DEPTH)
        .map((t) => ({ role: t.role, content: t.content }));

      appendTurn({ id: newId(), role: "user", content: prompt, at: new Date().toISOString() }, conversationId);

      if (!ready) {
        appendTurn({
          id: newId(),
          role: "assistant",
          // Plain prose: a failed turn is rendered as text, not Markdown, so
          // emphasis markers would show up as literal asterisks.
          content:
            "No AI provider is configured yet, so I cannot answer. Open AI in the sidebar, add a " +
            "provider key and run Test connection — after that this chat works.",
          at: new Date().toISOString(),
          failed: true,
        }, conversationId);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setGenerating(true);
      let replyId = "";
      let replyShown = false;
      let partial = "";

      try {
        // Only fetch the automation results the question actually calls for:
        // each module costs the backend a round of execution fetches from n8n.
        const plan = planLookup(prompt);
        let results = { context: "", sources: [] as { module: string; label: string; count: number }[] };
        if (plan.modules.length > 0) {
          setStage("consulting");
          const outcome = await lookup(plan, controller.signal);
          results = { context: outcome.context, sources: outcome.sources };
        }

        // The user's own day (mail, calendar, deadlines): cards for the UI and a
        // compact context for the model. A failure here never blocks the answer.
        let personal: AskResult | null = null;
        try {
          setStage("consulting");
          personal = await assistantApi.ask(prompt);
        } catch {
          personal = null;
        }
        const useful = personal && (personal.sections.length > 0 || personal.actions.length > 0 || personal.notes.length > 0);

        setStage("generating");
        const structured = useful
          ? { title: personal!.title, sections: personal!.sections, actions: personal!.actions, notes: personal!.notes }
          : undefined;
        const sources = results.sources.length ? results.sources : undefined;

        // The answer's turn exists from the first token on and grows in place.
        replyId = newId();
        const id = replyId;
        let pendingText = "";
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
          flushTimer = null;
          updateTurn(id, { content: visibleWhileStreaming(pendingText) });
        };
        const onText = (text: string) => {
          pendingText = text;
          partial = text;
          if (!replyShown) {
            replyShown = true;
            setStage("streaming");
            appendTurn({
              id,
              role: "assistant",
              content: visibleWhileStreaming(text),
              at: new Date().toISOString(),
              streaming: true,
              structured,
              sources,
            }, conversationId);
          } else if (!flushTimer) {
            flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
          }
        };

        let response: AiGenerateResponse;
        try {
          response = await generateReply(
            {
              system: SYSTEM_PROMPT,
              messages: [
                { role: "system", content: getContext() },
                ...(results.context ? [{ role: "system" as const, content: results.context }] : []),
                ...(useful ? [{ role: "system" as const, content: `PERSONAL CONTEXT\n${personal!.context}` }] : []),
                ...history,
                { role: "user", content: prompt },
              ],
            },
            controller.signal,
            onText,
          );
        } finally {
          if (flushTimer) clearTimeout(flushTimer);
        }

        const { text: body, action } = parseReply(response.text ?? "");
        const finished: Partial<ChatTurn> = {
          content: body || "(the provider returned an empty answer)",
          streaming: false,
          action: action ? { proposal: action, state: "pending" } : undefined,
          meta: {
            provider: response.provider,
            model: response.model,
            latencyMs: Math.round(response.latency_ms ?? 0),
            usedFallback: Boolean(response.used_fallback),
          },
        };
        if (replyShown) {
          updateTurn(id, finished);
        } else {
          // One-shot answer (older backend): nothing was shown yet.
          appendTurn({ id, role: "assistant", at: new Date().toISOString(), structured, sources, ...finished } as ChatTurn, conversationId);
        }
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        if (replyShown && replyId) {
          // Part of the answer is on screen: keep it, and say why it stopped.
          const kept = err instanceof AiStreamError ? err.partial || partial : partial;
          updateTurn(replyId, {
            content: parseReply(kept).text || "…",
            streaming: false,
            interrupted: aborted ? "Stopped." : `The answer was interrupted: ${errorMessage(err)}`,
          });
        } else if (aborted) {
          appendTurn({
            id: newId(),
            role: "assistant",
            content: "_Generation stopped._",
            at: new Date().toISOString(),
            failed: true,
          }, conversationId);
        } else {
          const detail =
            err instanceof ApiError && err.status === 503
              ? "No AI provider is configured on the backend yet."
              : errorMessage(err);
          appendTurn({
            id: newId(),
            role: "assistant",
            content: detail,
            at: new Date().toISOString(),
            failed: true,
          }, conversationId);
        }
      } finally {
        abortRef.current = null;
        setGenerating(false);
        setStage("idle");
      }
    },
    [activeId, appendTurn, conversations, generating, getContext, ready, updateTurn],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const startNew = useCallback(() => {
    const fresh = emptyConversation();
    setConversations((list) => [fresh, ...list.filter((c) => c.turns.length > 0)]);
    setActiveId(fresh.id);
  }, []);

  const remove = useCallback(
    (id: string) => {
      setConversations((list) => {
        const next = list.filter((c) => c.id !== id);
        const result = next.length ? next : [emptyConversation()];
        if (id === activeId) setActiveId(result[0].id);
        return result;
      });
    },
    [activeId],
  );

  /** Confirm-and-run, then record the outcome on the turn that proposed it. */
  const confirmAction = useCallback(
    async (turnId: string, proposal: ActionProposal) => {
      updateTurn(turnId, { action: { proposal, state: "running" } });
      try {
        const outcome = await runAction(proposal);
        updateTurn(turnId, {
          action: {
            proposal,
            state: outcome.ok ? "done" : "failed",
            message: outcome.message,
          },
        });
        return outcome;
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 501
            ? "n8n's public API cannot execute this workflow on demand. Trigger it from its webhook or the n8n editor."
            : errorMessage(err);
        updateTurn(turnId, { action: { proposal, state: "failed", message } });
        return { ok: false, message };
      }
    },
    [updateTurn],
  );

  /** A reply the assistant produced without a model call (e.g. a generated briefing). */
  const addAssistantText = useCallback(
    (content: string) => {
      appendTurn({ id: newId(), role: "assistant", content, at: new Date().toISOString() });
    },
    [appendTurn],
  );

  const cancelAction = useCallback(
    (turnId: string, proposal: ActionProposal) => {
      updateTurn(turnId, { action: { proposal, state: "cancelled", message: "Cancelled." } });
    },
    [updateTurn],
  );

  return {
    conversations,
    active,
    activeId: active?.id ?? "",
    setActiveId,
    generating,
    stage,
    send,
    stop,
    startNew,
    remove,
    confirmAction,
    cancelAction,
    addAssistantText,
  };
}
