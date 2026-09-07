import { useEffect, useState } from "react";
import { useAiConfig, useAiModels, useAiMutations, useAiProviders } from "@/hooks/queries";
import { Badge, Button, Card, CardTitle, Input, Select } from "@/components/ui";
import { QueryBoundary, errorMessage } from "@/components/common";
import { cn } from "@/utils/cn";
import type { AiProviderId, AiProviderInfo } from "@/api/types";

/**
 * The Artificial Intelligence panel.
 *
 * Two decisions live here and they are deliberately kept apart:
 *
 *   WHO ANSWERS   the primary provider, its model, and what happens when it
 *                 fails (the fallback provider and its model);
 *   CREDENTIALS   each provider's key and endpoint, editable for ANY provider
 *                 regardless of which one is primary.
 *
 * Keeping them in one control was a real bug: setting the OpenRouter key meant
 * selecting OpenRouter, which made it the primary - so a fallback could not be
 * configured without giving up the primary you wanted.
 *
 * A stored key is never sent to the browser: the field starts empty, an empty
 * field means "keep what is stored", and only the last four characters show.
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

/** A model picker that also accepts an id the provider did not list. */
function ModelPicker({
  label,
  provider,
  value,
  disabled,
  onChange,
}: {
  label: string;
  provider: AiProviderId | "";
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const models = useAiModels(provider);
  const options = models.data?.data ?? [];
  const known = options.some((m) => m.id === value);
  return (
    <div>
      <Select
        label={label}
        value={known ? value : "__custom__"}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== "__custom__") onChange(e.target.value);
        }}
        // The backend says whether the list is live and, for NVIDIA NIM, warns
        // that a listed model is not necessarily one this account can invoke.
        hint={models.data?.detail || undefined}
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="__custom__">Other (type it below)</option>
      </Select>
      {!known && (
        <Input
          aria-label={`${label} — custom id`}
          placeholder="provider/model-id"
          value={value}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function AiSettingsCard({ canEdit }: { canEdit: boolean }) {
  const config = useAiConfig();
  const providers = useAiProviders();
  const { save, saveCredentials, test, rotateToken } = useAiMutations();

  // who answers
  const [provider, setProvider] = useState<AiProviderId | "">("");
  const [model, setModel] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [fallbackProvider, setFallbackProvider] = useState<AiProviderId | "">("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [saved, setSaved] = useState(false);

  // credentials, for whichever provider is being edited
  const [credProvider, setCredProvider] = useState<AiProviderId | "">("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  const [freshToken, setFreshToken] = useState<string | null>(null);

  // Follow the backend, including a change made by another admin.
  useEffect(() => {
    if (!config.data) return;
    const preferred =
      config.data.provider || (providers.data?.find((p) => p.recommended)?.id ?? "");
    setProvider(preferred);
    setModel(config.data.model || "");
    setFallbackEnabled(config.data.fallback_enabled);
    setFallbackProvider(config.data.fallback_provider);
    setFallbackModel(config.data.fallback_model || "");
    setCredProvider((current) => current || preferred);
  }, [config.data, providers.data]);

  const selected = providers.data?.find((p) => p.id === provider);
  const editing = providers.data?.find((p) => p.id === credProvider);

  // Changing which provider is primary must not carry the old model across.
  useEffect(() => {
    if (!selected) return;
    if (config.data?.provider === selected.id) setModel(config.data.model || "");
    else setModel(selected.model || selected.default_model);
  }, [selected, config.data]);

  // Switching the credential editor clears the fields: they belong to a
  // different provider now, and a half-typed key must not leak across.
  useEffect(() => {
    setApiKey("");
    setBaseUrl("");
    setKeySaved(false);
  }, [credProvider]);

  const busy = save.isPending || saveCredentials.isPending || test.isPending;

  const onSaveSelection = () => {
    if (!provider) return;
    setSaved(false);
    save.mutate(
      {
        provider,
        model: model.trim(),
        fallback_enabled: fallbackEnabled,
        fallback_provider: fallbackEnabled ? fallbackProvider : "",
        fallback_model: fallbackEnabled ? fallbackModel.trim() : "",
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const onSaveCredentials = () => {
    if (!credProvider) return;
    setKeySaved(false);
    saveCredentials.mutate(
      {
        credentials: [
          {
            provider: credProvider,
            ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
            ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
          },
        ],
      },
      {
        onSuccess: () => {
          setApiKey("");
          setKeySaved(true);
        },
      },
    );
  };

  const testResultFor = (id: string) =>
    test.isSuccess && test.data.provider === id ? test.data : null;

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
            <p className="label mb-2">Primary provider</p>
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

          <ModelPicker
            label="Model"
            provider={provider}
            value={model}
            disabled={!canEdit || busy}
            onChange={setModel}
          />

          {/* -------------------------------------------------- fallback -- */}
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
              Used only when the provider itself fails — a timeout, a rate limit, a 5xx or an
              unreachable endpoint. A rejected key or a malformed request is reported instead,
              because sending it to a second provider would fail the same way.
            </p>
            {fallbackEnabled && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
                <ModelPicker
                  label="Fallback model"
                  provider={fallbackProvider || config.data?.effective_fallback_provider || ""}
                  value={fallbackModel}
                  disabled={!canEdit || busy || !fallbackProvider}
                  onChange={setFallbackModel}
                />
                <div className="sm:col-span-2">
                  {config.data?.effective_fallback_provider ? (
                    <p className="text-xs text-ok">
                      Active fallback: {config.data.effective_fallback_provider}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      No usable fallback yet — a second provider needs a key. Add one below.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {config.data && !config.data.configured && config.data.missing.length > 0 && (
            <p className="text-xs text-warn">Still missing: {config.data.missing.join(", ")}</p>
          )}

          {testResultFor(provider) && (
            <p className={"text-xs " + (testResultFor(provider)!.ok ? "text-ok" : "text-danger")}>
              {testResultFor(provider)!.ok ? "✓ " : ""}
              {testResultFor(provider)!.status.toUpperCase()} — {testResultFor(provider)!.detail}
              {testResultFor(provider)!.model && ` · model ${testResultFor(provider)!.model}`}
              {testResultFor(provider)!.latency_ms != null &&
                ` · ${testResultFor(provider)!.latency_ms} ms`}
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
                onClick={onSaveSelection}
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

          {/* ------------------------------------------- credentials ------ */}
          {canEdit && (
            <div className="rounded-lg border border-border p-3">
              <p className="label">Provider credentials</p>
              <p className="mb-2 text-xs text-muted">
                Any provider, whether or not it is the primary — this is how you give the
                fallback its key without taking the primary away.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Provider"
                  value={credProvider}
                  disabled={busy}
                  onChange={(e) => setCredProvider(e.target.value as AiProviderId | "")}
                >
                  {(providers.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.secret_configured ? ` (${p.secret_hint})` : " — no key yet"}
                    </option>
                  ))}
                </Select>

                <Input
                  label="Provider key"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    editing?.secret_configured
                      ? `stored (${editing.secret_hint}) — leave blank to keep`
                      : "paste the key"
                  }
                  value={apiKey}
                  disabled={busy}
                  onChange={(e) => setApiKey(e.target.value)}
                  hint={editing?.key_help}
                />
              </div>

              <Input
                label="Endpoint (optional)"
                placeholder={editing?.default_base_url ?? "https://…"}
                value={baseUrl}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                onChange={(e) => setBaseUrl(e.target.value)}
                hint={
                  editing
                    ? `Leave empty for ${editing.base_url || editing.default_base_url}. Set it to point at a self-hosted endpoint.`
                    : undefined
                }
              />

              {testResultFor(credProvider) && credProvider !== provider && (
                <p
                  className={
                    "mt-2 text-xs " +
                    (testResultFor(credProvider)!.ok ? "text-ok" : "text-danger")
                  }
                >
                  {testResultFor(credProvider)!.ok ? "✓ " : ""}
                  {testResultFor(credProvider)!.status.toUpperCase()} —{" "}
                  {testResultFor(credProvider)!.detail}
                  {testResultFor(credProvider)!.latency_ms != null &&
                    ` · ${testResultFor(credProvider)!.latency_ms} ms`}
                </p>
              )}
              {saveCredentials.isError && (
                <p className="mt-2 text-xs text-danger">{errorMessage(saveCredentials.error)}</p>
              )}
              {keySaved && !saveCredentials.isPending && !saveCredentials.isError && (
                <p className="mt-2 text-xs text-ok">Credentials saved.</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  aria-label="Save provider credentials"
                  onClick={onSaveCredentials}
                  loading={saveCredentials.isPending}
                  disabled={!credProvider}
                >
                  Save key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Test this provider"
                  onClick={() => credProvider && test.mutate({ provider: credProvider })}
                  loading={test.isPending}
                  disabled={!editing?.secret_configured}
                  title={
                    editing?.secret_configured
                      ? undefined
                      : "Save a key for this provider first"
                  }
                >
                  Test this provider
                </Button>
              </div>
            </div>
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
        </div>
      </QueryBoundary>
    </Card>
  );
}
