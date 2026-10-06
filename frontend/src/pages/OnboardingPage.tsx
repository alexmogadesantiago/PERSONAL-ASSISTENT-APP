/**
 * First run: from zero to a working automation in four steps.
 *
 *   Welcome → Connect your services → Choose what to automate → You're ready
 *
 * Nothing here is a fake step: connecting opens the real sign-in, choosing a
 * template really creates (and, if its connections are ready, activates) the
 * automation. Every step can be skipped and revisited from Settings.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Template } from "@/api/platform";
import { useAiConfig } from "@/hooks/queries";
import { useAutomationMutations, useIntegrations, useTemplates } from "@/hooks/platform";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Button, ButtonLink, HealthBadge, Skeleton, Steps } from "@/components/ui";
import { ICheck, ISparkles, IWand, ProviderMark } from "@/components/icons2";
import { cn } from "@/utils/cn";
import { BrandMark } from "@/layouts/AppLayout";
import { useConnectFlow } from "./IntegrationsPage";

export const ONBOARDED_KEY = "pa.onboarded";

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* private mode: the tour simply shows again next time */
  }
}

export function wasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const integrations = useIntegrations();
  const templates = useTemplates();
  const ai = useAiConfig();
  const m = useAutomationMutations();
  const flow = useConnectFlow();
  const [created, setCreated] = useState<{ id: string; name: string; active: boolean } | null>(null);
  const [idea, setIdea] = useState("");

  useEffect(() => markOnboarded(), []);

  const list = integrations.data?.data ?? [];
  const connected = new Set(list.filter((i) => i.connected && i.status !== "pending").map((i) => i.key));
  const ready = (t: Template) => t.providers.every((p) => connected.has(p));

  async function choose(t: Template) {
    try {
      const a = await m.create.mutateAsync({ spec: t.spec, origin: "template" });
      let active = false;
      if (ready(t)) {
        try {
          await m.act.mutateAsync({ id: a.id, verb: "activate" });
          active = true;
        } catch {
          /* saved; activation can happen later from its page */
        }
      }
      setCreated({ id: a.id, name: a.name, active });
      setStep(3);
    } catch (e) {
      toast.error("Could not create it", errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="mb-8">
        <Steps steps={["Welcome", "Connect", "Automate", "Ready"]} current={step} />
      </div>

      {step === 0 && (
        <div className="animate-in-up text-center">
          <div className="mx-auto mb-6 w-fit">
            <BrandMark size={64} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Welcome{user ? `, ${user.username}` : ""}. <span className="ai-text">Let's build your assistant.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Personal Assistant connects your accounts, understands what you ask in plain words, and runs it for you - with every step visible.
          </p>
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
            {[
              ["Connect", "Sign in to Google, Microsoft, GitHub, Telegram."],
              ["Describe", "“Every Monday, summarise my important email.”"],
              ["Relax", "It runs, reports, and tells you when something needs you."],
            ].map(([t, d], i) => (
              <div key={t} className="card p-4">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">{i + 1}</span>
                <p className="mt-2 text-sm font-semibold text-fg">{t}</p>
                <p className="mt-0.5 text-xs text-muted">{d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-center gap-2">
            <Button size="lg" onClick={() => setStep(1)}>
              Get started
            </Button>
            <Button size="lg" variant="ghost" onClick={() => navigate("/dashboard")}>
              Skip for now
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="animate-in-up">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">Connect your services</h2>
          <p className="mt-1 text-muted">Connect at least one. Telegram is how your assistant talks back to you.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {integrations.isLoading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
              : list.map((i) => (
                  <div key={i.key} className={cn("card flex items-center gap-3 p-4", i.connected && "border-ok/30")}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2">
                      <ProviderMark provider={i.key} size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">{i.label}</p>
                      <p className="truncate text-xs text-muted">{i.tagline}</p>
                    </div>
                    {i.connected && i.status !== "pending" ? (
                      <HealthBadge state={i.status} />
                    ) : (
                      <Button size="sm" onClick={() => flow.open(i)}>
                        {i.status === "pending" ? "Finish" : "Connect"}
                      </Button>
                    )}
                  </div>
                ))}
          </div>
          {!ai.isLoading && !ai.data?.configured && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-warn/30 bg-warn/5 p-4">
              <ISparkles className="text-warn" />
              <p className="flex-1 text-sm text-fg">No AI provider yet - the assistant needs one to read and write for you.</p>
              <ButtonLink to="/settings/ai" size="sm" variant="secondary">
                Choose AI
              </ButtonLink>
            </div>
          )}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)}>{connected.size ? "Continue" : "Continue without connecting"}</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in-up">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">What should it do first?</h2>
          <p className="mt-1 text-muted">Pick one to start with - you can change everything later.</p>
          <form
            className="ai-surface mt-6 flex flex-col gap-2 rounded-2xl border border-brand/20 p-4 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (idea.trim()) navigate(`/automations/new?prompt=${encodeURIComponent(idea.trim())}`);
            }}
          >
            <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Or describe your own…" aria-label="Describe an automation" className="input flex-1 bg-surface/80" />
            <Button type="submit" variant="ai" disabled={!idea.trim()} icon={<IWand width={15} height={15} />}>
              Build it
            </Button>
          </form>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(templates.data ?? []).slice(0, 6).map((t) => {
              const ok = ready(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={m.create.isPending}
                  onClick={() => choose(t)}
                  className="card-interactive flex flex-col items-start p-4 text-left disabled:opacity-60"
                >
                  <div className="flex w-full items-center gap-1">
                    {t.providers.map((p) => (
                      <span key={p} className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2">
                        <ProviderMark provider={p} size={15} />
                      </span>
                    ))}
                    <span className={cn("ml-auto text-[11px]", ok ? "text-ok" : "text-subtle")}>{ok ? "Ready to run" : "Needs a connection"}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-fg">{t.title}</p>
                  <p className="mt-1 text-xs text-muted">{t.description}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="ghost" onClick={() => setStep(3)}>
              Skip
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-in-scale text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-ok">
            <ICheck width={30} height={30} />
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-fg">You're ready.</h2>
          {created ? (
            <p className="mx-auto mt-2 max-w-md text-muted">
              “{created.name}” is {created.active ? "live and running" : "saved - connect what it needs, then switch it on"}.
            </p>
          ) : (
            <p className="mx-auto mt-2 max-w-md text-muted">Your assistant is set up. Create your first automation whenever you like.</p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {created && (
              <ButtonLink to={`/automations/${created.id}`} variant="secondary">
                Open “{created.name}”
              </ButtonLink>
            )}
            <ButtonLink to="/dashboard" variant="primary">
              Go to Home
            </ButtonLink>
          </div>
          <p className="mt-6 text-xs text-subtle">
            Tip: press <kbd className="kbd">Ctrl K</kbd> anywhere. <Link to="/settings/general" className="underline">Replay this tour</Link> from Settings.
          </p>
        </div>
      )}
      {flow.drawers}
    </div>
  );
}
