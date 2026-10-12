import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAssistantPage } from "./AiAssistantPage";
import { setSession } from "@/api/tokenStore";
import { installFetchStub, renderWithProviders, sampleToken } from "@/test/utils";
import { parseReply } from "@/ai/actions";

/**
 * The assistant is the product's headline feature, so what is tested here is
 * that it is *real*: a message goes to the backend's own generation endpoint
 * carrying live system context, the reply is rendered, and a proposed operation
 * reaches the actual n8n endpoint only after the user confirms it.
 */

const healthOk = { status: "ok", version: "0.1.0", environment: "testing", database: "ok", problems: [] };

const statusOk = {
  operational: true,
  state: "operational",
  degraded_services: [],
  not_configured_services: [],
  services: [
    {
      name: "postgres",
      kind: "db",
      target: "application database",
      status: "online",
      online: true,
      detail: "SELECT 1 ok",
      latency_ms: 2,
    },
  ],
  checked_at: new Date().toISOString(),
};

const WORKFLOWS = {
  data: [{ id: "w1", name: "Asistente - Noticias", active: true, updatedAt: new Date().toISOString() }],
};

const aiHealthOnline = {
  status: "online",
  detail: "answered in 120 ms",
  provider: "nvidia_nim",
  model: "meta/llama-3.3-70b-instruct",
  latency_ms: 120,
  fallback_provider: "",
  fallback_status: "unknown",
  error: "",
  cached: false,
  checked_at: new Date().toISOString(),
  last_fallback: null,
};

function baseRoutes(generate: unknown) {
  return {
    "GET /api/health": { body: healthOk },
    "GET /api/system/status": { body: statusOk },
    "GET /api/system/metrics": { status: 404, body: {} },
    "GET /api/n8n/health": { body: { base_url: "x", api_key_configured: true, reachable: true, status: "online" } },
    "GET /api/n8n/workflows": { body: WORKFLOWS },
    "GET /api/n8n/executions": { body: { data: [] } },
    "GET /api/ai/health": { body: aiHealthOnline },
    "GET /api/ai/config": { body: { configured: true, provider: "nvidia_nim", model: "llama", providers: [] } },
    "GET /api/profiles/completeness": { status: 404, body: {} },
    "POST /api/ai/generate": generate as never,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
  vi.unstubAllGlobals();
  // jsdom has no smooth scrolling
  Element.prototype.scrollTo = vi.fn();
});

describe("parseReply", () => {
  it("separates prose from the action directive", () => {
    const parsed = parseReply(
      'I can run that for you.\n[[action:run_workflow id="w1" name="Noticias"]]',
    );
    expect(parsed.text).toBe("I can run that for you.");
    expect(parsed.action?.kind).toBe("run_workflow");
    expect(parsed.action?.workflowId).toBe("w1");
  });

  it("marks an invented operation as unsupported instead of running something", () => {
    const parsed = parseReply('Sure.\n[[action:delete_everything id="w1"]]');
    expect(parsed.action?.kind).toBe("unsupported");
  });
});

describe("AiAssistantPage", () => {
  it("sends the question with live system context and renders the answer", async () => {
    const { calls } = installFetchStub(
      baseRoutes({
        body: {
          text: "Your system is healthy. **1** automation is active.",
          data: null,
          provider: "nvidia_nim",
          model: "llama-3.3",
          latency_ms: 412,
          finish_reason: "stop",
          usage: {},
          used_fallback: false,
          primary_provider: "nvidia_nim",
          primary_error: "",
        },
      }),
    );

    renderWithProviders(<AiAssistantPage />);
    const box = await screen.findByLabelText("Message the assistant");
    await userEvent.type(box, "Are all services healthy?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(/Your system is healthy/)).toBeInTheDocument();

    const generateCall = calls.find((c) => c.url.includes("/api/ai/generate"));
    expect(generateCall).toBeTruthy();
    const payload = JSON.parse(String(generateCall?.init?.body));
    // the model is given this installation's state, not a generic prompt
    const context = payload.messages.find((m: { role: string }) => m.role === "system")?.content ?? "";
    expect(context).toContain("SYSTEM CONTEXT");
    expect(context).toContain("Asistente - Noticias");
    // and nothing that looks like a credential travels with it
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key/i);
  });

  it("answers a personal question with cards and buttons, not only text", async () => {
    const { calls } = installFetchStub({
      ...baseRoutes({
        body: { text: "You have 2 emails to handle.", data: null, provider: "nvidia_nim", model: "llama", latency_ms: 300, finish_reason: "stop", usage: {}, used_fallback: false, primary_provider: "nvidia_nim", primary_error: "" },
      }),
      "POST /api/assistant/ask": {
        body: {
          intent: "today", title: "You have 3 things to take care of.", demo: false, notes: [], context: "{\"unread_emails\":[{\"subject\":\"TDR\"}]}",
          sections: [
            { key: "email", title: "Email", summary: "2 require action", count: 2, items: [{ title: "TDR presentation", subtitle: "Marta", badge: "high", href: "/inbox?id=m1" }] },
            { key: "calendar", title: "Calendar", summary: "1 event today", count: 1, items: [{ title: "Maths", subtitle: "09:00", href: null }] },
          ],
          actions: [{ label: "Show emails", kind: "navigate", href: "/inbox" }, { label: "Create briefing", kind: "briefing" }],
        },
      },
    });
    renderWithProviders(<AiAssistantPage />);
    await userEvent.type(await screen.findByLabelText("Message the assistant"), "¿Qué tengo pendiente hoy?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("You have 3 things to take care of.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /TDR presentation/ })).toHaveAttribute("href", "/inbox?id=m1");
    expect(screen.getByRole("button", { name: "Show emails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create briefing" })).toBeInTheDocument();
    // the model got the personal context as well as the system snapshot
    const generate = calls.find((c) => c.url.includes("/api/ai/generate"));
    const payload = JSON.parse(String(generate?.init?.body));
    expect(payload.messages.some((m: { content: string }) => m.content.startsWith("PERSONAL CONTEXT"))).toBe(true);
  });

  it("still answers when the personal context is unavailable", async () => {
    installFetchStub({
      ...baseRoutes({
        body: { text: "Everything is fine.", data: null, provider: "nvidia_nim", model: "llama", latency_ms: 100, finish_reason: "stop", usage: {}, used_fallback: false, primary_provider: "nvidia_nim", primary_error: "" },
      }),
      "POST /api/assistant/ask": { status: 502, body: { detail: { message: "boom" } } },
    });
    renderWithProviders(<AiAssistantPage />);
    await userEvent.type(await screen.findByLabelText("Message the assistant"), "hola");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Everything is fine.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Email" })).not.toBeInTheDocument();
  });

  it("asks before running an operation the assistant proposes", async () => {
    const { calls } = installFetchStub({
      ...baseRoutes({
        body: {
          text: 'I can trigger it now.\n[[action:run_workflow id="w1" name="Noticias"]]',
          data: null,
          provider: "nvidia_nim",
          model: "llama-3.3",
          latency_ms: 380,
          finish_reason: "stop",
          usage: {},
          used_fallback: false,
          primary_provider: "",
          primary_error: "",
        },
      }),
      "POST /api/n8n/workflows/w1/run": { body: { started: true } },
    });

    renderWithProviders(<AiAssistantPage />);
    const box = await screen.findByLabelText("Message the assistant");
    await userEvent.type(box, "Run news automation");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    // the proposal is visible and nothing has run yet
    expect(await screen.findByText("AI wants to run")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/workflows/w1/run"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Run automation" }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/workflows/w1/run"))).toBe(true),
    );
  });

  it("explains itself instead of failing when no provider is configured", async () => {
    installFetchStub({
      ...baseRoutes({ status: 503, body: { detail: "no provider" } }),
      "GET /api/ai/config": { body: { configured: false, provider: "", model: "", providers: [] } },
      "GET /api/ai/health": { body: { ...aiHealthOnline, status: "not_configured" } },
    });

    renderWithProviders(<AiAssistantPage />);
    const box = await screen.findByLabelText("Message the assistant");
    await userEvent.type(box, "What happened today?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(/No AI provider is configured yet/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ streaming --- */

/** A stream the test feeds event by event; aborting the request errors it like a browser does. */
function controlledStream() {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  return {
    stream,
    send: (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => ctrl.close(),
    abortWith: (signal?: AbortSignal | null) =>
      signal?.addEventListener("abort", () => ctrl.error(new DOMException("The user aborted a request.", "AbortError"))),
  };
}

function withStreamingGenerate(routes: ReturnType<typeof baseRoutes>) {
  const live = controlledStream();
  const { stub } = installFetchStub(routes);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/generate/stream")) {
        live.abortWith(init?.signal);
        return new Response(live.stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return stub(input, init);
    }),
  );
  return live;
}

const DONE = { provider: "nvidia_nim", model: "llama", latency_ms: 99, finish_reason: "stop", usage: {}, used_fallback: false, primary_provider: "nvidia_nim", primary_error: "" };

async function ask(text: string) {
  renderWithProviders(<AiAssistantPage />);
  await userEvent.type(await screen.findByLabelText("Message the assistant"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
}

describe("AiAssistantPage streaming", () => {
  it("shows the answer as it arrives and settles it when it is done", async () => {
    const live = withStreamingGenerate(baseRoutes({ status: 500, body: {} }));
    await ask("hola");

    live.send("start", { provider: "nvidia_nim", model: "llama", used_fallback: false });
    live.send("delta", { text: "Hola, " });
    expect(await screen.findByText(/Hola,/)).toBeInTheDocument();
    expect(screen.getByTestId("stream-caret")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();

    live.send("delta", { text: "todo **bien**." });
    live.send("done", DONE);
    live.close();
    expect(await screen.findByText(/nvidia_nim · llama · 99 ms/)).toBeInTheDocument();
    expect(screen.getByText("bien").tagName).toBe("STRONG");
    expect(screen.queryByTestId("stream-caret")).not.toBeInTheDocument();
  });

  it("Stop keeps what had arrived instead of throwing it away", async () => {
    const live = withStreamingGenerate(baseRoutes({ status: 500, body: {} }));
    await ask("explícame algo largo");
    live.send("delta", { text: "Primera parte de la respuesta" });
    expect(await screen.findByText(/Primera parte/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(screen.getByText(/Primera parte de la respuesta/)).toBeInTheDocument();
    expect(screen.queryByTestId("stream-caret")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("a provider failure part-way keeps the text and says what happened", async () => {
    const live = withStreamingGenerate(baseRoutes({ status: 500, body: {} }));
    await ask("hola");
    live.send("delta", { text: "Empiezo a contestar" });
    live.send("error", { message: "provider error (HTTP 503)" });
    live.close();
    expect(await screen.findByText(/The answer was interrupted: provider error \(HTTP 503\)/)).toBeInTheDocument();
    expect(screen.getByText(/Empiezo a contestar/)).toBeInTheDocument();
  });

  it("never flashes a half-written action directive, and offers it once complete", async () => {
    const live = withStreamingGenerate(baseRoutes({ status: 500, body: {} }));
    await ask("Run news automation");
    live.send("delta", { text: "I can trigger it now.\n[[action:run_wor" });
    expect(await screen.findByText(/I can trigger it now/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[[action");

    live.send("delta", { text: 'kflow id="w1" name="Noticias"]]' });
    live.send("done", DONE);
    live.close();
    expect(await screen.findByText("AI wants to run")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[[action");
  });

  it("falls back to a one-shot answer on a backend without the streaming route", async () => {
    installFetchStub({
      ...baseRoutes({ body: { text: "Respuesta de una vez.", ...DONE } }),
      "POST /api/ai/generate/stream": { status: 404, body: { detail: "Not Found" } },
    });
    await ask("hola");
    expect(await screen.findByText("Respuesta de una vez.")).toBeInTheDocument();
  });
});
