import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/stores/theme";
import { ToastProvider } from "@/stores/toast";
import { AuthProvider } from "@/stores/auth";
import { PublicOnly, RequireAuth } from "@/router";
import { Toaster } from "@/components/ui";
import { DashboardPage } from "./DashboardPage";
import { AutomationsPage } from "./AutomationsPage";
import { ServicesPage } from "./ServicesPage";
import { ProfilesPage } from "./ProfilesPage";
import { CredentialsPage } from "./CredentialsPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { InboxPage } from "./InboxPage";
import { makeQueryClient, installFetchStub, sampleUser, sampleToken } from "@/test/utils";
import { setSession } from "@/api/tokenStore";

function wrap(ui: React.ReactElement, route = "/") {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            <Toaster />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const healthOk = { status: "ok", version: "0.1.0", environment: "testing", database: "ok", problems: [] };
const statusOk = {
  operational: true,
  state: "operational",
  degraded_services: [],
  not_configured_services: ["n8n", "playwright", "profile"],
  services: [
    { name: "postgres", kind: "db", target: "application database", status: "online", online: true, detail: "SELECT 1 ok", latency_ms: 2 },
    { name: "n8n", kind: "http", target: "", status: "not_configured", online: null, detail: "AC_N8N_API_KEY not set", latency_ms: null },
    { name: "playwright", kind: "http", target: "", status: "not_configured", online: null, detail: "AC_PLAYWRIGHT_BASE_URL not set", latency_ms: null },
    { name: "profile", kind: "http", target: "", status: "not_configured", online: null, detail: "AC_PROFILE_BASE_URL not set", latency_ms: null },
  ],
  checked_at: new Date().toISOString(),
};

const overviewOk = {
  user: { name: "admin" },
  system: { state: "operational", message: "Your assistant is running normally." },
  automations: { total: 5, active: 3, custom: 1, system: 4 },
  executions: {
    today: 12, failed_today: 1, success_rate_7d: 97.5, avg_duration_ms: 3420,
    series: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, success: i, error: 0 })),
  },
  errors: { open: 1, critical: 1, top: [{ id: "e1", title: "Google Workspace authentication expired", explanation: "x", message: "", severity: "critical", service: "Google Workspace", automation: "Invoices", source: "integration", count: 1, first_seen: null, last_seen: null, action: { label: "Reconnect Google Workspace", href: "/integrations/google", kind: "reconnect" }, link: null }] },
  integrations: { connected: 2, total: 4, unhealthy: [] },
  ai: { requests_today: 7, series: [] },
  n8n: { available: true, error: null },
  open_issues: 1,
};

beforeEach(() => {
  localStorage.clear();
  setSession(null);
  vi.unstubAllGlobals();
});

function GuardHarness({ route }: { route: string }) {
  return wrap(
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<div>LOGIN SCREEN</div>} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<div>DASHBOARD SCREEN</div>} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>,
    route,
  );
}

describe("routing guards", () => {
  it("redirects an anonymous visit to /dashboard to the login screen", async () => {
    installFetchStub({});
    GuardHarness({ route: "/dashboard" });
    expect(await screen.findByText("LOGIN SCREEN")).toBeInTheDocument();
  });

  it("sends an authenticated user away from /login", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({ "GET /api/auth/me": { body: sampleUser } });
    GuardHarness({ route: "/login" });
    expect(await screen.findByText("DASHBOARD SCREEN")).toBeInTheDocument();
  });
});

describe("DashboardPage", () => {
  it("greets the user and shows the overview, with the fix for what needs attention", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    localStorage.setItem("pa.onboarded", "1");
    installFetchStub({
      "GET /api/health": { body: healthOk },
      "GET /api/overview": { body: overviewOk },
      "GET /api/activity": { body: { data: [], sources: { n8n: true, n8n_error: null } } },
    });
    wrap(<DashboardPage />);
    expect(await screen.findByText("Your assistant is ready.")).toBeInTheDocument();
    expect(await screen.findByText("97.5%")).toBeInTheDocument();
    expect(screen.getByText("Reconnect Google Workspace")).toHaveAttribute("href", "/integrations/google");
    expect(screen.getByText("What would you like me to do?")).toBeInTheDocument();
  });

  it("is a command center: today, automations, services and insights, each answering one question", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    localStorage.setItem("pa.onboarded", "1");
    const mail = (id: string, subject: string) => ({ id, thread_id: "t", from: "Marta <m@school.edu>", to: "", subject, date: "", snippet: "", has_attachments: false, attachments: [], labels: [], link: "", unread: true });
    installFetchStub({
      "GET /api/health": { body: healthOk },
      "GET /api/overview": { body: overviewOk },
      "GET /api/activity": { body: { data: [], sources: { n8n: true, n8n_error: null } } },
      "POST /api/assistant/briefing": {
        body: {
          generated_at: new Date().toISOString(), greeting: "Good morning", emails: [mail("1", "TDR"), mail("2", "Lunch")], important: [mail("1", "TDR")],
          events: [{ title: "Maths", start: "2026-10-06T09:00", end: "", location: "", link: "" }], deadlines: [{ title: "TDR presentation", due: "2026-10-09T17:00:00", source: "Marta", href: "/inbox?id=1" }],
          automations: { active: 3, failed_today: 0, success_rate: 98, state: "operational", message: "ok" }, problems: [], summary: "", notes: [],
        },
      },
      "GET /api/assistant/insights": { body: { data: [{ id: "important-unread", kind: "email", severity: "high", title: "1 unread email from important senders", detail: "TDR", action: { label: "Review", href: "/inbox?filter=important" } }] } },
      "GET /api/assistant/suggestions": { body: { data: [{ id: "weekly:a@b.c", kind: "weekly", title: "You receive emails from Club every Monday", detail: "4 Mondays in a row.", prompt: "When I receive an email from a@b.c, summarise it" }] } },
    });
    wrap(<DashboardPage />);
    expect(await screen.findByPlaceholderText("Ask your assistant…")).toBeInTheDocument();
    for (const chip of ["Summarize my emails", "What do I need to do today?", "Create an automation", "What failed today?", "Prepare my daily briefing"]) {
      expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();
    }
    expect(await screen.findByText("important emails")).toBeInTheDocument();
    expect(await screen.findByText("calendar events")).toBeInTheDocument();
    expect(await screen.findByText("deadlines")).toBeInTheDocument();
    expect(await screen.findByText("1 unread email from important senders")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/inbox?filter=important");
    expect(await screen.findByText("You receive emails from Club every Monday")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Never suggest this" })).toBeInTheDocument();
    expect(screen.getByText("Your automations")).toBeInTheDocument();
  });

  it("shows an offline banner when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    wrap(<DashboardPage />);
    expect(
      await screen.findByText("Unable to connect to the Automation Center backend.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("never invents a success rate when there were no runs", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    localStorage.setItem("pa.onboarded", "1");
    installFetchStub({
      "GET /api/health": { body: healthOk },
      "GET /api/overview": {
        body: { ...overviewOk, executions: { ...overviewOk.executions, success_rate_7d: null, avg_duration_ms: null }, errors: { open: 0, critical: 0, top: [] } },
      },
      "GET /api/activity": { body: { data: [], sources: { n8n: true, n8n_error: null } } },
    });
    wrap(<DashboardPage />);
    expect((await screen.findAllByText("no runs yet")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });
});

describe("ServicesPage", () => {
  it("renders unconfigured services as 'not configured', not an outage", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/health": { body: healthOk },
      "GET /api/system/status": { body: statusOk },
      "GET /api/services/config": { body: { data: [] } },
    });
    wrap(<ServicesPage />);
    // optional services read as "not configured", never "offline"
    expect(await screen.findAllByText("Not configured")).toHaveLength(3);
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });
});

describe("AutomationsPage", () => {
  it("activates a system assistant from its switch", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    const { calls } = installFetchStub({
      "GET /api/n8n/health": { body: { base_url: "x", api_key_configured: true, reachable: true, api_key_valid: true } },
      "GET /api/n8n/workflows": { body: { data: [{ id: "w1", name: "Asistente - Noticias", active: false }] } },
      "GET /api/automations": { body: { data: [] } },
      "POST /api/n8n/workflows/w1/activate": { body: { id: "w1", active: true } },
    });
    wrap(<AutomationsPage />);
    const toggle = await screen.findByRole("switch", { name: /Activate Asistente - Noticias/ });
    await userEvent.click(toggle);
    expect(await screen.findByText("Activated")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/api/n8n/workflows/w1/activate"))).toBe(true);
  });

  it("distinguishes an unconfigured n8n from an offline one", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/n8n/health": {
        body: { base_url: "http://n8n:5678", api_key_configured: false, status: "not_configured", reachable: false },
      },
      "GET /api/n8n/workflows": { status: 503, body: { detail: { code: "n8n_not_configured", message: "no key" } } },
    });
    wrap(<AutomationsPage />);
    expect(await screen.findByText("n8n is not configured")).toBeInTheDocument();
    expect(screen.queryByText("n8n is offline")).not.toBeInTheDocument();
  });

  it("shows the n8n offline empty state", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/n8n/health": { body: { base_url: "x", api_key_configured: true, reachable: false, detail: "connection refused" } },
      "GET /api/n8n/workflows": { status: 502, body: { detail: { code: "n8n_unavailable", message: "down" } } },
    });
    wrap(<AutomationsPage />);
    expect(await screen.findByText("n8n unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Your saved automations are safe/)).toBeInTheDocument();
  });
});

describe("empty states", () => {
  it("Profiles shows a first-run empty state", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/profiles": { body: [] },
      "GET /api/profiles/dimensions": { body: { dimensions: ["sector"], note: "open object" } },
    });
    wrap(<ProfilesPage />);
    expect(await screen.findByText("No profiles yet.")).toBeInTheDocument();
  });

  it("Credentials shows the not-configured store warning", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/credentials": { body: [] },
      "GET /api/credentials/store-status": { body: { configured: false } },
    });
    wrap(<CredentialsPage />);
    expect(await screen.findByText(/credential store is not configured/i)).toBeInTheDocument();
  });

  it("Integrations hub shows each pillar with its state and never a secret", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    const svc = (key: string, label: string) => ({ key, label, description: "", capabilities: [], permissions: [{ scope: key, label: `Use ${label}`, access: "read" }] });
    const base = { tagline: "t", description: "d", docs_url: "", console_url: "", default_services: [], used_by: [] };
    installFetchStub({
      "GET /api/integrations": {
        body: {
          store_configured: true,
          data: [
            { ...base, key: "google", label: "Google Workspace", auth: "oauth2", services: [svc("gmail", "Gmail")], status: "expired", connected: true,
              setup: { available: true, source: "database", redirect_uri: "http://localhost:8080/api/integrations/google/callback" },
              connection: { id: "c1", health: "expired", health_detail: "", account: { email: "alex@example.com" }, services: ["gmail"], requested_services: ["gmail"], permissions: [], connected_at: null, last_sync_at: null, last_refresh_at: null, last_tested_at: null, last_test: null, token_expires_at: null, security: { method: "OAuth 2.0 + PKCE", encrypted_at_rest: true, refresh: true, secret_hint: "…ab12" } } },
            { ...base, key: "telegram", label: "Telegram", auth: "bot_token", services: [svc("messages", "Messages")], status: "not_connected", connected: false, setup: { available: true, source: "user", redirect_uri: null }, connection: null },
          ],
        },
      },
    });
    wrap(<IntegrationsPage />);
    expect(await screen.findByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ya29|refresh_token|GOCSPX/);
  });
});

describe("InboxPage", () => {
  it("asks to connect Google when the backend says it is not connected", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    installFetchStub({
      "GET /api/assistant/mail": { status: 409, body: { detail: { message: "Connect Google Workspace to use this step.", provider: "google" } } },
    });
    wrap(<InboxPage />);
    expect(await screen.findByText("Connect Google to use your inbox")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "/integrations/google");
  });

  it("lists mail and triages a message with AI", async () => {
    setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
    const m = { id: "m1", thread_id: "t1", from: "Prof <prof@school.edu>", to: "", subject: "Entrega TDR", date: new Date().toUTCString(), snippet: "Recuerda", has_attachments: false, attachments: [], labels: ["UNREAD"], link: "", unread: true };
    installFetchStub({
      "GET /api/assistant/mail/m1": { body: { ...m, text: "Entrega el viernes." } },
      "GET /api/assistant/mail": { body: { data: [m] } },
      "POST /api/assistant/mail/m1/analyze": { body: { priority: "high", category: "school", action_required: true, summary: "Hay que entregar el TDR.", deadline: null, deadline_title: null, suggested_action: "" } },
    });
    wrap(<InboxPage />);
    await userEvent.click(await screen.findByText("Entrega TDR"));
    await userEvent.click(await screen.findByRole("button", { name: /Analyze with AI/ }));
    expect(await screen.findByText("Priority: high")).toBeInTheDocument();
    expect(screen.getByText("Hay que entregar el TDR.")).toBeInTheDocument();
  });
});

