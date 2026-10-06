/**
 * Getting a clean sentence out of a reasoning model.
 *
 * NVIDIA's Nemotron thinks out loud inside `message.content` - there is no
 * separate reasoning field - so a 220-token budget produced a dashboard showing
 * "We need to answer in at most two sentences..." instead of the summary.
 *
 * Two things were tried against the live provider before settling here:
 *
 *   - `json_schema` on `/api/ai/generate`. The backend validates the object and
 *     returns 502 when it does not match, and this model produced both
 *     "the model response is not valid JSON" and "missing required field(s):
 *     insight". Handing the panel a hard failure is worse than the leak.
 *   - A sentinel line. The model is told to finish with `RESUMEN: <two
 *     sentences>`, which it can satisfy while still thinking beforehand.
 *
 * So extraction is layered, most reliable first, and every layer is anchored on
 * something the model deliberately emitted - never a blind trim. When no layer
 * finds an answer, this returns nothing and the caller says so, because showing
 * a monologue is worse than showing an honest failure.
 */
import type { AiGenerateResponse } from "@/api/types";

/** Enough room for a reasoning model to think *and* then answer. */
export const INSIGHT_MAX_TOKENS = 700;

/** The last line the prompt asks for: `RESUMEN: ...`. */
const SENTINEL = /^[\s>*_-]*RESUMEN\s*[:：]\s*(.+)$/gim;

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const UNCLOSED_THINK = /<think>[\s\S]*$/i;

/** A summary this long stopped being a summary. */
const MAX_LENGTH = 400;

/**
 * Phrases these models use while reasoning, in the first person of someone
 * talking to themselves. None of them belong in a one-line summary, and a real
 * summary about automations would not contain them.
 */
const REASONING_MARKERS: RegExp[] = [
  /\bwe need to\b/i,
  /\bwe should\b/i,
  /\blet me (think|recall|check)\b/i,
  /\blet'?s (output|write|produce|answer|say)\b/i,
  /\bthe user (wants|asks|is asking)\b/i,
  /\bthat'?s (two|2) sentences\b/i,
  /\bSYSTEM CONTEXT\b/,
  /\bno markdown\b/i,
  /\bel usuario (quiere|pide)\b/i,
  /\bdebo (responder|escribir)\b/i,
];

function looksLikeReasoning(text: string): boolean {
  return REASONING_MARKERS.some((re) => re.test(text));
}

function stripThinkTags(raw: string): string {
  return (raw || "").replace(THINK_BLOCK, "").replace(UNCLOSED_THINK, "").trim();
}

/** The `RESUMEN:` line the prompt asked for - the last one, if it repeated. */
function sentinelLine(text: string): string {
  const matches = [...text.matchAll(SENTINEL)];
  if (matches.length === 0) return "";
  return matches[matches.length - 1][1].trim().replace(/^["""]|["""]$/g, "");
}

/**
 * The answer a thinking model quotes to itself before emitting it
 * ( ... so the summary is: "Tu automatizacion ..." ). Long enough to be a
 * sentence, not a stray quoted word.
 */
function lastQuotedSentence(text: string): string {
  const matches = [...text.matchAll(/[""]([^""]{40,})[""]/g), ...text.matchAll(/"([^"]{40,})"/g)];
  if (matches.length === 0) return "";
  return matches[matches.length - 1][1].trim();
}

/** The closing paragraph, which is where the answer lands when nothing else marks it. */
function lastParagraph(text: string): string {
  const parts = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export interface CleanInsight {
  /** Empty when nothing usable could be recovered. */
  text: string;
  /** Which layer produced it, so the caller can report honestly. */
  source: "structured" | "sentinel" | "text" | "recovered" | "none";
}

function accept(text: string, source: CleanInsight["source"]): CleanInsight | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH || looksLikeReasoning(trimmed)) return null;
  return { text: trimmed, source };
}

/** Remove thinking from a plain-text answer without touching legitimate prose. */
export function sanitiseInsight(raw: string): CleanInsight {
  const text = stripThinkTags(raw);
  if (!text) return { text: "", source: "none" };

  return (
    accept(sentinelLine(text), "sentinel") ??
    // No reasoning markers anywhere: the model simply answered.
    accept(looksLikeReasoning(text) ? "" : text, "text") ??
    accept(lastQuotedSentence(text), "recovered") ??
    accept(lastParagraph(text), "recovered") ?? { text: "", source: "none" }
  );
}

/** Prefer a structured field if one ever arrives; otherwise clean the text. */
export function extractInsight(response: AiGenerateResponse): CleanInsight {
  const data = response.data;
  if (data && typeof data === "object") {
    const value = (data as Record<string, unknown>).insight;
    if (typeof value === "string" && value.trim()) {
      return { text: value.trim(), source: "structured" };
    }
  }
  return sanitiseInsight(response.text ?? "");
}
