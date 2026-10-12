import { describe, expect, it } from "vitest";
import { readEventStream } from "./sse";
import { AiStreamError, aiApi } from "./index";
import { setSession } from "./tokenStore";
import { sampleToken } from "@/test/utils";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

async function all(body: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const m of readEventStream(body)) out.push(m);
  return out;
}

describe("readEventStream", () => {
  it("reassembles events split across network chunks", async () => {
    const events = await all(streamOf("event: del", "ta\ndata: {\"text\":\"Ho", "la\"}\n", "\nevent: done\ndata: {}\n\n"));
    expect(events).toEqual([
      { event: "delta", data: '{"text":"Hola"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("skips comments, joins multi-line data, accepts CRLF and a last block without a blank line", async () => {
    const events = await all(streamOf(": keep-alive\r\n\r\ndata: a\r\ndata: b\r\n\r\ndata: tail"));
    expect(events).toEqual([
      { event: "message", data: "a\nb" },
      { event: "message", data: "tail" },
    ]);
  });
});

describe("aiApi.generateStream", () => {
  function serve(body: string, status = 200, type = "text/event-stream") {
    globalThis.fetch = (async () =>
      new Response(streamOf(body), { status, headers: { "content-type": type } })) as typeof fetch;
  }
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  it("reports the growing text and resolves with the generate() shape", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    serve(
      sse("start", { provider: "openrouter", model: "m", used_fallback: true }) +
        sse("delta", { text: "Bon " }) +
        sse("delta", { text: "dia" }) +
        sse("done", { provider: "openrouter", model: "m", latency_ms: 42.4, finish_reason: "stop", usage: {}, used_fallback: true, primary_provider: "nvidia_nim", primary_error: "HTTP 503" }),
    );
    const seen: string[] = [];
    const result = await aiApi.generateStream({ prompt: "hola" }, { onText: (t) => seen.push(t) });
    expect(seen).toEqual(["Bon ", "Bon dia"]);
    expect(result).toMatchObject({ text: "Bon dia", provider: "openrouter", used_fallback: true, primary_error: "HTTP 503" });
  });

  it("keeps what arrived when the provider fails mid-answer", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    serve(sse("delta", { text: "Empiezo" }) + sse("error", { message: "provider died" }));
    const err = await aiApi.generateStream({ prompt: "hola" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiStreamError);
    expect(err.partial).toBe("Empiezo");
    expect(err.message).toBe("provider died");
  });

  it("treats a stream that ends without `done` as cut off", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    serve(sse("delta", { text: "medio" }));
    const err = await aiApi.generateStream({ prompt: "hola" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiStreamError);
    expect(err.partial).toBe("medio");
  });

  it("surfaces an error before the stream as a normal API error", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    serve(JSON.stringify({ detail: "no AI provider is configured" }), 503, "application/json");
    const err = await aiApi.generateStream({ prompt: "hola" }).catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.message).toBe("no AI provider is configured");
  });
});
