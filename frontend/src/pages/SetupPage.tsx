import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAiConfig,
  useForceServiceCheck,
  useProfileCompleteness,
  useServiceConfigs,
  useSystemStatus,
  useWorkflows,
} from "@/hooks/queries";
import { useAuth } from "@/stores/auth";
import { Badge, Button, Card, CardTitle, PageHeader } from "@/components/ui";
import { STATUS_META, errorMessage } from "@/components/common";
import { ServiceConfigCard } from "@/pages/settings/ServiceConfigCard";
import { AiSettingsCard } from "@/pages/settings/AiSettingsCard";
import { cn } from "@/utils/cn";

/**
 * First-run wizard: WELCOME -> PROFILE -> AI -> SERVICES -> AUTOMATIONS ->
 * SYSTEM CHECK -> READY.
 *
 * Every step reports live state rather than a checkbox the user ticks: the
 * profile step reads the backend's completeness rule, the services step reads
 * the resolved configuration, and READY is only reached when the system check
 * actually passes. There is no way to click through to a green screen that
 * does not reflect the real system.
 */

type StepId =
  | "welcome"
  | "profile"
  | "ai"
  | "services"
  | "automations"
  | "check"
  | "ready";

const STEPS: { id: StepId; title: string }[] = [
  { id: "welcome", title: "Welcome" },
  { id: "profile", title: "Profile" },
  { id: "ai", title: "AI" },
  { id: "services", title: "Services" },
  { id: "automations", title: "Automations" },
  { id: "check", title: "System check" },
  { id: "ready", title: "Ready" },
];

const AUTOMATION_AREAS = [
  { key: "agenda", label: "Agenda", flow: "Gmail → n8n → AI → Calendar / Tasks" },
  { key: "laboral", label: "Laboral", flow: "Job sources → n8n → AI → scoring" },
  { key: "noticias", label: "Noticias", flow: "RSS / News → n8n → AI → digest" },
  { key: "marca", label: "Marca personal", flow: "Sources → n8n → AI → analysis" },
];

function StepNav({
  current,
  onSelect,
  done,
}: {
  current: StepId;
  onSelect: (id: StepId) => void;
  done: Partial<Record<StepId, boolean>>;
}) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2">
      {STEPS.map((step, i) => {
        const active = step.id === current;
        const complete = done[step.id];
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-brand bg-brand text-brand-fg"
                  : complete
                    ? "border-ok/40 bg-transparent text-ok"
                    : "border-border bg-transparent text-muted hover:bg-surface-2",
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {step.title}
              {complete && !active && " ✓"}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Checklist({ filled, missing }: { filled: string[]; missing: string[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {filled.map((f) => (
        <li key={f} className="text-ok">
          ✓ {f}
        </li>
      ))}
      {missing.map((m) => (
        <li key={m} className="text-warn">
          • {m} — still empty
        </li>
      ))}
    </ul>
  );
}

export function SetupPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<StepId>("welcome");

  const completeness = useProfileCompleteness();
  const configs = useServiceConfigs();
  const aiConfig = useAiConfig();
  const status = useSystemStatus();
  const workflows = useWorkflows();
  const forceCheck = useForceServiceCheck();

  const canEdit = user?.role === "admin";
  const profileReady = !!completeness.data?.configured;
  const services = status.data?.services ?? [];
  const postgres = services.find((s) => s.name === "postgres");
  const infraReady = postgres?.status === "online";
  const faults = services.filter(
    (s) => s.status === "offline" || s.status === "invalid" || s.status === "degraded",
  );
  const unconfigured = services.filter((s) => s.status === "not_configured");
  const checkPassed = infraReady && profileReady && faults.length === 0;

  const done: Partial<Record<StepId, boolean>> = useMemo(
    () => ({
      welcome: true,
      profile: profileReady,
      ai: !!aiConfig.data?.configured,
      services: (configs.data ?? [])
        .filter((c) => (c.category ?? "infra") === "infra")
        .some((c) => c.configured),
      automations: (workflows.data?.data.length ?? 0) > 0,
      check: checkPassed,
      ready: checkPassed,
    }),
    [profileReady, aiConfig.data, configs.data, workflows.data, checkPassed],
  );

  const index = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[index + 1];
  const previous = STEPS[index - 1];

  return (
    <div>
      <PageHeader
        title="Setup"
        description="Get Automation Center from installed to working. Nothing here is ticked by hand — every step reflects the live system."
      />
      <StepNav current={step} onSelect={setStep} done={done} />

      {step === "welcome" && (
        <Card>
          <CardTitle>Welcome{user?.username ? `, ${user.username}` : ""}</CardTitle>
          <p className="text-sm text-muted">
            Four things make this platform useful: a profile that says what you care about, an AI
            provider and the services that do the work (n8n, the scraper), the automations
            themselves, and a health check that proves it all connects.
          </p>
          <p className="mt-2 text-sm text-muted">
            You do not need to edit any configuration file. Everything below is stored by the backend
            and applied on the next health check.
          </p>
        </Card>
      )}

      {step === "profile" && (
        <Card>
          <CardTitle
            action={
              <Badge tone={profileReady ? "success" : "warning"}>
                {profileReady ? "configured" : "incomplete"}
              </Badge>
            }
          >
            Your profile
          </CardTitle>
          {completeness.isError ? (
            <p className="text-sm text-danger">{errorMessage(completeness.error)}</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                The automations filter and score against this. Until the minimum fields carry real
                values, the PROFILE tile on Monitoring stays grey — an existing but empty profile is
                not treated as configured.
              </p>
              <Checklist
                filled={completeness.data?.best?.filled ?? []}
                missing={
                  completeness.data?.best?.missing ?? completeness.data?.required_fields ?? []
                }
              />
              <p className="mt-3 text-sm">
                <Link
                  className="text-brand underline underline-offset-2"
                  // straight into the picker when a profile already exists;
                  // otherwise to the list, where creating one lands there anyway
                  to={
                    completeness.data?.best
                      ? `/profiles/${completeness.data.best.profile_id}/personalise`
                      : "/profiles"
                  }
                >
                  {completeness.data?.profile_count ? "Pick your options" : "Create your profile"}
                </Link>
              </p>
            </>
          )}
        </Card>
      )}

      {step === "ai" && (
        <div>
          <p className="mb-3 text-sm text-muted">
            Pick who answers your automations. NVIDIA NIM is the recommended default; OpenRouter
            is a good fallback, and Gemini stays available for an existing setup. You only need
            one — the others can stay empty.
          </p>
          <AiSettingsCard canEdit={!!canEdit} />
        </div>
      )}

      {step === "services" && (
        <div>
          <p className="mb-3 text-sm text-muted">
            Point the platform at your own instances. A service you leave empty reports{" "}
            <em>not configured</em> — that is a normal state, not a failure.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {(configs.data ?? [])
              .filter((config) => (config.category ?? "infra") === "infra")
              .map((config) => (
                <ServiceConfigCard key={config.service} config={config} canEdit={!!canEdit} />
              ))}
          </div>
        </div>
      )}

      {step === "automations" && (
        <Card>
          <CardTitle>Automation areas</CardTitle>
          <p className="mb-3 text-sm text-muted">
            These run as n8n workflows. They appear here once n8n is connected and the workflows are
            imported; activate or pause each one from the Automations page.
          </p>
          <ul className="space-y-2 text-sm">
            {AUTOMATION_AREAS.map((area) => (
              <li key={area.key} className="border-b border-border pb-2 last:border-0">
                <span className="font-medium text-fg">{area.label}</span>
                <span className="ml-2 text-xs text-muted">{area.flow}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            {workflows.isError ? (
              <span className="text-muted">
                n8n is not reachable yet — connect it in the Services step first.
              </span>
            ) : (
              <>
                <span className="text-muted">
                  {workflows.data?.data.length ?? 0} workflow(s) found in n8n.{" "}
                </span>
                <Link className="text-brand underline underline-offset-2" to="/automations">
                  Manage automations
                </Link>
              </>
            )}
          </p>
        </Card>
      )}

      {step === "check" && (
        <Card>
          <CardTitle
            action={
              <Button size="sm" onClick={() => forceCheck.mutate()} loading={forceCheck.isPending}>
                Run system check
              </Button>
            }
          >
            System check
          </CardTitle>
          {forceCheck.isError && (
            <p className="mb-2 text-sm text-danger">{errorMessage(forceCheck.error)}</p>
          )}
          <div className="space-y-1.5 text-sm">
            {services.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.unknown;
              return (
                <div key={s.name} className="flex items-baseline justify-between gap-3">
                  <span className="capitalize text-fg">{s.name}</span>
                  <span className="flex items-baseline gap-2 text-xs">
                    <span className="text-muted">{s.detail}</span>
                    <span className={cn("font-semibold uppercase", meta.className)}>
                      {meta.label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">
            Full detail, latency and history live on{" "}
            <Link className="text-brand underline underline-offset-2" to="/monitoring">
              Monitoring
            </Link>
            .
          </p>
        </Card>
      )}

      {step === "ready" && (
        <Card>
          <CardTitle
            action={
              <Badge tone={checkPassed ? "success" : "warning"}>
                {checkPassed ? "READY" : "NOT READY"}
              </Badge>
            }
          >
            {checkPassed ? "Automation Center is ready" : "Almost there"}
          </CardTitle>
          {checkPassed ? (
            <p className="text-sm text-muted">
              The database is up, your profile is usable, and nothing configured is failing.
              {unconfigured.length > 0 && (
                <>
                  {" "}
                  Still unconfigured (optional):{" "}
                  <span className="text-fg">{unconfigured.map((s) => s.name).join(", ")}</span>.
                </>
              )}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {!infraReady && <li className="text-danger">• The database is not reachable.</li>}
              {!profileReady && (
                <li className="text-warn">
                  • Your profile is incomplete — {completeness.data?.detail}
                </li>
              )}
              {faults.map((f) => (
                <li key={f.name} className="text-danger">
                  • {f.name}: {f.detail}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={!previous}
          onClick={() => previous && setStep(previous.id)}
        >
          Back
        </Button>
        <Button size="sm" disabled={!next} onClick={() => next && setStep(next.id)}>
          {next ? `Next: ${next.title}` : "Done"}
        </Button>
      </div>
    </div>
  );
}
