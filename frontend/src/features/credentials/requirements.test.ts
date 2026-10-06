/**
 * The requirements catalogue is only useful while it matches the workflows it
 * describes. These tests read the committed workflow JSON and fail when a
 * workflow starts depending on something the Credentials page does not list.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_REQUIREMENTS, GOOGLE_OAUTH, oauthRedirectUri } from "./requirements";

const WORKFLOW_DIR = resolve(__dirname, "../../../../workflows");
const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, text: readFileSync(join(WORKFLOW_DIR, f), "utf-8") }));

/** Wired by docker-compose itself; the user never sets these. */
const INFRASTRUCTURE = new Set(["AC_API_URL", "PLAYWRIGHT_BASE_URL"]);

const listedEnv = new Set(CREDENTIAL_REQUIREMENTS.flatMap((r) => r.envVars ?? []));

describe("credential requirements catalogue", () => {
  it("finds the workflows", () => {
    expect(workflows.length).toBeGreaterThanOrEqual(5);
  });

  it.each(workflows)("lists every variable $file reads", ({ text }) => {
    const used = new Set([...text.matchAll(/\$env\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !INFRASTRUCTURE.has(v) && !listedEnv.has(v));
    expect(missing).toEqual([]);
  });

  it.each(workflows)("covers every n8n credential $file needs with the OAuth guide", ({ text }) => {
    const wf = JSON.parse(text) as { nodes: Array<{ name: string; credentials?: Record<string, unknown> }> };
    const nodesWithCreds = wf.nodes.filter((n) => n.credentials && Object.keys(n.credentials).length);
    const documented = new Set(GOOGLE_OAUTH.credentials.flatMap((c) => c.nodes));
    for (const n of nodesWithCreds) expect(documented).toContain(n.name);
  });

  it("has unique ids and at least one way to act on each item", () => {
    const ids = CREDENTIAL_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of CREDENTIAL_REQUIREMENTS) {
      expect(r.steps.length).toBeGreaterThan(0);
      expect(r.configureHref || r.obtainHref).toBeTruthy();
    }
  });

  it("builds the redirect URI n8n serves the OAuth callback on", () => {
    expect(oauthRedirectUri("http://localhost:5678/")).toBe("http://localhost:5678/rest/oauth2-credential/callback");
  });
});
