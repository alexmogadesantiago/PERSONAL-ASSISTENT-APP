import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonitoringPage } from "./MonitoringPage";
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
    renderWithProviders(<SettingsPage />);

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
    renderWithProviders(<SettingsPage />);

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
