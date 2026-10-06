/**
 * Actions the assistant may propose, and the real endpoints behind them.
 *
 * The model never executes anything: it emits a directive, this module turns it
 * into a typed proposal, and the user presses the button. Every proposal maps
 * onto an endpoint that already exists - there is no client-side pretending,
 * and an unrecognised directive is surfaced as "not available here" rather than
 * silently dropped or invented.
 */
import { aiApi, n8nApi, systemApi } from "@/api";
import { ACTION_PATTERN } from "./prompt";

export type ActionKind =
  | "run_workflow"
  | "activate_workflow"
  | "deactivate_workflow"
  | "check_services"
  | "test_ai"
  | "unsupported";

export interface ActionProposal {
  kind: ActionKind;
  /** Raw directive name, useful when `kind` is "unsupported". */
  raw: string;
  workflowId?: string;
  workflowName?: string;
  /** What the confirmation card asks. */
  title: string;
  subject: string;
  /** True when running it changes system state (as opposed to re-reading it). */
  mutating: boolean;
  /** Endpoints this touches, shown under the buttons so nothing is opaque. */
  endpoint: string;
}

const ATTRIBUTE = /(\w+)\s*=\s*"([^"]*)"/g;

function attributes(blob: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTRIBUTE.lastIndex = 0;
  while ((m = ATTRIBUTE.exec(blob))) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

function proposalFor(name: string, blob: string): ActionProposal {
  const attrs = attributes(blob);
  const id = attrs.id || "";
  const label = attrs.name || (id ? `workflow ${id}` : "");

  switch (name) {
    case "run_workflow":
      return {
        kind: "run_workflow",
        raw: name,
        workflowId: id,
        workflowName: label,
        title: "Run automation",
        subject: label,
        mutating: true,
        endpoint: `POST /api/n8n/workflows/${id || "…"}/run`,
      };
    case "activate_workflow":
      return {
        kind: "activate_workflow",
        raw: name,
        workflowId: id,
        workflowName: label,
        title: "Activate automation",
        subject: label,
        mutating: true,
        endpoint: `POST /api/n8n/workflows/${id || "…"}/activate`,
      };
    case "deactivate_workflow":
      return {
        kind: "deactivate_workflow",
        raw: name,
        workflowId: id,
        workflowName: label,
        title: "Deactivate automation",
        subject: label,
        mutating: true,
        endpoint: `POST /api/n8n/workflows/${id || "…"}/deactivate`,
      };
    case "check_services":
      return {
        kind: "check_services",
        raw: name,
        title: "Re-check every service",
        subject: "All configured integrations",
        mutating: false,
        endpoint: "POST /api/system/check",
      };
    case "test_ai":
      return {
        kind: "test_ai",
        raw: name,
        title: "Test the AI connection",
        subject: "Configured AI provider",
        mutating: false,
        endpoint: "POST /api/ai/test",
      };
    default:
      return {
        kind: "unsupported",
        raw: name,
        title: "Not available in this panel",
        subject: name,
        mutating: false,
        endpoint: "—",
      };
  }
}

export interface ParsedReply {
  /** The reply with directives stripped, ready to render. */
  text: string;
  action: ActionProposal | null;
}

/** Split an assistant reply into prose and (at most) one action proposal. */
export function parseReply(reply: string): ParsedReply {
  const matches = [...reply.matchAll(ACTION_PATTERN)];
  const text = reply.replace(ACTION_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
  if (matches.length === 0) return { text, action: null };
  const [, name, blob] = matches[0];
  return { text, action: proposalFor(name.toLowerCase(), blob ?? "") };
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
}

/**
 * Execute a confirmed proposal. Errors are returned, not thrown, so the chat
 * can render the failure as part of the conversation rather than as a toast the
 * user may miss.
 */
export async function runAction(proposal: ActionProposal): Promise<ActionOutcome> {
  switch (proposal.kind) {
    case "run_workflow": {
      if (!proposal.workflowId) return { ok: false, message: "No workflow id was given." };
      await n8nApi.run(proposal.workflowId);
      return { ok: true, message: `Requested a run of ${proposal.subject}.` };
    }
    case "activate_workflow": {
      if (!proposal.workflowId) return { ok: false, message: "No workflow id was given." };
      await n8nApi.activate(proposal.workflowId);
      return { ok: true, message: `${proposal.subject} is now active.` };
    }
    case "deactivate_workflow": {
      if (!proposal.workflowId) return { ok: false, message: "No workflow id was given." };
      await n8nApi.deactivate(proposal.workflowId);
      return { ok: true, message: `${proposal.subject} is now inactive.` };
    }
    case "check_services": {
      const status = await systemApi.check();
      const bad = status.services.filter(
        (s) => s.status === "offline" || s.status === "invalid" || s.status === "degraded",
      );
      return {
        ok: true,
        message: bad.length
          ? `Re-probed ${status.services.length} services. Needs attention: ${bad
              .map((s) => `${s.name} (${s.status})`)
              .join(", ")}.`
          : `Re-probed ${status.services.length} services. All healthy.`,
      };
    }
    case "test_ai": {
      const result = await aiApi.test({});
      return {
        ok: result.ok,
        message: result.ok
          ? `${result.provider} answered in ${Math.round(result.latency_ms ?? 0)} ms using ${result.model}.`
          : `${result.status}: ${result.detail}`,
      };
    }
    default:
      return {
        ok: false,
        message:
          "This panel has no endpoint for that operation, so nothing was run. " +
          "Only running, activating and deactivating automations, re-checking services and testing " +
          "the AI connection are available here.",
      };
  }
}
