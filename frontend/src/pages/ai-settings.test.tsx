import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiSettingsCard } from "./settings/AiSettingsCard";
import { setSession } from "@/api/tokenStore";
import { installFetchStub, renderWithProviders, sampleUser } from "@/test/utils";

/**
 * The Artificial Intelligence panel.
 *
 * What is worth testing here is exactly what the backend promises: a provider
 * choice that is a real choice, a model list that admits when it is not live,
 * a key field that never shows the stored value, and a fallback the user can
 * see the effect of.
 */

function provider(over: Record<string, unknown> = {}) {
  return {
    id: "nvidia_nim",
    label: "NVIDIA NIM",
    tagline: "Recommended. High-performance inference.",
    recommended: true,
    api_style: "openai",
    default_base_url: "https://integrate.api.nvidia.com/v1",
    default_model: "meta/llama-3.3-70b-instruct",
    key_help: "build.nvidia.com",
    console_url: "https://build.nvidia.com/",
    service_key: "nvidia_nim",
    configured: false,
    secret_configured: false,
    secret_hint: "",
    base_url: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
    source: "none",
    ...over,
  };
}

const PROVIDERS = [
  provider(),
  provider({
    id: "openrouter",
    label: "OpenRouter",
    tagline: "Many models behind one endpoint.",
    recommended: false,
    service_key: "openrouter",
    default_base_url: "https://openrouter.ai/api/v1",
    default_model: "meta-llama/llama-3.3-70b-instruct",
    base_url: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
  }),
  provider({
    id: "gemini",
    label: "Gemini",
    tagline: "Google AI. Optional.",
    recommended: false,
    service_key: "gemini",
    default_base_url: "https://generativelanguage.googleapis.com",
    default_model: "gemini-2.5-flash",
    base_url: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash",
  }),
];

function config(over: Record<string, unknown> = {}) {
  return {
    provider: "",
    model: "",
    fallback_enabled: true,
    fallback_provider: "",
    fallback_model: "",
    effective_fallback_provider: "",
    temperature: 0.2,
    max_tokens: 2048,
    timeout_seconds: 60,
    source: "default",
    configured: false,
    missing: ["an AI provider (none is configured)"],
    providers: [],
    service_token: { configured: false, source: "none", hint: "" },
    ...over,
  };
}

const LIVE_MODELS = {
  provider: "nvidia_nim",
  live: true,
  detail: "",
  data: [
    { id: "meta/llama-3.3-70b-instruct", label: "meta/llama-3.3-70b-instruct", source: "live" },
    { id: "meta/llama-3.1-8b-instruct", label: "meta/llama-3.1-8b-instruct", source: "live" },
  ],
};

function stub(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  return installFetchStub({
    "GET /api/ai/config": { body: config() },
    "GET /api/ai/providers": { body: { data: PROVIDERS } },
    "GET /api/ai/models": { body: LIVE_MODELS },
    "GET /api/auth/me": { body: sampleUser },
    ...routes,
  });
}

beforeEach(() => {
  setSession({
    access_token: "t",
    refresh_token: "r",
    expires_at: Date.now() + 30 * 60_000,
    user: sampleUser,
  });
});

describe("AiSettingsCard", () => {
  it("offers all three providers and marks NVIDIA NIM as recommended", async () => {
    stub();
    renderWithProviders(<AiSettingsCard canEdit />);

    const group = within(await screen.findByRole("radiogroup", { name: /ai provider/i }));
    expect(group.getByText("NVIDIA NIM")).toBeInTheDocument();
    expect(group.getByText("OpenRouter")).toBeInTheDocument();
    expect(group.getByText("Gemini")).toBeInTheDocument();
    expect(group.getByText("Recommended")).toBeInTheDocument();

    // nothing chosen yet -> the recommended provider is pre-selected
    const options = group.getAllByRole("radio");
    expect(options[0]).toHaveAttribute("aria-checked", "true");
  });

  it("lists the models the provider actually reports", async () => {
    stub();
    renderWithProviders(<AiSettingsCard canEdit />);

    const select = await screen.findByLabelText(/^model$/i);
    await waitFor(() =>
      expect(within(select).getByText("meta/llama-3.1-8b-instruct")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/maintained list/i)).not.toBeInTheDocument();
  });

  it("surfaces whatever caveat the backend attaches to the model list", async () => {
    // The backend owns the wording: "not live", or - for NVIDIA NIM - that a
    // listed model is not necessarily one this account can invoke.
    stub({
      "GET /api/ai/models": {
        body: {
          provider: "nvidia_nim",
          live: false,
          detail: "the provider did not answer; showing the maintained catalogue",
          data: [{ id: "nvidia/nemotron-3-super-120b-a12b", label: "nvidia/nemotron-3-super-120b-a12b", source: "catalog" }],
        },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    expect(await screen.findByText(/maintained catalogue/i)).toBeInTheDocument();
  });

  it("warns that a listed NIM model may not be callable on this account", async () => {
    stub({
      "GET /api/ai/models": {
        body: {
          provider: "nvidia_nim",
          live: true,
          detail:
            "listed by the provider. Not every entry is available on every account - use Test connection to confirm the one you pick.",
          data: [{ id: "nvidia/nemotron-3-super-120b-a12b", label: "nvidia/nemotron-3-super-120b-a12b", source: "live" }],
        },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    expect(await screen.findByText(/Not every entry is available/i)).toBeInTheDocument();
  });

  it("saves the provider, the model and the key in one request", async () => {
    const { calls } = stub({
      "PUT /api/ai/config": {
        body: config({ provider: "nvidia_nim", model: "meta/llama-3.3-70b-instruct", configured: true }),
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    await screen.findByRole("radiogroup", { name: /ai provider/i });
    await userEvent.type(screen.getByLabelText(/provider key/i), "nvapi-my-key");
    await userEvent.click(screen.getByRole("button", { name: /save ai settings/i }));

    const put = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const sent = JSON.parse(String(put.init?.body));
    expect(sent.provider).toBe("nvidia_nim");
    expect(sent.credentials).toEqual([
      { provider: "nvidia_nim", api_key: "nvapi-my-key", model: "meta/llama-3.3-70b-instruct" },
    ]);
  });

  it("an untouched key field means keep the stored key, not wipe it", async () => {
    const stored = config({
      provider: "nvidia_nim",
      model: "meta/llama-3.3-70b-instruct",
      configured: true,
      source: "database",
    });
    const { calls } = stub({
      "GET /api/ai/config": { body: stored },
      "PUT /api/ai/config": { body: stored },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    await screen.findByRole("radiogroup", { name: /ai provider/i });
    await userEvent.click(screen.getByRole("button", { name: /save ai settings/i }));

    const put = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const sent = JSON.parse(String(put.init?.body));
    expect(sent.credentials[0]).not.toHaveProperty("api_key");
  });

  it("never displays the stored key, only a hint", async () => {
    stub({
      "GET /api/ai/providers": {
        body: {
          data: [
            provider({ configured: true, secret_configured: true, secret_hint: "...9abc" }),
            ...PROVIDERS.slice(1),
          ],
        },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    expect(await screen.findByText(/Key stored \(\.\.\.9abc\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/provider key/i)).toHaveValue("");
    expect(screen.getByLabelText(/provider key/i)).toHaveAttribute("type", "password");
  });

  it("runs a real connection test and shows the verdict", async () => {
    const { calls } = stub({
      "GET /api/ai/config": { body: config({ provider: "nvidia_nim", configured: true }) },
      "POST /api/ai/test": {
        body: {
          ok: true,
          provider: "nvidia_nim",
          model: "meta/llama-3.3-70b-instruct",
          status: "online",
          detail: "NVIDIA NIM answered with valid structured JSON",
          latency_ms: 210,
        },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    await userEvent.click(await screen.findByRole("button", { name: /test ai connection/i }));

    expect(await screen.findByText(/ONLINE — NVIDIA NIM answered/)).toBeInTheDocument();
    expect(screen.getByText(/210 ms/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/api/ai/test"))).toBe(true);
  });

  it("reports a failed test instead of a green light", async () => {
    stub({
      "GET /api/ai/config": { body: config({ provider: "nvidia_nim", configured: true }) },
      "POST /api/ai/test": {
        body: {
          ok: false,
          provider: "nvidia_nim",
          model: "",
          status: "invalid",
          detail: "the API key was rejected (HTTP 401)",
          latency_ms: null,
        },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    await userEvent.click(await screen.findByRole("button", { name: /test ai connection/i }));
    expect(await screen.findByText(/INVALID — the API key was rejected/)).toBeInTheDocument();
  });

  it("the test button is unusable until something is configured", async () => {
    stub();
    renderWithProviders(<AiSettingsCard canEdit />);
    expect(await screen.findByRole("button", { name: /test ai connection/i })).toBeDisabled();
  });

  it("shows the active fallback, and the absence of one", async () => {
    stub({
      "GET /api/ai/config": {
        body: config({
          provider: "nvidia_nim",
          configured: true,
          fallback_enabled: true,
          fallback_provider: "openrouter",
          effective_fallback_provider: "openrouter",
        }),
      },
    });
    const { unmount } = renderWithProviders(<AiSettingsCard canEdit />);
    expect(await screen.findByText(/Active fallback: openrouter/)).toBeInTheDocument();
    unmount();

    stub({
      "GET /api/ai/config": {
        body: config({ provider: "nvidia_nim", configured: true, fallback_enabled: true }),
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);
    expect(await screen.findByText(/No usable fallback yet/)).toBeInTheDocument();
  });

  it("hides the fallback picker when fallback is turned off", async () => {
    stub();
    renderWithProviders(<AiSettingsCard canEdit />);

    const toggle = await screen.findByLabelText(/enable fallback/i);
    expect(screen.getByLabelText(/fallback provider/i)).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByLabelText(/fallback provider/i)).not.toBeInTheDocument();
  });

  it("shows the automation token only once, when it is generated", async () => {
    stub({
      "POST /api/ai/service-token": {
        body: { token: "acs_brand-new-token", hint: "...oken", note: "copy it" },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    await userEvent.click(await screen.findByRole("button", { name: /generate/i }));
    expect(await screen.findByText("acs_brand-new-token")).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it("a non-admin sees the state but cannot change it", async () => {
    stub();
    renderWithProviders(<AiSettingsCard canEdit={false} />);

    expect(await screen.findByText(/Only an administrator/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save ai settings/i })).not.toBeInTheDocument();
    const group = within(screen.getByRole("radiogroup", { name: /ai provider/i }));
    group.getAllByRole("radio").forEach((tile) => expect(tile).toBeDisabled());
  });

  it("surfaces a backend error instead of pretending the save worked", async () => {
    stub({ "PUT /api/ai/config": { status: 400, body: { detail: "unknown AI provider: skynet" } } });
    renderWithProviders(<AiSettingsCard canEdit />);

    await screen.findByRole("radiogroup", { name: /ai provider/i });
    await userEvent.click(screen.getByRole("button", { name: /save ai settings/i }));

    expect(await screen.findByText(/unknown AI provider: skynet/)).toBeInTheDocument();
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it("switching provider swaps the model instead of carrying the old one over", async () => {
    stub({
      "GET /api/ai/models": {
        body: { provider: "gemini", live: true, detail: "", data: [] },
      },
    });
    renderWithProviders(<AiSettingsCard canEdit />);

    const group = within(await screen.findByRole("radiogroup", { name: /ai provider/i }));
    await userEvent.click(group.getByText("Gemini"));

    await waitFor(() =>
      expect(screen.getByLabelText(/custom model id/i)).toHaveValue("gemini-2.5-flash"),
    );
  });
});

describe("AI card query wiring", () => {
  it("asks the backend for the models of the selected provider only", async () => {
    const { calls } = stub();
    renderWithProviders(<AiSettingsCard canEdit />);

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/ai/models?provider=nvidia_nim"))).toBe(true),
    );
  });

  it("never requests anything that could return a key", async () => {
    const { calls } = stub();
    renderWithProviders(<AiSettingsCard canEdit />);

    await screen.findByRole("radiogroup", { name: /ai provider/i });
    // there is no endpoint that returns provider secrets, and the card must
    // not invent one
    expect(calls.every((c) => !/secret|api[-_]key/i.test(c.url))).toBe(true);
  });
});

// keep vi referenced for the shared setup helpers
void vi;
