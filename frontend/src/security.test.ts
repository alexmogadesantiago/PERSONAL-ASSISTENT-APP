import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The frontend is a public artifact: everything it ships is readable by anyone
 * who opens the site. These tests fail the build if a provider credential, or
 * anything that would put one in the browser, ever gets in.
 *
 * The rule the whole AI architecture rests on: React talks to OUR backend and
 * to nothing else. NVIDIA NIM, OpenRouter and Gemini are reached by FastAPI,
 * with keys that live in `service_configs` and never leave the server.
 */

// vitest runs with the frontend package as its working directory
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

/** Credential shapes for the three providers, plus a generic bearer literal. */
const KEY_SHAPES: [string, RegExp][] = [
  ["NVIDIA NIM key", /\bnvapi-[A-Za-z0-9_-]{8,}/],
  ["OpenRouter key", /\bsk-or-v1-[A-Za-z0-9]{8,}/],
  ["Google API key", /\bAIzaSy[A-Za-z0-9_-]{10,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}/],
  ["hardcoded bearer", /Bearer\s+[A-Za-z0-9._-]{20,}/],
];

/** Vite only ships `VITE_*`; none of those may name a credential. */
const SECRET_ENV = /VITE_[A-Z0-9_]*(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/;

/** Providers the browser must never call directly. */
const PROVIDER_HOSTS = [
  "integrate.api.nvidia.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
];

function walk(dir: string, keep: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC, (p) => /\.(ts|tsx|css)$/.test(p));
const productionFiles = sourceFiles.filter((p) => !/\.test\.(ts|tsx)$/.test(p));
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

describe("no credential can reach the browser", () => {
  it("no source file contains anything shaped like a provider key", () => {
    const hits: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      for (const [name, pattern] of KEY_SHAPES) {
        if (pattern.test(text)) hits.push(`${rel(file)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no build-time variable is named like a credential", () => {
    const hits = sourceFiles
      .filter((f) => SECRET_ENV.test(readFileSync(f, "utf8")))
      .map(rel);
    // VITE_* values are inlined into the bundle at build time, so a key placed
    // in one is published, not configured.
    expect(hits).toEqual([]);
  });

  it("no shipped code calls a model provider directly", () => {
    const hits: string[] = [];
    for (const file of productionFiles) {
      const text = readFileSync(file, "utf8");
      for (const host of PROVIDER_HOSTS) {
        // A comment naming the host is fine; a URL the code would fetch is not.
        if (text.includes(`https://${host}`) || text.includes(`http://${host}`)) {
          hits.push(`${rel(file)}: ${host}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("browser storage is used only for the session and the theme", () => {
    const allowed = new Set(["src/api/tokenStore.ts", "src/stores/theme.tsx"]);
    const hits = productionFiles
      .filter((f) => /localStorage|sessionStorage/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((p) => !allowed.has(p));
    expect(hits).toEqual([]);
  });
});

describe("the production bundle", () => {
  const bundle = existsSync(DIST) ? walk(DIST, (p) => /\.(js|css|html)$/.test(p)) : [];

  it.skipIf(bundle.length === 0)("ships no provider credential", () => {
    const hits: string[] = [];
    for (const file of bundle) {
      const text = readFileSync(file, "utf8");
      for (const [name, pattern] of KEY_SHAPES) {
        if (pattern.test(text)) hits.push(`${rel(file)}: ${name}`);
      }
      if (SECRET_ENV.test(text)) hits.push(`${rel(file)}: credential-shaped env var`);
    }
    expect(hits).toEqual([]);
  });
});
