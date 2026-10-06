import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunDetail } from "@/api/platform";
import { renderWithProviders } from "@/test/utils";
import { ExecutionView } from "./ExecutionView";

const base: RunDetail = {
  id: "9", status: "error", started_at: "2026-10-06T09:42:01Z", finished_at: "2026-10-06T09:42:04Z", duration_ms: 2400, mode: "trigger",
  steps: [
    { label: "New email in Gmail", node: "a", status: "success", items: 1, duration_ms: 300, error: null, at: "2026-10-06T09:42:01Z" },
    { label: "Analyze with Gemini", node: "b", status: "error", items: 0, duration_ms: 29000, error: "Gemini timed out", at: "2026-10-06T09:42:02Z" },
    { label: "Send Telegram message", node: "c", status: "skipped", items: 0, duration_ms: null, error: null, at: null },
  ],
  diagnosis: { title: "AI provider failed", explanation: "x", action: { label: "Check AI settings", href: "/settings/ai", kind: "configure" } },
  retry_advice: { retry: true, cause: "The previous attempt failed because the AI provider did not answer in time.", suggestion: "Retry the run - temporary failures usually recover.", action: null },
};

describe("ExecutionView", () => {
  it("shows a timeline, and explains a temporary failure before offering Retry", async () => {
    const onRetry = vi.fn();
    renderWithProviders(<ExecutionView detail={base} onRetry={onRetry} />);
    expect(screen.getByText(/did not answer in time/)).toBeInTheDocument();
    expect(screen.getByText("Suggested action")).toBeInTheDocument();
    expect(screen.getByText("Analyze with Gemini")).toBeInTheDocument();
    expect(screen.getByText("Not reached")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Steps" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sends you to reconnect first when retrying cannot work", () => {
    const detail: RunDetail = {
      ...base,
      diagnosis: { title: "Google Workspace authentication expired", explanation: "x", action: { label: "Reconnect Google Workspace", href: "/integrations/google", kind: "reconnect" } },
      retry_advice: { retry: false, cause: "Google no longer accepts the saved sign-in.", suggestion: "Reconnect Google Workspace first - retrying now would fail the same way.", action: { label: "Reconnect Google Workspace", href: "/integrations/google", kind: "reconnect" } },
    };
    renderWithProviders(<ExecutionView detail={detail} onRetry={() => undefined} />);
    expect(screen.getByRole("link", { name: "Reconnect Google Workspace" })).toHaveAttribute("href", "/integrations/google");
    expect(screen.getByRole("button", { name: "Retry anyway" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("never renders anything but step names, counts and durations", () => {
    renderWithProviders(<ExecutionView detail={{ ...base, status: "success", steps: base.steps.slice(0, 1), diagnosis: null, retry_advice: null }} />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Automation completed")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });
});
