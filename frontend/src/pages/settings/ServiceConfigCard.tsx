import { useEffect, useState } from "react";
import { useServiceConfigMutations } from "@/hooks/queries";
import { Badge, Button, Card, CardTitle, Input } from "@/components/ui";
import { errorMessage } from "@/components/common";
import { relativeTime } from "@/utils/format";
import type { ServiceConfig } from "@/api/types";

/**
 * One infrastructure integration's settings. Saving writes to the backend's
 * `service_configs` table, which takes precedence over the environment, so a
 * user can point the platform at a real n8n or Playwright without touching
 * `.env` or waiting for a redeploy (Phase 6).
 *
 * AI providers deliberately do NOT use this card: choosing a provider, a model
 * and a fallback is a different shape of decision from "here is a URL and a
 * key". They live in `AiSettingsCard`.
 *
 * The stored secret is never sent to the browser: the field starts empty and an
 * empty field means "keep what is stored", which is why saving a URL alone does
 * not wipe the key.
 */

const HELP: Record<string, { url?: string; secret?: string }> = {
  n8n: {
    url: "Public HTTPS URL of your n8n, e.g. https://n8n.midominio.com. A local Docker n8n is not reachable from a cloud backend.",
    secret: "n8n → Settings → n8n API → Create an API key.",
  },
  playwright: {
    url: "Public HTTPS URL of the scraper sidecar, e.g. https://playwright.midominio.com.",
  },
};

function statusTone(config: ServiceConfig): "success" | "warning" | "neutral" {
  if (!config.enabled) return "neutral";
  return config.configured ? "success" : "warning";
}

export function ServiceConfigCard({
  config,
  canEdit,
}: {
  config: ServiceConfig;
  canEdit: boolean;
}) {
  const { save, test } = useServiceConfigMutations();
  const [baseUrl, setBaseUrl] = useState(config.base_url);
  const [secret, setSecret] = useState("");
  const [saved, setSaved] = useState(false);

  // Keep the form in step with a refetch (another admin, or a forced check).
  useEffect(() => {
    setBaseUrl(config.base_url);
  }, [config.base_url]);

  const help = HELP[config.service] ?? {};
  const busy = save.isPending || test.isPending;

  const onSave = () => {
    setSaved(false);
    save.mutate(
      {
        service: config.service,
        input: {
          ...(config.requires_url ? { base_url: baseUrl.trim() } : {}),
          // an untouched field means "leave the stored secret alone"
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setSecret("");
          setSaved(true);
        },
      },
    );
  };

  const onToggleEnabled = () => {
    save.mutate({ service: config.service, input: { enabled: !config.enabled } });
  };

  const onClearSecret = () => {
    save.mutate({ service: config.service, input: { clear_secret: true } });
  };

  return (
    <Card>
      <CardTitle
        action={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(config)}>
              {!config.enabled ? "disabled" : config.configured ? "configured" : "incomplete"}
            </Badge>
            <span className="text-xs text-muted">from {config.source}</span>
          </div>
        }
      >
        {config.label}
      </CardTitle>

      <div className="space-y-3">
        {config.requires_url && (
          <Input
            label="Base URL"
            placeholder="https://…"
            value={baseUrl}
            spellCheck={false}
            autoComplete="off"
            disabled={!canEdit || busy}
            onChange={(e) => setBaseUrl(e.target.value)}
            hint={help.url}
          />
        )}

        {config.requires_secret && (
          <Input
            label="API key"
            type="password"
            autoComplete="new-password"
            placeholder={
              config.secret_configured ? `stored (${config.secret_hint}) — leave blank to keep` : "paste the key"
            }
            value={secret}
            disabled={!canEdit || busy}
            onChange={(e) => setSecret(e.target.value)}
            hint={help.secret}
          />
        )}

        {!config.configured && config.missing.length > 0 && (
          <p className="text-xs text-warn">Still missing: {config.missing.join(", ")}</p>
        )}

        {config.last_tested_at && (
          <p className="text-xs text-muted">
            Last test {relativeTime(config.last_tested_at)}:{" "}
            <span className={config.last_test_ok ? "text-ok" : "text-danger"}>
              {config.last_test_detail || (config.last_test_ok ? "ok" : "failed")}
            </span>
          </p>
        )}

        {test.isSuccess && test.data?.service === config.service && (
          <p className={"text-xs " + (test.data.ok ? "text-ok" : "text-danger")}>
            {test.data.status.toUpperCase()} — {test.data.detail}
            {test.data.latency_ms != null && ` (${test.data.latency_ms} ms)`}
          </p>
        )}
        {save.isError && <p className="text-xs text-danger">{errorMessage(save.error)}</p>}
        {test.isError && <p className="text-xs text-danger">{errorMessage(test.error)}</p>}
        {saved && !save.isPending && !save.isError && (
          <p className="text-xs text-ok">Saved. The monitor picks it up on the next check.</p>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" onClick={onSave} loading={save.isPending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => test.mutate(config.service)}
              loading={test.isPending}
              disabled={!config.configured}
              title={config.configured ? undefined : "Fill in the settings above first"}
            >
              Test connection
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggleEnabled} disabled={busy}>
              {config.enabled ? "Disable" : "Enable"}
            </Button>
            {config.secret_configured && (
              <Button size="sm" variant="ghost" onClick={onClearSecret} disabled={busy}>
                Remove key
              </Button>
            )}
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-muted">
            Only an administrator can change these settings.
          </p>
        )}
      </div>
    </Card>
  );
}
