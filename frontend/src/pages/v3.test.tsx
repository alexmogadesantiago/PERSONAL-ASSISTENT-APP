import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { setSession } from "@/api/tokenStore";
import { installFetchStub, renderWithProviders, sampleToken } from "@/test/utils";
import type { Integration } from "@/api/platform";
import { TasksPage } from "./TasksPage";
import { EnginePage } from "./EnginePage";
import { InboxPage } from "./InboxPage";
import { PresentationPage } from "./PresentationPage";
import { DemoSection, MemorySection, PrivacySection, SecurityCenter } from "./settings/AssistantSections";
import { DisconnectDialog, CredentialHealth, PermissionsCenter, TestProgress } from "@/features/integrations/ConnectionPanels";
import { ShortcutsDialog, useGlobalShortcuts } from "@/components/shell/Shortcuts";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { DemoBanner } from "@/components/shell/DemoBanner";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has no scrolling
  localStorage.clear();
  setSession({ ...sampleToken(), expires_at: Date.now() + 60_000 });
});

const memory = (over: object = {}, items: object[] = []) => ({
  body: {
    preferences: { briefing_time: "08:00", briefing_auto: false, notification_channel: "telegram", email_summaries: true, proactive: true, language: "auto", demo_mode: false, ...over },
    preference_labels: {}, items, counts: { sender: 0, note: 0, dismissed: 0, triage: 0, state: 0 },
  },
});

/* ------------------------------------------------------------------ tasks */

describe("TasksPage", () => {
  const task = { id: "t1", title: "Send the TDR", notes: "", status: "open", due_at: "2020-01-01T17:00:00Z", overdue: true, due_soon: false, source: { type: "email", message_id: "m1", from: "Marta <m@s.edu>" }, created_at: null, completed_at: null };

  it("lists tasks with overdue state and a link back to the email", async () => {
    installFetchStub({ "GET /api/assistant/tasks": { body: { data: [task] } } });
    renderWithProviders(<TasksPage />);
    expect(await screen.findByText("Send the TDR")).toBeInTheDocument();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /From an email · Marta/ })).toHaveAttribute("href", "/inbox?id=m1");
  });

  it("adds a task and completes one", async () => {
    const { calls } = installFetchStub({
      "GET /api/assistant/tasks": { body: { data: [task] } },
      "POST /api/assistant/tasks": { status: 201, body: { ...task, id: "t2", title: "Buy paper" } },
      "PATCH /api/assistant/tasks/t1": { body: { ...task, status: "done" } },
    });
    renderWithProviders(<TasksPage />);
    await screen.findByText("Send the TDR");
    await userEvent.type(screen.getByLabelText("New task"), "Buy paper");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST" && String(c.init.body).includes("Buy paper"))).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: "Complete Send the TDR" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH" && String(c.init.body).includes("done"))).toBe(true));
  });

  it("has a real empty state", async () => {
    installFetchStub({ "GET /api/assistant/tasks": { body: { data: [] } } });
    renderWithProviders(<TasksPage />);
    expect(await screen.findByText("Nothing to do")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- engine */

describe("EnginePage", () => {
  it("shows n8n without opening n8n", async () => {
    installFetchStub({
      "GET /api/n8n-center": {
        body: {
          available: true, state: "operational", error: null,
          totals: { workflows: 2, active: 2, executions_today: 84, failed_today: 1, success_rate_today: 98.8, success_rate_7d: 97.1, last_execution: { at: new Date().toISOString(), status: "success", workflow: "Email", id: "5" } },
          workflows: [{ id: "w1", name: "Email Assistant", active: true, kind: "custom", automation_id: "a1", runs_7d: 142, failed_7d: 2, success_rate_7d: 98.6, avg_duration_ms: 2400, last_run_at: new Date().toISOString(), last_status: "success" }],
        },
      },
    });
    renderWithProviders(<EnginePage />);
    expect(await screen.findByText("Operational")).toBeInTheDocument();
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email Assistant" })).toHaveAttribute("href", "/automations/a1");
    expect(screen.getByText("98.6% success")).toBeInTheDocument();
    expect(screen.getByText("142 runs")).toBeInTheDocument();
  });

  it("reassures when n8n is down", async () => {
    installFetchStub({ "GET /api/n8n-center": { body: { available: false, state: "unavailable", error: "refused", message: "n8n is unavailable. Your saved automations are safe; runs resume when it is back.", totals: null, workflows: [] } } });
    renderWithProviders(<EnginePage />);
    expect(await screen.findByText("n8n unavailable")).toBeInTheDocument();
    expect(screen.getByText(/saved automations are safe/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- shortcuts */

function ShortcutHarness() {
  const location = useLocation();
  useGlobalShortcuts({ onPalette: () => undefined, onHelp: () => undefined });
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <input aria-label="field" />
      <Link to="/">x</Link>
    </div>
  );
}

describe("keyboard shortcuts", () => {
  it("G then I goes to the inbox, G then T to integrations", async () => {
    renderWithProviders(<Routes><Route path="*" element={<ShortcutHarness />} /></Routes>);
    await userEvent.keyboard("gi");
    expect(screen.getByTestId("path")).toHaveTextContent("/inbox");
    await userEvent.keyboard("gt");
    expect(screen.getByTestId("path")).toHaveTextContent("/integrations");
    await userEvent.keyboard("ga");
    expect(screen.getByTestId("path")).toHaveTextContent("/automations");
    await userEvent.keyboard("gh");
    expect(screen.getByTestId("path")).toHaveTextContent("/dashboard");
  });

  it("ignores chords while typing in a field and a lone letter does nothing", async () => {
    renderWithProviders(<Routes><Route path="*" element={<ShortcutHarness />} /></Routes>);
    await userEvent.click(screen.getByLabelText("field"));
    await userEvent.keyboard("gi");
    expect(screen.getByTestId("path")).toHaveTextContent("/");
    expect(screen.getByTestId("path")).not.toHaveTextContent("/inbox");
    await userEvent.click(document.body);
    await userEvent.keyboard("i");
    expect(screen.getByTestId("path")).not.toHaveTextContent("/inbox");
  });

  it("lists every shortcut", () => {
    renderWithProviders(<ShortcutsDialog open onClose={() => undefined} />);
    expect(screen.getByText("Search and commands")).toBeInTheDocument();
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
    expect(screen.getAllByText("Keyboard shortcuts").length).toBeGreaterThanOrEqual(1);
  });
});

describe("command palette 2.0", () => {
  it("finds settings sections and tasks, and always offers to ask the AI", async () => {
    installFetchStub({ "GET /api/assistant/tasks": { body: { data: [{ id: "t1", title: "Send the TDR", status: "open", due_at: null }] } } });
    renderWithProviders(<CommandPalette open onClose={() => undefined} />);
    const box = await screen.findByLabelText("Search commands");
    await userEvent.type(box, "memory");
    expect(await screen.findByText("AI memory")).toBeInTheDocument();
    expect(screen.getByText(/Ask: “memory”/)).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "TDR");
    expect(await screen.findByText("Send the TDR")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------- settings: memory */

describe("AI memory", () => {
  it("shows preferences, lets you add an important sender and delete it", async () => {
    const item = { id: "s1", kind: "sender", key: "marta@school.edu", label: "marta@school.edu", value: "tutor", updated_at: null };
    const { calls } = installFetchStub({
      "GET /api/assistant/memory": memory({}, [item]),
      "POST /api/assistant/memory": { status: 201, body: memory({}, [item]).body },
      "DELETE /api/assistant/memory/s1": { status: 204, body: null },
      "PUT /api/assistant/memory/preferences": { body: { preferences: {} } },
    });
    renderWithProviders(<MemorySection />);
    expect(await screen.findByText("marta@school.edu")).toBeInTheDocument();
    expect(screen.getByLabelText("Preferred briefing time")).toHaveValue("08:00");
    await userEvent.type(screen.getByLabelText("Sender address or domain"), "boss@work.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST" && String(c.init.body).includes("boss@work.com"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Remove marta@school.edu" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE" && c.url.endsWith("/s1"))).toBe(true));
    await userEvent.click(screen.getByRole("switch", { name: "Send the daily briefing automatically" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT" && String(c.init.body).includes("briefing_auto"))).toBe(true));
  });

  it("tells you when a note was refused because it looked like a secret", async () => {
    installFetchStub({
      "GET /api/assistant/memory": memory(),
      "POST /api/assistant/memory": { status: 422, body: { detail: { message: "That looks like a password, token or card number. Memory never stores secrets." } } },
    });
    renderWithProviders(<MemorySection />);
    await userEvent.type(await screen.findByLabelText("New note"), "my password is hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Remember" }));
    expect(await screen.findByText(/never stores secrets/)).toBeInTheDocument();
  });
});

describe("Demo mode", () => {
  it("turns on from Settings and the banner says nothing is sent", async () => {
    const { calls } = installFetchStub({
      "GET /api/assistant/memory": memory(),
      "PUT /api/assistant/memory/preferences": { body: { preferences: { demo_mode: true } } },
    });
    renderWithProviders(<DemoSection />);
    await userEvent.click(await screen.findByRole("switch", { name: "Demo mode" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT" && String(c.init.body).includes("demo_mode"))).toBe(true));
    expect(screen.getByRole("link", { name: "Open the presentation view" })).toHaveAttribute("href", "/presentation");
  });

  it("shows a permanent banner while it is on", async () => {
    installFetchStub({ "GET /api/assistant/memory": memory({ demo_mode: true }) });
    renderWithProviders(<DemoBanner />);
    expect(await screen.findByText(/Sample data · nothing is sent/)).toBeInTheDocument();
  });

  it("shows no banner in normal use", async () => {
    installFetchStub({ "GET /api/assistant/memory": memory() });
    renderWithProviders(<DemoBanner />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

/* ---------------------------------------------------- privacy and security */

describe("Privacy and Security center", () => {
  it("states what is sent to the AI and what never is", async () => {
    installFetchStub({
      "GET /api/assistant/privacy": {
        body: {
          access: [{ service: "Google Workspace", key: "google", account: "a@x.com", permissions: ["Read your email", "Send email as you"], connected_at: null }],
          ai: { provider: "gemini", model: "gemini-2.5", configured: true, fallback: null, data: [{ feature: "Email analysis", sent: "Sender, subject and text", when: "When you press Analyze" }], never: ["Passwords and OAuth tokens"] },
          stored: { tasks: 3, memory: 2, priority_cache: 5, automations: 4, activity_events: 20, local_only: ["Credentials (encrypted)"] },
          demo_mode: false, retention: ["Usage counters: 14 days"],
        },
      },
    });
    renderWithProviders(<PrivacySection />);
    expect(await screen.findByText("Read your email")).toBeInTheDocument();
    expect(screen.getByText("Email analysis")).toBeInTheDocument();
    expect(screen.getByText(/Passwords and OAuth tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Credentials \(encrypted\)/)).toBeInTheDocument();
    expect(screen.getByText("Telemetry / analytics: none.")).toBeInTheDocument();
  });

  it("gives every failing security check its fix", async () => {
    installFetchStub({
      "GET /api/assistant/security": {
        body: {
          status: "warn", checked_at: new Date().toISOString(),
          checks: [
            { key: "google", label: "Google", status: "warn", detail: "Not connected", action: { label: "Connect Google", href: "/integrations/google" } },
            { key: "human_in_the_loop", label: "Sensitive actions", status: "ok", detail: "Always ask for confirmation", action: null },
          ],
        },
      },
    });
    renderWithProviders(<SecurityCenter />);
    expect(await screen.findByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "/integrations/google");
    expect(screen.getByText("Always ask for confirmation")).toBeInTheDocument();
    expect(screen.getByText("Needs a look")).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------- credentials 2.0 */

const google = {
  key: "google", label: "Google Workspace", tagline: "", description: "", auth: "oauth2", docs_url: "", console_url: "", default_services: [],
  services: [
    { key: "gmail", label: "Gmail", description: "", capabilities: [], permissions: [] },
    { key: "calendar", label: "Calendar", description: "", capabilities: [], permissions: [] },
  ],
  status: "healthy", connected: true, setup: { available: true, source: "env", redirect_uri: null },
  connection: {
    id: "c1", health: "healthy", health_detail: "", account: { email: "me@x.com" }, services: ["gmail"], requested_services: ["gmail", "calendar"],
    permissions: [
      { service: "gmail", scope: "r", label: "Read your email", access: "read", granted: true },
      { service: "gmail", scope: "s", label: "Send email as you", access: "write", granted: true },
      { service: "calendar", scope: "c", label: "View and edit calendar events", access: "write", granted: false },
    ],
    connected_at: null, last_sync_at: null, last_refresh_at: null, last_tested_at: null, last_test: null, token_expires_at: null,
    security: { method: "OAuth 2.0 + PKCE", encrypted_at_rest: true, refresh: true, secret_hint: "…abcd" },
  },
  used_by: [{ id: "a1", name: "Email Assistant", status: "active" }],
} as unknown as Integration;

describe("Credentials 2.0", () => {
  it("groups permissions by service and flags the one that was not granted", () => {
    renderWithProviders(<PermissionsCenter i={google} onManage={() => undefined} />);
    const gmail = screen.getByRole("region", { name: "Gmail" });
    expect(within(gmail).getByText("Read your email")).toBeInTheDocument();
    expect(within(gmail).getByText("Send email as you")).toBeInTheDocument();
    const cal = screen.getByRole("region", { name: "Calendar" });
    expect(within(cal).getByText("not allowed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change permissions" })).toBeInTheDocument();
  });

  it("shows authentication, API, permissions and token health", () => {
    renderWithProviders(<CredentialHealth i={google} />);
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText(/Missing: calendar/)).toBeInTheDocument();
    expect(screen.getByText("Refreshing automatically")).toBeInTheDocument();
  });

  it("flags an expired sign-in", () => {
    const expired = { ...google, status: "expired" } as Integration;
    renderWithProviders(<CredentialHealth i={expired} />);
    expect(screen.getByText("Expired - sign in again")).toBeInTheDocument();
  });

  it("shows the four checks while a test runs", () => {
    renderWithProviders(<TestProgress />);
    for (const t of ["Checking authentication…", "Checking API…", "Checking permissions…", "Checking service…"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("says what a disconnect would break before it happens", async () => {
    installFetchStub({
      "GET /api/integrations/google/dependencies": {
        body: { provider: "google", connected: true, automations: [{ id: "a1", name: "Email Assistant", status: "active" }], scheduled: 2, features: ["Inbox and AI email triage", "Reply drafts"] },
      },
    });
    renderWithProviders(<DisconnectDialog i={google} open onClose={() => undefined} onConfirm={async () => undefined} />);
    expect(await screen.findByText("This will affect:")).toBeInTheDocument();
    expect(screen.getByText(/1 automation: Email Assistant/)).toBeInTheDocument();
    expect(screen.getByText(/2 scheduled or automatic tasks/)).toBeInTheDocument();
    expect(screen.getByText(/Inbox and AI email triage/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("renders nothing and does not crash while closed (the page mounts it before the user clicks)", () => {
    installFetchStub({});
    const { container } = renderWithProviders(<DisconnectDialog i={google} open={false} onClose={() => undefined} onConfirm={async () => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not block a disconnect when the dependency check fails", async () => {
    installFetchStub({ "GET /api/integrations/google/dependencies": { status: 500, body: {} } });
    renderWithProviders(<DisconnectDialog i={google} open onClose={() => undefined} onConfirm={async () => undefined} />);
    expect(await screen.findByText(/Could not check what depends on it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ inbox */

const mail = (id: string, subject: string, triage: object | null, extra: object = {}) => ({
  id, thread_id: "t" + id, from: "Marta <marta@school.edu>", to: "", subject, date: new Date().toUTCString(), snippet: "…",
  has_attachments: false, attachments: [], labels: ["UNREAD"], link: "https://mail.google.com/x", unread: true, important_sender: false, triage, ...extra,
});

describe("Inbox 2.0", () => {
  const list = [
    mail("m1", "TDR presentation", { level: "urgent", category: "school", action_required: true, deadline: "2026-10-09T17:00:00Z" }, { important_sender: true }),
    mail("m2", "Weekly newsletter", { level: "low", category: "notification", action_required: false, deadline: null }),
    mail("m3", "Not analyzed yet", null),
  ];

  it("shows AI findings on each row and filters by them", async () => {
    installFetchStub({ "GET /api/assistant/mail": { body: { data: list } } });
    renderWithProviders(<InboxPage />);
    expect(await screen.findByText("TDR presentation")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByText("needs action")).toBeInTheDocument();
    expect(screen.getByText("important sender")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Requires action" }));
    expect(screen.queryByText("Weekly newsletter")).not.toBeInTheDocument();
    expect(screen.getByText("TDR presentation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Requires action" }));
    await userEvent.click(screen.getByRole("button", { name: "AI analyzed" }));
    expect(screen.queryByText("Not analyzed yet")).not.toBeInTheDocument();
  });

  it("explains the priority, detects tasks and deadlines, and never sends without confirmation", async () => {
    const { calls } = installFetchStub({
      "GET /api/assistant/mail/m1": { body: { ...list[0], text: "Send the presentation by Friday." } },
      "GET /api/assistant/mail": { body: { data: list } },
      "POST /api/assistant/mail/m1/analyze": {
        body: {
          priority: "urgent", ai_priority: "high", priority_score: 95, category: "school", action_required: true, summary: "Entrega el viernes.",
          deadline: "2026-10-09T17:00:00Z", deadline_title: "Entregar TDR", suggested_action: "Reply", sender: "marta@school.edu",
          priority_reasons: [{ label: "Known important sender (tutor)", weight: 35, positive: true }, { label: "Deadline detected", weight: 20, positive: true }, { label: "Automated sender", weight: -25, positive: false }],
          tasks: [{ title: "Send document", due: "2026-10-09T17:00:00Z" }],
        },
      },
      "POST /api/assistant/mail/m1/draft": { body: { to: "Marta", subject: "Re: TDR", body: "Lo envío el viernes.", tone: "formal" } },
      "POST /api/assistant/mail/m1/reply": { body: { sent: true } },
      "POST /api/assistant/tasks": { status: 201, body: { id: "t1", title: "Send document" } },
    });
    renderWithProviders(<InboxPage />);
    await userEvent.click(await screen.findByText("TDR presentation"));
    await userEvent.click(await screen.findByRole("button", { name: /Analyze with AI/ }));

    expect(await screen.findByText("Priority: urgent")).toBeInTheDocument();
    expect(screen.getByText("Why urgent priority?")).toBeInTheDocument();
    expect(screen.getByText("Known important sender (tutor)")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "AI analysis" })).getAllByText(/Deadline detected/).length).toBe(2); // the reason, and the deadline row
    expect(screen.getByText("Action required: yes")).toBeInTheDocument();
    expect(screen.getByText("Action detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Calendar" })).toBeInTheDocument();

    // the task the AI found becomes a real task - it reaches the backend with its source email
    await userEvent.click(screen.getAllByRole("button", { name: "Create task" })[1]);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/assistant/tasks") && String(c.init?.body).includes("Send document") && String(c.init?.body).includes('"message_id":"m1"'))).toBe(true));

    // reply: draft -> edit -> confirm -> send
    await userEvent.click(screen.getByRole("button", { name: "Reply professionally" }));
    const box = await screen.findByRole("textbox", { name: "Reply" });
    expect(box).toHaveValue("Lo envío el viernes.");
    expect(calls.some((c) => c.url.endsWith("/reply"))).toBe(false);
    await userEvent.clear(box);
    await userEvent.type(box, "Versión editada por mí");
    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    expect(calls.some((c) => c.url.endsWith("/reply"))).toBe(false); // the dialog is open, nothing sent yet
    expect(await screen.findByText(/Send this reply to Marta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/reply"))).toBe(true));
    const sent = calls.find((c) => c.url.endsWith("/reply"))!;
    expect(String(sent.init?.body)).toContain("Versión editada por mí");
    const draftCall = calls.find((c) => c.url.endsWith("/draft"))!;
    expect(String(draftCall.init?.body)).toContain('"tone":"formal"');
  });
});

/* ------------------------------------------------------------ presentation */

describe("Presentation view", () => {
  it("is labelled as demo data and walks through the product", async () => {
    installFetchStub({
      "GET /api/assistant/demo/showcase": {
        body: {
          demo: true, enabled: false,
          automations: [{ name: "Email Assistant", flow: "Gmail → Gemini → Telegram", status: "active", runs: 142, success_rate: 98.6, last_run_minutes: 2, avg_duration_ms: 2400 }],
          executions: [{ id: "r1", automation: "Important Email Alert", status: "error", started_at: "2026-10-06T09:00:00Z", duration_ms: 30000, steps: [{ label: "Classify with Gemini", node: "n", status: "error", items: 0, duration_ms: 1, error: "Gemini timed out after 30 s", at: "2026-10-06T09:00:01Z" }] }],
          errors: [{ id: "e1", title: "AI provider failed", cause: "Gemini did not answer", automation: "Important Email Alert" }],
          events: [{ title: "Matemáticas", start: "2026-10-06T09:00:00", end: "", location: "" }],
          deadlines: [{ title: "Entregar la presentación del TDR", due: "2026-10-09T17:00:00", source: "Marta" }],
          emails: [{ id: "demo-1", from: "Marta <m@s.cat>", subject: "Presentación del TDR", snippet: "…", date: "" }],
        },
      },
    });
    renderWithProviders(<PresentationPage />);
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(await screen.findByText("Presentación del TDR")).toBeInTheDocument();
    expect(screen.getByText("Priority: urgent")).toBeInTheDocument();
    expect(screen.getByText("Email Assistant")).toBeInTheDocument();
    expect(screen.getByText("Gemini timed out after 30 s")).toBeInTheDocument();
    expect(screen.getByText("You stay in control")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exit presentation" })).toHaveAttribute("href", "/dashboard");
  });
});
