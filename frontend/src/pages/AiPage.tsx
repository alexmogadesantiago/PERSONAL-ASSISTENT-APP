/**
 * Artificial Intelligence.
 *
 * The status strip is `/api/ai/health`; the editor below it is the existing
 * `AiSettingsCard`, unchanged - provider selection, models and credentials
 * already live there and there is no reason for a second way to edit one
 * thing. No key is ever sent to the browser: fields start empty and a stored
 * secret shows only as a four-character hint.
 */
import { useAiConfig, useAiHealth, useAiMutations } from "@/hooks/queries";
import { AiSettingsCard } from "@/pages/settings/AiSettingsCard";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { Button, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage } from "@/components/common";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { relativeTime } from "@/utils/format";

function toneFor(status: string | undefined): StatusTone {
  if (status === "online") return "ok";
  if (status === "degraded") return "warn";
  if (status === "offline" || status === "invalid") return "danger";
  return "idle";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 truncate text-sm text-fg">{value}</p>
    </div>
  );
}

export function AiPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { isAdmin } = useAuth();
  const health = useAiHealth();
  const config = useAiConfig();
  const { test } = useAiMutations();
  const toast = useToast();

  const status = health.data?.status;

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex justify-end">{isAdmin && (
            <Button
              size="sm"
              variant="outline"
              loading={test.isPending}
              onClick={() =>
                test
                  .mutateAsync({})
                  .then((r) =>
                    r.ok
                      ? toast.success("AI connected", `${r.provider} · ${r.model}`)
                      : toast.error("Test failed", r.detail),
                  )
                  .catch((e) => toast.error("Test failed", errorMessage(e)))
              }
            >
              Test connection
            </Button>
          )}</div>
      ) : (
        <PageHeader
          title="AI"
          description="The provider that answers your assistant and every automation."
          actions={
            isAdmin && (
              <Button
                size="sm"
                variant="outline"
                loading={test.isPending}
                onClick={() =>
                  test
                    .mutateAsync({})
                    .then((r) =>
                      r.ok
                        ? toast.success("AI connected", `${r.provider} · ${r.model}`)
                        : toast.error("Test failed", r.detail),
                    )
                    .catch((e) => toast.error("Test failed", errorMessage(e)))
                }
              >
                Test connection
              </Button>
            )
          }
        />
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusBadge tone={toneFor(status)} pulse>
            {status === "online"
              ? "AI connected"
              : status === "not_configured"
                ? "Not configured"
                : status
                  ? `AI ${status}`
                  : "Checking…"}
          </StatusBadge>
          {health.data?.checked_at && (
            <p className="text-xs text-muted">Checked {relativeTime(health.data.checked_at)}</p>
          )}
        </div>

        {health.data?.detail && <p className="mt-3 text-sm text-muted">{health.data.detail}</p>}

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 lg:grid-cols-4">
          {health.isLoading || config.isLoading ? (
            <>
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </>
          ) : (
            <>
              <Field label="Provider" value={config.data?.provider || health.data?.provider || "none"} />
              <Field label="Model" value={config.data?.model || health.data?.model || "none"} />
              <Field
                label="Fallback"
                value={
                  config.data?.fallback_enabled
                    ? config.data.effective_fallback_provider || "none configured"
                    : "disabled"
                }
              />
              <Field
                label="Automation token"
                value={config.data?.service_token?.configured ? "configured" : "not configured"}
              />
            </>
          )}
        </div>

        {health.data?.last_fallback && (
          <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            A recent generation fell back from {health.data.last_fallback.primary} to{" "}
            {health.data.last_fallback.fallback} ({health.data.last_fallback.reason}).
          </p>
        )}
      </section>

      <AiSettingsCard canEdit={isAdmin} />
    </div>
  );
}
