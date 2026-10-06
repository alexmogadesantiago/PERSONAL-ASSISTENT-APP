/**
 * Conversation storage.
 *
 * The backend has no conversation endpoint - `/api/ai/generate` is stateless -
 * so history lives in this browser and nowhere else. That is a deliberate
 * limit, not a stand-in for a missing API: no transcript is uploaded anywhere,
 * and clearing site data clears it.
 */
import type { AskResult } from "@/api/platform";
import type { ActionProposal } from "./actions";

export interface TurnAction {
  proposal: ActionProposal;
  state: "pending" | "running" | "done" | "cancelled" | "failed";
  message?: string;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  /** Set when the assistant proposed an operation with this turn. */
  action?: TurnAction;
  /** True when the turn records a failure rather than a model reply. */
  failed?: boolean;
  meta?: { provider: string; model: string; latencyMs: number; usedFallback: boolean };
  /** Cards the assistant attached (email / calendar / deadlines / problems) and its buttons. */
  structured?: Pick<AskResult, "title" | "sections" | "actions" | "notes">;
  /** Automation modules consulted to answer this turn, for the sources line. */
  sources?: { module: string; label: string; count: number }[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
}

const KEY = "ac.assistant.conversations";
const MAX_CONVERSATIONS = 20;
const MAX_TURNS = 120;

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function emptyConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: newId(), title: "New conversation", createdAt: now, updatedAt: now, turns: [] };
}

export function loadConversations(): Conversation[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation).slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    const trimmed = list
      .slice(0, MAX_CONVERSATIONS)
      .map((c) => ({ ...c, turns: c.turns.slice(-MAX_TURNS) }));
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or blocked: the session still works, it just won't persist */
  }
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && Array.isArray(c.turns);
}

/** First user message, shortened - the same convention every chat app uses. */
export function titleFor(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}
