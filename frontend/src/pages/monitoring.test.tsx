import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonitoringPage } from "./MonitoringPage";
import { Route, Routes } from "react-router-dom";
import { SettingsPage } from "./SettingsPage";
import { installFetchStub, renderWithProviders, sampleUser } from "@/test/utils";
import { setSession } from "@/api/tokenStore";

/**
 * The monitoring page is the screen a user trusts to tell them whether the
 * system works, so these tests pin the two things that would make it lie:
 * showing a service as broken when it was simply never configured, and
 * showing a half-working integration as healthy.
 */

const service = (over: Record<string, unknown>) => ({
  name: "x",
  kind: "http",
  target: "",
  status: "unknown",
  online: null,
  configured: false,
  detail: "",
  latency_ms: null,
  checked_at: new Date().toISOString(),
  meta: {},
  ...over,
});

const statusBody = (services: unknown[]) => ({
  operational: true,
  state: "operational",
  degraded_services: [],
  not_configured_services: [],
  services,
  checked_at: new Date().toISOString(),
});

const metrics = {
  cpu_percent: 10,
  memory_percent: 20,
  memory_used_mb: 1024,
  memory_total_mb: 8192,
  disk_percent: 30,
  disk_free_gb: 100,
  disk_total_gb: 200,
  load_avg_1m: 0.1,
  uptime_seconds: 60,
  sampled_at: new Date().toISOString(),
};

const MIXED = [
  service({ name: "postgres", kind: "db", status: "online", online: true, configured: true, detail: "SELECT 1 ok", latency_ms: 4 }),
  service({ name: "n8n", status: "degraded", online: null, configured: true, detail: "reachable but the API key was rejected (HTTP 401)", latency_ms: 12 }),
  service({ name: "playwright", status: "not_configured", detail: "not configured: AC_PLAYWRIGHT_BASE_URL" }),
  service({ name: "profile", kind: "data", status: "configured", online: true, configured: true, detail: "1 complete profile(s)", latency_ms: 2 }),
  service({
    name: "ai",
    kind: "provider",
    status: "invalid",
    online: false,
    configured: true,
    detail: "the API key was rejected (HTTP 403)",
    latency_ms: 30,
    meta: { provider: "nvidia_nim", provider_label: "NVIDIA NIM", model: "meta/llama-3.3-70b-instruct" },
  }),
];

beforeEach(() => {
  setSession({
    access_token: "t",
    refresh_token: "r",
    expires_at: Date.now() + 30 * 60_000,
    user: sampleUser,
  });
  // No real WebSocket in jsdom: the page must fall back to the REST snapshot.
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
});

describe("MonitoringPage", () => {
  it("renders every service with its real state, latency and message", async () => {
    installFetchStub({
      "GET /api/system/status": { body: statusBody(MIXED) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByText("PostgreSQL")).toBeInTheDocument();
    // scope to the table: the page also carries a legend explaining the states
    const table = within(screen.getByRole("table"));
    expect(table.getByText("AI")).toBeInTheDocument();
    // the AI row names the provider and model actually in use
    expect(table.getByText(/NVIDIA NIM · meta\/llama-3.3-70b-instruct/)).toBeInTheDocument();

    // a service nobody configured is grey "not configured", never "offline"
    expect(table.getByText("not configured")).toBeInTheDocument();
    expect(table.queryByText("offline")).not.toBeInTheDocument();

    // a reachable n8n that rejects the key must not read as healthy
    expect(table.getByText("degraded")).toBeInTheDocument();
    expect(table.getByText(/reachable but the API key was rejected/i)).toBeInTheDocument();

    // rejected credentials are "invalid", which is distinct from an outage
    expect(table.getByText("invalid")).toBeInTheDocument();

    // profile data in Postgres is healthy as "configured"
    expect(table.getByText("configured")).toBeInTheDocument();

    // latency and last-check columns carry real numbers
    expect(table.getByText("4 ms")).toBeInTheDocument();
  });

  it("says when a generation was really served by the fallback", async () => {
    // The primary is reachable again, so the status is healthy - but an
    // automation was served by the fallback minutes ago and that must show.
    const rows = [
      service({
        name: "ai",
        kind: "provider",
        status: "online",
        online: true,
        configured: true,
        detail: "credential accepted",
        latency_ms: 180,
        meta: {
          provider: "nvidia_nim",
          provider_label: "NVIDIA NIM",
          model: "nvidia/nemotron-3-super-120b-a12b",
          last_fallback: {
            at: new Date(Date.now() - 5 * 60_000).toISOString(),
            age_seconds: 300,
            primary: "nvidia_nim",
            fallback: "openrouter",
            reason: "rate limit or quota exceeded (HTTP 429)",
          },
        },
      }),
    ];
    installFetchStub({
      "GET /api/system/status": { body: statusBody(rows) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(<MonitoringPage />);

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("online")).toBeInTheDocument();
    expect(table.getByText(/Fell back .*nvidia_nim .*openrouter/)).toBeInTheDocument();
    expect(table.getByText(/HTTP 429/)).toBeInTheDocument();
  });

  it("shows the probe's last error when it adds to the message", async () => {
    const rows = [
      service({
        name: "ai",
        kind: "provider",
        status: "degraded",
        online: null,
        configured: true,
        detail: "primary NVIDIA NIM unavailable, serving from OpenRouter",
        latency_ms: 210,
        meta: {
          provider: "nvidia_nim",
          provider_label: "NVIDIA NIM",
          model: "m",
          fallback_provider: "openrouter",
          fallback_label: "OpenRouter",
          error: "provider error (HTTP 503)",
        },
      }),
    ];
    installFetchStub({
      "GET /api/system/status": { body: statusBody(rows) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(<MonitoringPage />);

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("provider error (HTTP 503)")).toBeInTheDocument();
    // named twice on purpose: once under the service name, once in the message
    expect(table.getAllByText(/serving from OpenRouter/).length).toBeGreaterThan(0);
  });

  it("CHECK SERVICES triggers a real forced re-probe", async () => {
    const healthy = MIXED.map((s) =>
      s.name === "n8n"
        ? service({ ...s, status: "online", online: true, detail: "HTTP 200, API key accepted" })
        : s,
    );
    const { calls } = installFetchStub({
      "GET /api/system/status": { body: statusBody(MIXED) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
      "POST /api/system/check": { body: statusBody(healthy) },
    });
    renderWithProviders(<MonitoringPage />);
    await screen.findByText("PostgreSQL");

    await userEvent.click(screen.getByRole("button", { name: /check services/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/system/check"))).toBe(true),
    );
    // the forced result replaces the cached one straight away
    expect(await screen.findByText(/API key accepted/i)).toBeInTheDocument();
  });

  it("keeps the platform 'operational' when only unconfigured services remain", async () => {
    const onlyUnconfigured = [
      service({ name: "postgres", kind: "db", status: "online", online: true, configured: true, detail: "SELECT 1 ok", latency_ms: 3 }),
      service({ name: "n8n", status: "not_configured", detail: "not configured: AC_N8N_BASE_URL" }),
    ];
    installFetchStub({
      "GET /api/system/status": { body: statusBody(onlyUnconfigured) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByText("1 not configured yet")).toBeInTheDocument();
  });
});

describe("SettingsPage service configuration", () => {
  // The AI panel shares the page; stub it so the test exercises the real
  // layout rather than an error state that happens to hide the AI fields.
  const aiConfig = () => ({
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
  });
  const aiProviders = () => [
    {
      id: "nvidia_nim",
      label: "NVIDIA NIM",
      tagline: "Recommended.",
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
    },
  ];

  const configs = {
    data: [
      {
        service: "n8n",
        label: "n8n",
        configured: false,
        enabled: true,
        source: "none",
        base_url: "",
        requires_url: true,
        requires_secret: true,
        secret_configured: false,
        secret_hint: "",
        missing: ["AC_N8N_BASE_URL", "AC_N8N_API_KEY"],
        last_tested_at: null,
        last_test_ok: null,
        last_test_detail: "",
      },
    ],
  };

  it("saves an endpoint and key without ever displaying the secret", async () => {
    const saved = {
      ...configs.data[0],
      configured: true,
      source: "database",
      base_url: "https://n8n.example.com",
      secret_configured: true,
      secret_hint: "...9abc",
      missing: [],
    };
    const { calls } = installFetchStub({
      "GET /api/services/config": { body: configs },
      "PUT /api/services/config/n8n": { body: saved },
      "GET /api/health": { body: { status: "ok", version: "0", environment: "testing", database: "ok", problems: [] } },
      "GET /api/system/status": { body: statusBody([]) },
      "GET /api/n8n/health": { body: { base_url: "", api_key_configured: false, status: "not_configured" } },
      "GET /api/ai/config": { body: aiConfig() },
      "GET /api/ai/providers": { body: { data: aiProviders() } },
      "GET /api/ai/models": { body: { provider: "nvidia_nim", live: true, detail: "", data: [] } },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>,
      { route: "/settings/advanced" },
    );

    const url = await screen.findByLabelText(/base url/i);
    await userEvent.type(url, "https://n8n.example.com");
    await userEvent.type(screen.getByLabelText(/api key/i), "my-secret-key");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const put = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const sent = JSON.parse(String(put.init?.body));
    expect(sent).toEqual({ base_url: "https://n8n.example.com", secret: "my-secret-key" });

    // the field is cleared and the stored key is only ever shown as a hint
    await waitFor(() => expect(screen.getByLabelText(/api key/i)).toHaveValue(""));
    expect(screen.queryByText("my-secret-key")).not.toBeInTheDocument();
  });

  it("saving only the URL does not send an empty secret that would wipe the key", async () => {
    const stored = {
      ...configs.data[0],
      configured: true,
      source: "database",
      base_url: "https://old.example.com",
      secret_configured: true,
      secret_hint: "...9abc",
      missing: [],
    };
    const { calls } = installFetchStub({
      "GET /api/services/config": { body: { data: [stored] } },
      "PUT /api/services/config/n8n": { body: stored },
      "GET /api/health": { body: { status: "ok", version: "0", environment: "testing", database: "ok", problems: [] } },
      "GET /api/system/status": { body: statusBody([]) },
      "GET /api/n8n/health": { body: { base_url: "", api_key_configured: true, status: "online" } },
      "GET /api/ai/config": { body: aiConfig() },
      "GET /api/ai/providers": { body: { data: aiProviders() } },
      "GET /api/ai/models": { body: { provider: "nvidia_nim", live: true, detail: "", data: [] } },
      "GET /api/auth/me": { body: sampleUser },
    });
    renderWithProviders(
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>,
      { route: "/settings/advanced" },
    );

    await screen.findByDisplayValue("https://old.example.com");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const put = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    expect(JSON.parse(String(put.init?.body))).toEqual({ base_url: "https://old.example.com" });
  });
});

/**
 * The AI card reads `/api/ai/health`, which knows two things the generic
 * service row cannot: whether the fallback is itself usable, and which
 * generation last really fell back.
 */
const AI_PROVIDERS = [
  { id: "nvidia_nim", label: "NVIDIA NIM", secret_configured: true },
  { id: "openrouter", label: "OpenRouter", secret_configured: true },
  { id: "gemini", label: "Gemini", secret_configured: false },
];

const aiHealth = (over: Record<string, unknown> = {}) => ({
  status: "online",
  detail: "credential accepted",
  provider: "nvidia_nim",
  model: "nvidia/nemotron-3-super-120b-a12b",
  latency_ms: 470,
  fallback_provider: "openrouter",
  fallback_status: "online",
  error: "",
  cached: false,
  checked_at: new Date().toISOString(),
  last_fallback: null,
  ...over,
});

function monitorStub(health: Record<string, unknown>) {
  return installFetchStub({
    "GET /api/system/status": { body: statusBody([]) },
    "GET /api/system/metrics": { body: metrics },
    "GET /api/auth/me": { body: sampleUser },
    "GET /api/ai/health": { body: health },
    "GET /api/ai/providers": { body: { data: AI_PROVIDERS } },
  });
}

describe("MonitoringPage — AI provider card", () => {
  it("names the provider, the model, the status and the latency", async () => {
    monitorStub(aiHealth());
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByText("AI provider")).toBeInTheDocument();
    expect(screen.getByTestId("ai-health-status")).toHaveTextContent("online");
    // the label comes from the backend's registry, not from a list in React
    expect(screen.getByText("NVIDIA NIM")).toBeInTheDocument();
    expect(screen.getByText("nvidia/nemotron-3-super-120b-a12b")).toBeInTheDocument();
    expect(screen.getByText("470 ms")).toBeInTheDocument();
    // the fallback is named as a fallback, not as a second live provider
    expect(screen.getByText(/Fallback:/)).toHaveTextContent("OpenRouter");
    expect(screen.getByText(/Used only when the primary itself fails/)).toBeInTheDocument();
  });

  it("reports OFFLINE with the provider's error instead of a green light", async () => {
    monitorStub(
      aiHealth({
        status: "offline",
        detail: "the provider did not answer",
        error: "connection timed out after 60s",
        latency_ms: null,
      }),
    );
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByTestId("ai-health-status")).toHaveTextContent("offline");
    expect(screen.getByText("connection timed out after 60s")).toBeInTheDocument();
  });

  it("says NOT CONFIGURED when no provider is set up, and that is not an outage", async () => {
    monitorStub(
      aiHealth({
        status: "not_configured",
        detail: "no AI provider is configured",
        provider: "",
        model: "",
        latency_ms: null,
        fallback_provider: "",
        fallback_status: "",
      }),
    );
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByTestId("ai-health-status")).toHaveTextContent("not configured");
    expect(screen.getByText(/No fallback available/)).toBeInTheDocument();
  });

  it("shows the last generation that really fell back, with its reason", async () => {
    monitorStub(
      aiHealth({
        last_fallback: {
          at: new Date(Date.now() - 4 * 60_000).toISOString(),
          age_seconds: 240,
          primary: "nvidia_nim",
          fallback: "openrouter",
          reason: "rate limit or quota exceeded (HTTP 429)",
        },
      }),
    );
    renderWithProviders(<MonitoringPage />);

    const notice = await screen.findByText(/Last fallback/);
    expect(notice).toHaveTextContent("NVIDIA NIM");
    expect(notice).toHaveTextContent("OpenRouter");
    expect(notice).toHaveTextContent("HTTP 429");
  });

  it("keeps the page working when the backend has no AI health endpoint", async () => {
    installFetchStub({
      "GET /api/system/status": { body: statusBody(MIXED) },
      "GET /api/system/metrics": { body: metrics },
      "GET /api/auth/me": { body: sampleUser },
      "GET /api/ai/health": { status: 404, body: { detail: "not found" } },
    });
    renderWithProviders(<MonitoringPage />);

    expect(await screen.findByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("AI provider")).not.toBeInTheDocument();
  });
});
