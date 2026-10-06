/**
 * The dashboard's one-paragraph read on what the assistant has been doing.
 *
 * It is a real generation against the configured provider, fed the same live
 * context the chat uses - not a canned sentence. Two consequences are handled
 * deliberately: it only runs when AI is actually configured, and the result is
 * kept in memory for a while so navigating back to the dashboard does not bill
 * a request every time. The cache is a module variable rather than browser
 * storage: a summary of the system is not something to leave on disk.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi } from "@/api";
import { INSIGHT_PROMPT, SYSTEM_PROMPT } from "@/ai/prompt";
import { INSIGHT_MAX_TOKENS, extractInsight } from "@/ai/insight";
import { errorMessage } from "@/components/common";
import { Skeleton } from "@/components/ui";
import { relativeTime } from "@/utils/format";

const MAX_AGE_MS = 15 * 60_000;

interface CachedInsight {
  text: string;
  at: string;
}

/** Lives as long as the tab does, and no longer. */
let cache: CachedInsight | null = null;

function readCache(): CachedInsight | null {
  if (!cache) return null;
  return Date.now() - new Date(cache.at).getTime() > MAX_AGE_MS ? null : cache;
}

function writeCache(value: CachedInsight): void {
  cache = value;
}

export function AiInsight({
  getContext,
  ready,
  contextReady,
}: {
  getContext: () => string;
  /** AI is configured and answering. */
  ready: boolean;
  /** The live data the context is built from has arrived. */
  contextReady: boolean;
}) {
  const [insight, setInsight] = useState<CachedInsight | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await aiApi.generate(
        {
          system: SYSTEM_PROMPT,
          messages: [
            { role: "system", content: getContext() },
            { role: "user", content: INSIGHT_PROMPT },
          ],
          // A reasoning model needs room to think *and* answer; the previous
          // 220 spent the whole budget thinking and was cut off mid-thought.
          //
          // No `json_schema` here on purpose: the backend rejects a reply that
          // does not match the schema, and this model fails that often enough
          // (verified: "not valid JSON", "missing required field(s): insight")
          // that asking for it turned a cosmetic leak into a 502. The prompt
          // asks for a `RESUMEN:` line instead and `extractInsight` finds it.
          max_tokens: INSIGHT_MAX_TOKENS,
        },
        controller.signal,
      );
      const { text } = extractInsight(response);
      if (text) {
        const value = { text, at: new Date().toISOString() };
        setInsight(value);
        writeCache(value);
      } else {
        setError(
          "El modelo devolvió solo su razonamiento interno, sin resumen. Pulsa Refresh para reintentar.",
        );
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(errorMessage(err));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [getContext]);

  // One automatic generation per session window, once there is data to describe.
  useEffect(() => {
    if (!ready || !contextReady || insight || loading) return;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, contextReady]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="eyebrow">AI insight</p>
        {ready && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading || !contextReady}
            className="text-xs text-muted transition-colors hover:text-fg disabled:opacity-50"
          >
            {loading ? "Generating…" : "Refresh"}
          </button>
        )}
      </div>

      <div className="px-4 py-4">
        {!ready ? (
          <p className="text-sm text-muted">
            No AI provider is configured, so there is nothing to summarise yet. Add one under{" "}
            <span className="text-fg">AI</span> and this panel starts reporting on your automations.
          </p>
        ) : loading && !insight ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : insight ? (
          <>
            <p className="text-sm leading-relaxed text-fg/90">{insight.text}</p>
            <p className="mt-2 text-[11px] text-muted">Generated {relativeTime(insight.at)} from live system data</p>
          </>
        ) : (
          <p className="text-sm text-muted">Waiting for system data…</p>
        )}
      </div>
    </section>
  );
}
