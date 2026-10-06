/**
 * How a service gets connected.
 *
 *   OAuth (Google, Microsoft, GitHub)
 *     Recommended: pick what to allow -> "Continue with Google" -> consent
 *     screen -> back here, connected. No client id, no secret, no token.
 *     Advanced (admin, once): register the OAuth app; the redirect URI and
 *     scopes are shown ready to paste.
 *
 *   Telegram
 *     Create a bot -> paste its token -> tap the link to Start -> linked.
 *     The chat is detected automatically; there is no chat id to look up.
 */
import { useEffect, useRef, useState } from "react";
import type { Integration, TestOutcome } from "@/api/platform";
import { useIntegrationMutations, useOAuthApp } from "@/hooks/platform";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Button, ButtonLink, CopyField, Drawer, Input, Steps } from "@/components/ui";
import { cn } from "@/utils/cn";
import { ICheck, IExternal, ILock, IShieldCheck, ProviderMark, IX } from "@/components/icons2";
import { ServiceIcon } from "./meta";

/* --------------------------------------------------------- OAuth connect */

export function OAuthConnectDrawer({
  integration,
  open,
  onClose,
  onAdvanced,
}: {
  integration: Integration;
  open: boolean;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  const { isAdmin } = useAuth();
  const m = useIntegrationMutations();
  const toast = useToast();
  const initial = integration.connection?.requested_services?.length
    ? integration.connection.requested_services
    : integration.default_services;
  const [picked, setPicked] = useState<string[]>(initial);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (open) setPicked(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, integration.key]);

  const available = integration.setup.available;
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const providerName = integration.label.split(" ")[0];

  async function go() {
    try {
      setRedirecting(true);
      const r = await m.connect.mutateAsync({
        key: integration.key,
        services: picked,
        returnTo: `/integrations/${integration.key}`,
      });
      window.location.assign(r.authorization_url);
    } catch (e) {
      setRedirecting(false);
      toast.error(`Could not start ${providerName} sign-in`, errorMessage(e));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={integration.connected ? `Manage ${integration.label}` : `Connect ${integration.label}`}
      description={integration.tagline}
      footer={
        available ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={go} loading={redirecting} disabled={picked.length === 0} icon={<ProviderMark provider={integration.key} size={16} />}>
              Continue with {providerName}
            </Button>
          </>
        ) : undefined
      }
    >
      {!available ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
            <p className="text-sm font-semibold text-fg">Sign in with {providerName} is almost ready</p>
            <p className="mt-1 text-sm text-muted">
              {providerName} only lets apps ask for access once their OAuth app is registered. This is a one-time,
              five-minute step for the owner of this installation - after it, everyone just clicks “Continue with{" "}
              {providerName}”.
            </p>
          </div>
          <div className="grid gap-3">
            <div className="rounded-2xl border border-border p-4 opacity-60">
              <p className="text-xs font-semibold text-subtle">Recommended</p>
              <p className="mt-1 text-sm font-medium text-fg">Sign in with {providerName}</p>
              <p className="text-xs text-muted">Available once the OAuth app is set up.</p>
            </div>
            <div className="rounded-2xl border border-brand/40 bg-brand/5 p-4">
              <p className="text-xs font-semibold text-brand">Advanced</p>
              <p className="mt-1 text-sm font-medium text-fg">Configure the OAuth app manually</p>
              <p className="text-xs text-muted">Client ID and secret from the {providerName} developer console.</p>
              {isAdmin ? (
                <Button className="mt-3" size="sm" onClick={onAdvanced}>
                  Set up OAuth app
                </Button>
              ) : (
                <p className="mt-3 text-xs text-warn">Ask the administrator of this installation to do this once.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-fg">Choose what your assistant may use</p>
            <p className="mt-0.5 text-xs text-muted">You can change this later. {providerName} will show these permissions on the next screen.</p>
          </div>
          <div className="space-y-2">
            {integration.services.map((s) => {
              const on = picked.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(s.key)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition",
                    on ? "border-brand/50 bg-brand/[0.06]" : "border-border hover:border-border-strong",
                  )}
                >
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", on ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted")}>
                    <ServiceIcon service={s.key} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-fg">{s.label}</span>
                      <span
                        className={cn(
                          "grid h-5 w-5 place-items-center rounded-md border transition",
                          on ? "border-brand bg-brand text-white" : "border-border-strong",
                        )}
                        aria-hidden="true"
                      >
                        {on && <ICheck width={13} height={13} />}
                      </span>
                    </span>
                    <span className="block text-xs text-muted">{s.description}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {s.permissions.map((p) => (
                        <span key={p.scope} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                          {p.access === "write" ? "✎ " : "◉ "}
                          {p.label}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 rounded-2xl bg-surface-2/70 p-3.5 text-xs text-muted">
            <IShieldCheck className="mt-0.5 shrink-0 text-ok" width={16} height={16} />
            <p>
              Secure sign-in with OAuth 2.0 + PKCE. Your password never touches Personal Assistant; tokens are encrypted
              at rest, refreshed automatically and can be revoked at any time.
            </p>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------ Advanced setup */

export function AdvancedSetupDrawer({ integration, open, onClose }: { integration: Integration; open: boolean; onClose: () => void }) {
  const app = useOAuthApp(integration.key, open);
  const m = useIntegrationMutations();
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (app.data) setClientId(app.data.client_id);
  }, [app.data]);

  const name = integration.label.split(" ")[0];
  const steps: Record<string, string[]> = {
    google: [
      "Open Google Cloud Console → APIs & Services. Create a project (e.g. “Personal Assistant”).",
      "Library: enable Gmail API, Google Calendar API, Google Drive API, Google Sheets API and Google Docs API.",
      "OAuth consent screen: External, add your own address as a test user.",
      "Credentials → Create credentials → OAuth client ID → Web application. Paste the redirect URI below.",
      "Copy the Client ID and Client secret here and save.",
    ],
    microsoft: [
      "Open Microsoft Entra admin center → App registrations → New registration.",
      "Supported accounts: “Any organizational directory and personal Microsoft accounts”.",
      "Redirect URI: platform Web, paste the URI below.",
      "Certificates & secrets → New client secret. Copy its value (shown once).",
      "Copy the Application (client) ID and the secret here and save.",
    ],
    github: [
      "GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.",
      "Homepage URL: this panel's address. Authorization callback URL: the URI below.",
      "Register, then Generate a new client secret.",
      "Copy the Client ID and secret here and save.",
    ],
  };

  async function save() {
    try {
      await m.saveApp.mutateAsync({ key: integration.key, clientId: clientId.trim(), clientSecret: secret.trim() || undefined });
      setSecret("");
      toast.success(`${name} sign-in is ready`, "Users can now connect with one click.");
      onClose();
    } catch (e) {
      toast.error("Could not save", errorMessage(e));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={`Advanced · ${integration.label} OAuth app`}
      description="One-time setup by the owner of this installation."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={m.saveApp.isPending} disabled={!clientId.trim() || (!app.data?.client_secret_configured && !secret.trim())}>
            Save and enable sign-in
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ol className="space-y-2.5">
          {(steps[integration.key] ?? []).map((s, i) => (
            <li key={s} className="flex gap-3 text-sm text-muted">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg ring-1 ring-inset ring-border">
                {i + 1}
              </span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        <ButtonLink to={integration.console_url} variant="outline" size="sm" icon={<IExternal width={14} height={14} />}>
          Open the {name} developer console
        </ButtonLink>
        <div>
          <p className="label">Redirect URI</p>
          <CopyField value={app.data?.redirect_uri ?? integration.setup.redirect_uri ?? ""} label="redirect URI" />
          <p className="mt-1 text-xs text-subtle">Must match exactly, including http/https and the port.</p>
        </div>
        <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        <Input
          label={app.data?.client_secret_configured ? `Client secret (saved ${app.data.client_secret_hint}) - leave blank to keep` : "Client secret"}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
        <div className="flex gap-3 rounded-2xl bg-surface-2/70 p-3.5 text-xs text-muted">
          <ILock className="mt-0.5 shrink-0" width={16} height={16} />
          <p>The secret is encrypted with the installation key and never shown again - only its last four characters.</p>
        </div>
        {app.data && (
          <details className="rounded-2xl border border-border p-3 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-fg">Scopes this app may request</summary>
            <ul className="mt-2 space-y-0.5 font-mono">
              {app.data.scopes.map((s) => (
                <li key={s} className="truncate">
                  {s}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------ Telegram */

export function TelegramSetupDrawer({ integration, open, onClose }: { integration: Integration; open: boolean; onClose: () => void }) {
  const m = useIntegrationMutations();
  const toast = useToast();
  const conn = integration.connection;
  const linked = !!conn?.telegram?.chat;
  const [step, setStep] = useState(conn ? (linked ? 3 : 2) : 0);
  const [token, setToken] = useState("");
  const [link, setLink] = useState<string | null>(conn?.telegram?.link_url ?? null);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    if (open) {
      setStep(conn ? (linked ? 3 : 2) : 0);
      setLink(conn?.telegram?.link_url ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const r = await m.telegramLink.mutateAsync();
        if (r.linked) {
          setWaiting(false);
          setStep(3);
          toast.success("Telegram linked", `Messages will arrive in ${r.chat?.title ?? "your chat"}.`);
          return;
        }
      } catch (e) {
        setWaiting(false);
        toast.error("Could not check Telegram", errorMessage(e));
        return;
      }
      if (tries < 40) timer.current = window.setTimeout(tick, 3000);
      else setWaiting(false);
    };
    timer.current = window.setTimeout(tick, 2000);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  async function saveToken() {
    try {
      const r = await m.telegramToken.mutateAsync(token.trim());
      setToken("");
      setLink(r.link_url);
      setStep(r.connection?.telegram?.chat ? 3 : 2);
    } catch (e) {
      toast.error("That token did not work", errorMessage(e));
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Connect Telegram" description="Your assistant's voice: summaries, alerts, confirmations.">
      <div className="space-y-6">
        <Steps steps={["Create a bot", "Paste its token", "Link your chat", "Done"]} current={step} />

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Telegram bots are free. Open <b className="text-fg">@BotFather</b>, send <code className="rounded bg-surface-2 px-1">/newbot</code>,
              pick a name, and BotFather replies with a token like <code className="rounded bg-surface-2 px-1">123456:AA…</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to="https://t.me/BotFather" variant="outline" icon={<ProviderMark provider="telegram" size={16} />}>
                Open @BotFather
              </ButtonLink>
              <Button onClick={() => setStep(1)}>I have a token</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <Input
              label="Bot token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AA…"
              autoComplete="off"
              hint="Checked with Telegram right away, then encrypted. Only the last 4 characters are ever shown."
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={saveToken} loading={m.telegramToken.isPending} disabled={token.trim().length < 20}>
                Verify token
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Bot <b className="text-fg">@{conn?.telegram?.bot.username ?? "your bot"}</b> is ready. Open it and press{" "}
              <b className="text-fg">Start</b> - we'll detect your chat automatically.
            </p>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setWaiting(true)}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#2AABEE] px-4 py-3 text-sm font-semibold text-white shadow-elev-2 transition hover:brightness-110"
              >
                <ProviderMark provider="telegram" size={18} /> Open in Telegram and press Start
              </a>
            )}
            <div className={cn("flex items-center gap-3 rounded-2xl border border-border p-3.5", waiting && "border-info/40 bg-info/5")}>
              {waiting ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inset-0 animate-ping rounded-full bg-info/60" />
                    <span className="relative h-3 w-3 rounded-full bg-info" />
                  </span>
                  <p className="text-sm text-fg">Waiting for you to press Start…</p>
                </>
              ) : (
                <>
                  <p className="flex-1 text-sm text-muted">Already pressed Start?</p>
                  <Button size="sm" variant="secondary" onClick={() => setWaiting(true)}>
                    Check now
                  </Button>
                </>
              )}
            </div>
            <button
              type="button"
              className="text-xs text-subtle underline-offset-2 hover:underline"
              onClick={async () => {
                const r = await m.telegramLinkReset.mutateAsync();
                setLink(r.link_url);
              }}
            >
              Get a new link
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok">
              <ICheck width={28} height={28} />
            </div>
            <div>
              <p className="text-base font-semibold text-fg">Telegram is connected</p>
              <p className="mt-1 text-sm text-muted">
                @{integration.connection?.telegram?.bot.username ?? conn?.telegram?.bot.username} →{" "}
                {integration.connection?.telegram?.chat?.title ?? "your chat"}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button
                variant="secondary"
                loading={m.telegramTestMessage.isPending}
                onClick={async () => {
                  try {
                    await m.telegramTestMessage.mutateAsync();
                    toast.success("Test message sent", "Check Telegram.");
                  } catch (e) {
                    toast.error("Could not send", errorMessage(e));
                  }
                }}
              >
                Send a test message
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* --------------------------------------------------------- Test result */

export function TestResult({ outcome, onAction }: { outcome: TestOutcome; onAction?: (a: TestOutcome["action"]) => void }) {
  return (
    <div
      role="status"
      className={cn("animate-in-up rounded-2xl border p-4", outcome.ok ? "border-ok/30 bg-ok/[0.06]" : "border-danger/30 bg-danger/[0.06]")}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid h-6 w-6 place-items-center rounded-full", outcome.ok ? "bg-ok/20 text-ok" : "bg-danger/20 text-danger")}>
          {outcome.ok ? <ICheck width={14} height={14} /> : <IX width={14} height={14} />}
        </span>
        <p className="text-sm font-semibold text-fg">{outcome.ok ? "Connection successful" : "Connection needs attention"}</p>
        {outcome.latency_ms != null && <span className="ml-auto text-xs text-subtle">{Math.round(outcome.latency_ms)} ms</span>}
      </div>
      <ul className="mt-3 space-y-1.5">
        {outcome.checks.map((c, i) => (
          <li key={c.key} className="stagger flex items-center gap-2 text-sm" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={c.ok ? "text-ok" : "text-danger"}>{c.ok ? "✓" : "✕"}</span>
            <span className="text-fg">{c.label}</span>
            <span className="truncate text-xs text-muted">{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{outcome.summary}</p>
      {!outcome.ok && outcome.action && onAction && (
        <Button size="sm" className="mt-3" onClick={() => onAction(outcome.action)}>
          {{ reconnect: "Reconnect", manage_permissions: "Manage permissions", retry: "Try again", link_chat: "Link chat" }[outcome.action]}
        </Button>
      )}
    </div>
  );
}
