/**
 * One connection, in full: who it signs in as, what it may do, how it is
 * protected, what depends on it, and whether it works right now.
 *
 * Also the landing page after an OAuth round-trip: `?connected=1` celebrates,
 * `?error=<code>` explains in plain words and offers to try again.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { TestOutcome } from "@/api/platform";
import { useIntegration, useIntegrationMutations } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { useAuth } from "@/stores/auth";
import { errorMessage, QueryBoundary } from "@/components/common";
import { Avatar, Badge, Button, ButtonLink, Card, CardTitle, EmptyState, HealthBadge, PageHeader } from "@/components/ui";
import { IBolt, ICheck, IExternal, IKey, ILock, IPlus, IRefresh, IShieldCheck, ProviderMark } from "@/components/icons2";
import { formatDateTime, relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { OAUTH_ERROR_TEXT, ServiceIcon, isUnhealthy } from "@/features/integrations/meta";
import { TestResult } from "@/features/integrations/ConnectFlows";
import { ConnectionOverview, CredentialHealth, DisconnectDialog, PermissionsCenter, TestProgress } from "@/features/integrations/ConnectionPanels";
import { useConnectFlow } from "./IntegrationsPage";

export function IntegrationDetailPage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useIntegration(key);
  const m = useIntegrationMutations();
  const toast = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const flow = useConnectFlow();
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const oauthError = params.get("error");

  useEffect(() => {
    if (params.get("connected") === "1") {
      setJustConnected(true);
      toast.success("Connected", "Your assistant can now use it.");
      params.delete("connected");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTest() {
    if (!q.data) return;
    try {
      setOutcome(await m.test.mutateAsync(q.data.key));
      q.refetch();
    } catch (e) {
      toast.error("Test failed", errorMessage(e));
    }
  }

  const i = q.data;
  const conn = i?.connection;

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()}>
      {i && (
        <div>
          <PageHeader
            back={{ to: "/integrations", label: "Integrations" }}
            title={
              <span className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-2 ring-1 ring-inset ring-border">
                  <ProviderMark provider={i.key} size={24} />
                </span>
                {i.label}
              </span>
            }
            description={i.description}
            actions={
              i.connected ? (
                <>
                  <Button variant="secondary" onClick={runTest} loading={m.test.isPending} icon={<ICheck width={15} height={15} />}>
                    Test connection
                  </Button>
                  <Button variant={isUnhealthy(i.status) ? "primary" : "outline"} onClick={() => flow.open(i)} icon={<IRefresh width={15} height={15} />}>
                    {i.key === "telegram" ? "Re-link" : "Reconnect"}
                  </Button>
                </>
              ) : (
                <Button onClick={() => flow.open(i)} icon={<ProviderMark provider={i.key} size={16} />}>
                  Connect {i.label}
                </Button>
              )
            }
          />

          {oauthError && (
            <div role="alert" className="animate-in-up mb-5 flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">Connection failed</p>
                <p className="text-sm text-muted">{OAUTH_ERROR_TEXT[oauthError] ?? params.get("message") ?? oauthError}</p>
              </div>
              <Button
                onClick={() => {
                  params.delete("error");
                  params.delete("message");
                  setParams(params, { replace: true });
                  flow.open(i);
                }}
              >
                Try again
              </Button>
            </div>
          )}

          {justConnected && (
            <div className="animate-in-scale mb-5 flex items-center gap-3 rounded-2xl border border-ok/30 bg-ok/[0.06] p-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ok/20 text-ok">
                <ICheck />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">{i.label} is connected</p>
                <p className="text-sm text-muted">Next: use it in an automation, or run a test to see every check.</p>
              </div>
              <Button size="sm" onClick={() => navigate("/automations/new")} icon={<IPlus width={14} height={14} />}>
                New automation
              </Button>
            </div>
          )}

          {!i.connected ? (
            <EmptyState
              icon={<ProviderMark provider={i.key} size={24} />}
              title={`${i.label} is not connected`}
              description={i.tagline}
              action={<Button onClick={() => flow.open(i)}>Connect {i.label}</Button>}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <ConnectionOverview i={i} />
                {m.test.isPending ? <TestProgress /> : outcome && <TestResult outcome={outcome} onAction={() => flow.open(i)} />}
                <CredentialHealth i={i} />

                <Card>
                  <CardTitle description="What this connection lets your assistant do.">Services</CardTitle>
                  <div className="divide-y divide-border">
                    {i.services.map((s) => {
                      const on = conn!.services.includes(s.key);
                      return (
                        <div key={s.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", on ? "bg-ok/10 text-ok" : "bg-surface-2 text-subtle")}>
                            <ServiceIcon service={s.key} size={17} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-fg">{s.label}</p>
                              {on ? <Badge tone="success" dot>Allowed</Badge> : <Badge>Not allowed</Badge>}
                            </div>
                            <p className="text-xs text-muted">{s.description}</p>
                          </div>
                          {!on && i.key !== "telegram" && (
                            <Button size="xs" variant="subtle" onClick={() => flow.open(i)}>
                              Allow
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {i.key === "telegram" && conn!.telegram?.chat && (
                  <Card className="ai-surface border-brand/20">
                    <CardTitle description="Your linked chat can talk to the assistant. Other chats are ignored.">Chat with your assistant</CardTitle>
                    <ul className="grid gap-2 text-sm sm:grid-cols-2">
                      {[
                        ["/emails", "Unread email"],
                        ["/reply N", "Draft a reply (you confirm)"],
                        ["/briefing", "Your day, summarised"],
                        ["/tasks", "Tasks and deadlines"],
                        ["/automations", "Your automations"],
                        ["/errors", "What is failing"],
                        ["/status", "Overall status"],
                      ].map(([c, d]) => (
                        <li key={c} className="flex items-center gap-2">
                          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-brand">{c}</code>
                          <span className="text-muted">{d}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted">Or just ask: “¿Qué correos tengo pendientes?”</p>
                  </Card>
                )}

                <PermissionsCenter i={i} onManage={() => flow.open(i)} />

                <Card>
                  <CardTitle
                    description="Automations that depend on this connection."
                    action={
                      <Button size="xs" variant="ghost" onClick={() => navigate("/automations/new")} icon={<IPlus width={13} height={13} />}>
                        New
                      </Button>
                    }
                  >
                    Used by
                  </CardTitle>
                  {i.used_by.length === 0 ? (
                    <p className="text-sm text-muted">No automation uses it yet. Templates like “File invoices automatically” are a good start.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {i.used_by.map((a) => (
                        <li key={a.id}>
                          <Link to={`/automations/${a.id}`} className="flex items-center gap-3 py-2.5 text-sm transition hover:text-brand">
                            <IBolt width={15} height={15} className="text-subtle" />
                            <span className="flex-1 text-fg">{a.name}</span>
                            <Badge tone={a.status === "active" ? "success" : "neutral"} dot>
                              {a.status === "active" ? "Active" : "Paused"}
                            </Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardTitle>Account</CardTitle>
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={conn!.account.name || conn!.account.email || conn!.account.login || i.label}
                      src={conn!.account.avatar || undefined}
                      size={40}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{conn!.account.name || conn!.account.login || "—"}</p>
                      <p className="truncate text-xs text-muted">{conn!.account.email || (conn!.telegram ? `@${conn!.telegram.bot.username}` : "")}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <HealthBadge state={i.status} />
                    <span className="text-xs text-subtle">Connected {relativeTime(conn!.connected_at)}</span>
                  </div>
                  {conn!.health_detail && isUnhealthy(i.status) && <p className="mt-2 text-xs text-danger">{conn!.health_detail}</p>}
                  {conn!.telegram && (
                    <div className="mt-4 rounded-xl bg-surface-2/60 p-3 text-xs">
                      <p className="text-muted">Messages go to</p>
                      <p className="mt-0.5 text-sm font-medium text-fg">{conn!.telegram.chat?.title ?? "No chat linked yet"}</p>
                    </div>
                  )}
                </Card>

                <Card>
                  <CardTitle icon={<IShieldCheck width={16} height={16} />}>Security</CardTitle>
                  <dl className="space-y-2.5 text-sm">
                    {[
                      ["Method", conn!.security.method],
                      ["Stored", conn!.security.encrypted_at_rest ? "Encrypted at rest" : "—"],
                      ["Secret", `•••• ${conn!.security.secret_hint.replace("…", "")}`],
                      ...(i.auth === "oauth2"
                        ? [
                            ["Auto-refresh", conn!.security.refresh ? "On" : "Not available"],
                            ["Last refresh", conn!.last_refresh_at ? relativeTime(conn!.last_refresh_at) : "—"],
                            ["Token expires", conn!.token_expires_at ? formatDateTime(conn!.token_expires_at) : "—"],
                          ]
                        : []),
                      ["Last test", conn!.last_tested_at ? relativeTime(conn!.last_tested_at) : "Never"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2/60 p-3 text-xs text-muted">
                    <ILock className="mt-0.5 shrink-0" width={14} height={14} />
                    Tokens never leave the backend. Disconnecting also revokes access at {i.label.split(" ")[0]}.
                  </div>
                </Card>

                <Card>
                  <CardTitle>Manage</CardTitle>
                  <div className="flex flex-col gap-2">
                    {i.key === "telegram" ? (
                      <Button
                        variant="secondary"
                        loading={m.telegramTestMessage.isPending}
                        onClick={async () => {
                          try {
                            await m.telegramTestMessage.mutateAsync();
                            toast.success("Test message sent");
                          } catch (e) {
                            toast.error("Could not send", errorMessage(e));
                          }
                        }}
                      >
                        Send a test message
                      </Button>
                    ) : (
                      isAdmin && (
                        <Button variant="ghost" icon={<IKey width={15} height={15} />} onClick={() => flow.openAdvanced(i)}>
                          Advanced: OAuth app
                        </Button>
                      )
                    )}
                    <ButtonLink to={i.docs_url} variant="ghost" icon={<IExternal width={15} height={15} />}>
                      Provider documentation
                    </ButtonLink>
                    <Button variant="ghost" className="justify-start text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setConfirm(true)}>
                      Disconnect
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )}

          <DisconnectDialog
            i={i}
            open={confirm}
            onClose={() => setConfirm(false)}
            onConfirm={async () => {
              try {
                await m.disconnect.mutateAsync(i.key);
                toast.success(`${i.label} disconnected`);
                navigate("/integrations");
              } catch (e) {
                toast.error("Could not disconnect", errorMessage(e));
                throw e;
              }
            }}
          />
          {flow.drawers}
        </div>
      )}
    </QueryBoundary>
  );
}
