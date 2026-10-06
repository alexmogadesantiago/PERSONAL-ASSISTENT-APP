import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardTitle } from "@/components/ui";
import { cn } from "@/utils/cn";
import { N8N_URL } from "@/config";
import {
  n8nStateOf,
  useAiConfig,
  useN8nHealth,
  useProfileCompleteness,
} from "@/hooks/queries";
import {
  AUTOMATION_LABELS,
  CREDENTIAL_REQUIREMENTS,
  GOOGLE_OAUTH,
  oauthRedirectUri,
  type CredentialRequirement,
  type RequirementCheck,
  type RequirementLocation,
} from "@/features/credentials/requirements";

/* ------------------------------- status ------------------------------- */

export type RequirementState = "ready" | "missing" | "invalid" | "manual" | "checking";

export interface RequirementStatus {
  state: RequirementState;
  detail: string;
}

const STATE_META: Record<RequirementState, { label: string; tone: "success" | "danger" | "warning" | "neutral" | "info" }> = {
  ready: { label: "Ready", tone: "success" },
  missing: { label: "Missing", tone: "warning" },
  invalid: { label: "Not working", tone: "danger" },
  manual: { label: "Verify in n8n", tone: "info" },
  checking: { label: "Checking…", tone: "neutral" },
};

const LOCATION_LABEL: Record<RequirementLocation, string> = {
  panel: "This panel",
  launcher: "Launcher → Ajustes",
  n8n: "n8n → Credentials",
};

/**
 * Resolve each requirement against what the backend can actually observe.
 * Anything it cannot observe stays `manual` - it is never reported as ready.
 */
export function useRequirementStatuses(): Record<RequirementCheck, RequirementStatus> {
  const ai = useAiConfig();
  const n8n = useN8nHealth();
  const profile = useProfileCompleteness();

  const aiStatus: RequirementStatus = ai.isLoading
    ? { state: "checking", detail: "" }
    : ai.data?.configured
      ? { state: "ready", detail: `${ai.data.provider || "provider"} · ${ai.data.model || "default model"}` }
      : ai.isError
        ? { state: "invalid", detail: "Could not read the AI configuration." }
        : { state: "missing", detail: ai.data?.missing?.join(", ") || "No provider key stored." };

  const token = ai.data?.service_token;
  const tokenStatus: RequirementStatus = ai.isLoading
    ? { state: "checking", detail: "" }
    : token?.configured
      ? { state: "ready", detail: `issued (${token.source}) ${token.hint ? "· " + token.hint : ""}`.trim() }
      : { state: "missing", detail: "No token issued: every workflow call to the platform gets 401." };

  const n8nState = n8nStateOf(n8n.data, n8n.isError);
  const n8nStatus: RequirementStatus =
    n8nState === "online"
      ? { state: "ready", detail: "API key accepted." }
      : n8nState === "invalid"
        ? { state: "invalid", detail: n8n.data?.detail || "n8n rejected the API key." }
        : n8nState === "offline"
          ? { state: "invalid", detail: n8n.data?.detail || "n8n is not reachable." }
          : n8nState === "not_configured"
            ? { state: "missing", detail: "No n8n API key stored." }
            : { state: "checking", detail: "" };

  const profileStatus: RequirementStatus = profile.isLoading
    ? { state: "checking", detail: "" }
    : profile.data?.configured
      ? {
          state: "ready",
          detail: profile.data.best
            ? `“${profile.data.best.name}” is complete. Its id must also be set in the launcher.`
            : profile.data.detail,
        }
      : { state: "missing", detail: profile.data?.detail || "No complete profile yet." };

  return {
    ai: aiStatus,
    service_token: tokenStatus,
    n8n: n8nStatus,
    profile: profileStatus,
    manual: {
      state: "manual",
      detail: "Stored outside the panel (n8n environment or n8n credentials) - check the last run in Executions.",
    },
  };
}

/* ------------------------------- helpers ------------------------------ */

const linkBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition";

function ActionLink({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  const cls = cn(linkBtn, primary ? "bg-brand text-brand-fg hover:opacity-90" : "border border-border text-fg hover:bg-surface-2");
  if (href.startsWith("/")) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={value}>
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="shrink-0 text-xs font-medium text-brand hover:underline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked (http, iframe): the value is still selectable */
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ---------------------------- requirement card ------------------------ */

function RequirementCard({ req, status }: { req: CredentialRequirement; status: RequirementStatus }) {
  const [open, setOpen] = useState(status.state !== "ready");
  const meta = STATE_META[status.state];

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {req.title}
            {req.optional && <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {req.kind === "oauth2" ? "OAuth 2.0" : req.kind.replace("_", " ")} · set in {LOCATION_LABEL[req.location]}
          </p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      {status.detail && <p className="mt-2 text-xs text-muted">{status.detail}</p>}

      <div className="mt-2 flex flex-wrap gap-1">
        {req.usedBy.length === 0 ? (
          <Badge tone="neutral">Platform</Badge>
        ) : (
          req.usedBy.map((k) => (
            <Badge key={k} tone="brand">
              {AUTOMATION_LABELS[k]}
            </Badge>
          ))
        )}
      </div>

      {(req.envVars?.length || req.n8nCredentialTypes?.length) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {req.envVars?.map((v) => (
            <code key={v} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {v}
            </code>
          ))}
          {req.n8nCredentialTypes?.map((t) => (
            <code key={t} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
              n8n: {t}
            </code>
          ))}
        </div>
      )}

      <button
        type="button"
        className="mt-3 self-start text-xs font-medium text-brand hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide steps" : "How to set it up"}
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted">
          {req.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <div className="h-3" />

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border pt-3">
        {req.configureHref && (
          <ActionLink href={req.configureHref} primary>
            {req.configureLabel ?? "Configure"}
          </ActionLink>
        )}
        {req.location === "n8n" && <ActionLink href={`${N8N_URL}/home/credentials`}>Open n8n credentials</ActionLink>}
        {req.obtainHref && <ActionLink href={req.obtainHref}>{req.obtainLabel ?? "Get it"}</ActionLink>}
      </div>
    </Card>
  );
}

/* ------------------------------- OAuth guide -------------------------- */

export function OAuthGuide() {
  const spec = GOOGLE_OAUTH;
  const redirect = oauthRedirectUri(N8N_URL, spec);

  return (
    <Card as="section">
      <CardTitle
        action={
          <div className="flex flex-wrap gap-1.5">
            <ActionLink href={spec.consoleUrl} primary>
              Google Cloud Console
            </ActionLink>
            <ActionLink href={`${N8N_URL}/home/credentials`}>n8n credentials</ActionLink>
          </div>
        }
      >
        OAuth 2.0 · {spec.provider} (Gmail + Calendar)
      </CardTitle>
      <p className="text-sm text-muted">
        Only the <b>{spec.usedBy.map((k) => AUTOMATION_LABELS[k]).join(", ")}</b> automation needs OAuth. The consent
        happens in n8n, which stores and refreshes the tokens itself (encrypted with <code>N8N_ENCRYPTION_KEY</code>):
        you never copy a token by hand.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-fg">Authorized redirect URI</p>
            <CopyValue value={redirect} label="redirect URI" />
            <p className="mt-1 text-[11px] text-muted">
              Paste it in the OAuth client. n8n shows the same value when you open the credential; if they differ, use
              n8n's.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-fg">Authorization URL</p>
              <CopyValue value={spec.authorizationUrl} label="authorization URL" />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-fg">Token URL</p>
              <CopyValue value={spec.tokenUrl} label="token URL" />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-fg">APIs to enable</p>
            <div className="flex flex-wrap gap-1.5">
              {spec.apisToEnable.map((a) => (
                <ActionLink key={a.name} href={a.href}>
                  {a.name}
                </ActionLink>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-fg">Steps</p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            {spec.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {spec.credentials.map((c) => (
          <div key={c.n8nType} className="min-w-0 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-fg">{c.n8nType}</p>
            <p className="mt-0.5 text-[11px] text-muted">Nodes: {c.nodes.join(" · ")}</p>
            <p className="mt-2 text-[11px] font-medium text-fg">Scopes requested</p>
            <ul className="mt-1 space-y-0.5">
              {c.scopes.map((s) => (
                <li key={s} className="truncate font-mono text-[11px] text-muted" title={s}>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        You can revoke access at any time in{" "}
        <a className="text-brand hover:underline" href={spec.revokeUrl} target="_blank" rel="noopener noreferrer">
          your Google account permissions
        </a>
        .
      </p>
    </Card>
  );
}

/* ------------------------------- section ------------------------------ */

export function RequiredCredentials() {
  const statuses = useRequirementStatuses();
  const rows = CREDENTIAL_REQUIREMENTS.map((req) => ({ req, status: statuses[req.check] }));
  const verifiable = rows.filter((r) => r.req.check !== "manual");
  const ready = verifiable.filter((r) => r.status.state === "ready").length;

  return (
    <section aria-labelledby="required-credentials" className="mb-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="required-credentials" className="text-base font-semibold text-fg">
            Required credentials
          </h2>
          <p className="text-sm text-muted">
            What the automations need to run, where each value goes and how to get it.
          </p>
        </div>
        <Badge tone={ready === verifiable.length ? "success" : "warning"}>
          {ready}/{verifiable.length} verified · {rows.length - verifiable.length} to check in n8n
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ req, status }) => (
          <RequirementCard key={req.id} req={req} status={status} />
        ))}
      </div>

      <OAuthGuide />
    </section>
  );
}
