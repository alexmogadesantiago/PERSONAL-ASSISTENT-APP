import { useEffect, useState } from "react";
import { useAiConfig, useAiModels, useAiMutations, useAiProviders } from "@/hooks/queries";
import { Badge, Button, Card, CardTitle, Input, Select } from "@/components/ui";
import { QueryBoundary, errorMessage } from "@/components/common";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { AiProviderId, AiProviderInfo } from "@/api/types";

/**
 * The Artificial Intelligence panel.
 *
 * One decision per row, in the order a person actually makes them: which
 * provider, which model, the key, and what happens when the provider is down.
 * Everything is stored by the backend (`service_configs`), so nothing here ever
 * requires editing `.env` or waiting for a redeploy.
 *
 * The stored key is never sent to the browser: the field starts empty, an empty
 * field means "keep what is stored", and only the last four characters are ever
 * displayed.
 */

function ProviderTile({
  provider,
  selected,
  disabled,
  onSelect,
}: {
  provider: AiProviderInfo;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-brand bg-brand/5 ring-1 ring-brand"
          : "border-border bg-transparent hover:bg-surface-2",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg">{provider.label}</span>
        {provider.recommended && <Badge tone="brand">Recommended</Badge>}
      </span>
      <span className="text-xs text-muted">{provider.tagline}</span>
      <span className="mt-1 text-xs">
        {provider.secret_configured ? (
          <span className="text-ok">Key stored ({provider.secret_hint})</span>
        ) : (
          <span className="text-warn">No key yet</span>
        )}
      </span>
    </button>
  );
}

export function AiSettingsCard({ canEdit }: { canEdit: boolean }) {
  const config = useAiConfig();
  const providers = useAiProviders();
  const { save, test, rotateToken } = useAiMutations();

  const [provider, setProvider] = useState<AiProviderId | "">("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [fallbackProvider, setFallbackProvider] = useState<AiProviderId | "">("");
  const [saved, setSaved] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  // Follow the backend, including a change made by another admin. Selecting a
  // provider in the UI is a local edit until Save, so the effect only re-seeds
  // when the server's own answer changes.
  useEffect(() => {
    if (!config.data) return;
    const preferred =
      config.data.provider || (providers.data?.find((p) => p.recommended)?.id ?? "");
    setProvider(preferred);
    setModel(config.data.model);
    setFallbackEnabled(config.data.fallback_enabled);
    setFallbackProvider(config.data.fallback_provider);
  }, [config.data, providers.data]);

  const models = useAiModels(provider);
  const selected = providers.data?.find((p) => p.id === provider);

  // Switching provider must not carry the old provider's model across.
  useEffect(() => {
    if (!selected) return;
    setApiKey("");
    setBaseUrl("");
    if (config.data?.provider === selected.id) setModel(config.data.model);
    else setModel(selected.model || selected.default_model);
  }, [selected, config.data]);

  const busy = save.isPending || test.isPending;
  const modelOptions = models.data?.data ?? [];
  const modelIsKnown = modelOptions.some((m) => m.id === model);

  const onSave = () => {
    if (!provider) return;
    setSaved(false);
    save.mutate(
      {
        provider,
        model: model.trim(),
        fallback_enabled: fallbackEnabled,
        fallback_provider: fallbackEnabled ? fallbackProvider : "",
        credentials: [
          {
            provider,
            ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
            ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
            model: model.trim(),
          },
        ],
      },
      {
        onSuccess: () => {
          setApiKey("");
          setSaved(true);
        },
      },
    );
  };

  return (
    <Card>
      <CardTitle
        action={
          config.data && (
            <div className="flex items-center gap-2">
              <Badge tone={config.data.configured ? "success" : "warning"}>
                {config.data.configured ? "configured" : "not configured"}
              </Badge>
              <span className="text-xs text-muted">from {config.data.source}</span>
            </div>
          )
        }
      >
        Artificial Intelligence
      </CardTitle>

      <p className="mb-3 text-xs text-muted">
        Choose who answers your automations. They never name a provider themselves — change it
        here and every automation follows on the next run, with no workflow edit.
      </p>

      <QueryBoundary
        isLoading={config.isLoading || providers.isLoading}
        isError={config.isError || providers.isError}
        error={config.error ?? providers.error}
        onRetry={() => {
          config.refetch();
          providers.refetch();
        }}
        skeletonRows={4}
      >
        <div className="space-y-4">
          <div>
            <p className="label mb-2">Provider</p>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="AI provider">
              {(providers.data ?? []).map((p) => (
                <ProviderTile
                  key={p.id}
                  provider={p}
                  selected={p.id === provider}
                  disabled={!canEdit || busy}
                  onSelect={() => setProvider(p.id)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Select
                label="Model"
                value={modelIsKnown ? model : "__custom__"}
                disabled={!canEdit || busy}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") setModel(e.target.value);
                }}
                // The backend says whether the list is live and, for NVIDIA NIM,
                // warns that a listed model is not necessarily one this account
                // can invoke.
                hint={models.data?.detail || undefined}
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">Other (type it below)</option>
              </Select>
              {!modelIsKnown && (
                <Input
                  aria-label="Custom model id"
                  placeholder={selected?.default_model ?? "provider/model-id"}
                  value={model}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!canEdit || busy}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
            </div>

            <Input
              label="Provider key"
              type="password"
              autoComplete="new-password"
              placeholder={
                selected?.secret_configured
                  ? `stored (${selected.secret_hint}) — leave blank to keep`
                  : "paste the key"
              }
              value={apiKey}
              disabled={!canEdit || busy}
              onChange={(e) => setApiKey(e.target.value)}
              hint={selected?.key_help}
            />
          </div>

          <Input
            label="Endpoint (optional)"
            placeholder={selected?.default_base_url ?? "https://…"}
            value={baseUrl}
            spellCheck={false}
            autoComplete="off"
            disabled={!canEdit || busy}
            onChange={(e) => setBaseUrl(e.target.value)}
            hint={
              selected
                ? `Leave empty for ${selected.base_url || selected.default_base_url}. Set it to point at a self-hosted endpoint.`
                : undefined
            }
          />

          <div className="border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={fallbackEnabled}
                disabled={!canEdit || busy}
                onChange={(e) => setFallbackEnabled(e.target.checked)}
              />
              Enable fallback
            </label>
            <p className="mt-1 text-xs text-muted">
              Used only when the provider itself fails — a timeout, a rate limit or a server
              error. A rejected key is reported instead, because retrying it elsewhere would fix
              nothing.
            </p>
            {fallbackEnabled && (
              <div className="mt-2">
                <Select
                  label="Fallback provider"
                  value={fallbackProvider}
                  disabled={!canEdit || busy}
                  onChange={(e) => setFallbackProvider(e.target.value as AiProviderId | "")}
                >
                  <option value="">Automatic (the next provider with a key)</option>
                  {(providers.data ?? [])
                    .filter((p) => p.id !== provider)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {p.secret_configured ? "" : " — no key yet"}
                      </option>
                    ))}
                </Select>
                {config.data?.effective_fallback_provider ? (
                  <p className="mt-1 text-xs text-ok">
                    Active fallback: {config.data.effective_fallback_provider}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    No usable fallback yet — a second provider needs a key.
                  </p>
                )}
              </div>
            )}
          </div>

          {config.data && !config.data.configured && config.data.missing.length > 0 && (
            <p className="text-xs text-warn">Still missing: {config.data.missing.join(", ")}</p>
          )}

          {test.isSuccess && (
            <p className={"text-xs " + (test.data.ok ? "text-ok" : "text-danger")}>
              {test.data.ok ? "✓ " : ""}
              {test.data.status.toUpperCase()} — {test.data.detail}
              {test.data.model && ` · model ${test.data.model}`}
              {test.data.latency_ms != null && ` · ${test.data.latency_ms} ms`}
            </p>
          )}
          {save.isError && <p className="text-xs text-danger">{errorMessage(save.error)}</p>}
          {test.isError && <p className="text-xs text-danger">{errorMessage(test.error)}</p>}
          {saved && !save.isPending && !save.isError && (
            <p className="text-xs text-ok">Saved. The monitor picks it up on the next check.</p>
          )}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {/* Explicit accessible names: this card shares a page with the
                  generic service cards, which also have Save / Test buttons. */}
              <Button
                size="sm"
                aria-label="Save AI settings"
                onClick={onSave}
                loading={save.isPending}
                disabled={!provider}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Test AI connection"
                onClick={() => test.mutate({})}
                loading={test.isPending}
                disabled={!config.data?.configured}
                title={
                  config.data?.configured ? undefined : "Save a provider and an API key first"
                }
              >
                Test connection
              </Button>
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-xs text-muted">
              Only an administrator can change these settings.
            </p>
          )}

          {canEdit && config.data && (
            <div className="border-t border-border pt-3">
              <p className="label">Automation token</p>
              <p className="text-xs text-muted">
                n8n presents this to call the platform&apos;s AI API. Set it as{" "}
                <code>AC_SERVICE_TOKEN</code> in your n8n environment.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={config.data.service_token.configured ? "success" : "warning"}>
                  {config.data.service_token.configured
                    ? `stored (${config.data.service_token.hint})`
                    : "not set"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={rotateToken.isPending}
                  onClick={() =>
                    rotateToken.mutate(undefined, {
                      onSuccess: (data) => setFreshToken(data.token),
                    })
                  }
                >
                  {config.data.service_token.configured ? "Regenerate" : "Generate"}
                </Button>
              </div>
              {freshToken && (
                <p className="mt-2 break-all rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs text-fg">
                  {freshToken}
                  <span className="mt-1 block font-sans text-muted">
                    Copy it now — it is shown once.
                  </span>
                </p>
              )}
              {rotateToken.isError && (
                <p className="mt-1 text-xs text-danger">{errorMessage(rotateToken.error)}</p>
              )}
            </div>
          )}

          {config.data?.providers.some((p) => p.source === "environment") && (
            <p className="text-xs text-muted">
              Some values still come from the server environment. Saving here overrides them
              without a redeploy.
            </p>
          )}
          {config.data && config.data.service_token.source === "environment" && (
            <p className="text-xs text-muted">
              The automation token currently comes from the environment.
            </p>
          )}
          {test.isSuccess && test.data.ok && (
            <p className="text-xs text-muted">Last test {relativeTime(new Date().toISOString())}</p>
          )}
        </div>
      </QueryBoundary>
    </Card>
  );
}
