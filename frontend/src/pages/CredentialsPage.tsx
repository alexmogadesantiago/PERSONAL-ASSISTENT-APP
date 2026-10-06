import { useState } from "react";
import { useCredentialMutations, useCredentialStore, useCredentials } from "@/hooks/queries";
import { useToast } from "@/stores/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  StatusDot,
} from "@/components/ui";
import { QueryBoundary, errorMessage } from "@/components/common";
import { relativeTime } from "@/utils/format";
import type { Credential, CredentialStatus } from "@/api/types";
import { CredentialFormModal } from "./credentials/CredentialFormModal";

const statusTone: Record<CredentialStatus, "success" | "danger" | "neutral" | "warning"> = {
  connected: "success",
  error: "danger",
  untested: "warning",
  disabled: "neutral",
};

export function CredentialsPage() {
  const creds = useCredentials();
  const store = useCredentialStore();
  const m = useCredentialMutations();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | undefined>();
  const [deleting, setDeleting] = useState<Credential | undefined>();
  const [testingId, setTestingId] = useState<string | null>(null);

  async function handleTest(c: Credential) {
    setTestingId(c.id);
    try {
      const res = await m.test.mutateAsync(c.id);
      if (res.ok) toast.success(`${c.provider}/${c.name} connected`, res.detail);
      else toast.error(`${c.provider}/${c.name} test failed`, res.detail);
    } catch (e) {
      toast.error("Test failed", errorMessage(e));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        back={{ to: "/settings/integrations", label: "Settings" }}
        eyebrow="Advanced"
        title="API keys vault"
        description="Extra API keys for services without a connection flow - encrypted at rest, never shown in full, with a real connection test. Connections made in Integrations are managed there."
        actions={
          <Button
            disabled={store.data?.configured === false}
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            Add credential
          </Button>
        }
      />

      {store.data?.configured === false && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm text-warn">
          The credential store is not configured. Set <code>AC_CREDENTIAL_ENCRYPTION_KEY</code> on the
          backend before adding credentials.
        </div>
      )}

      <QueryBoundary
        isLoading={creds.isLoading}
        isError={creds.isError}
        error={creds.error}
        onRetry={() => creds.refetch()}
      >
        {creds.data && creds.data.length === 0 ? (
          <EmptyState
            title="No credentials configured."
            description="Add a credential to connect your services."
            action={
              store.data?.configured !== false && (
                <Button onClick={() => setFormOpen(true)}>Add a credential</Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {creds.data?.filter((c) => !(c.meta as Record<string, unknown> | undefined)?.integration).map((c) => (
              <Card key={c.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold capitalize text-fg">{c.provider}</p>
                    <p className="text-xs text-muted">{c.name}</p>
                  </div>
                  <Badge tone={statusTone[c.status]}>
                    <StatusDot online={c.status === "connected" ? true : c.status === "error" ? false : null} />
                    {c.status}
                  </Badge>
                </div>

                <p className="mt-3 font-mono text-sm text-muted">•••• {c.hint || "----"}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {c.type} · {c.last_tested_at ? `tested ${relativeTime(c.last_tested_at)}` : "never tested"}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={testingId === c.id}
                    disabled={!c.is_enabled}
                    onClick={() => handleTest(c)}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      m.update
                        .mutateAsync({ id: c.id, input: { is_enabled: !c.is_enabled } })
                        .then(() => toast.success(c.is_enabled ? "Disabled" : "Enabled"))
                        .catch((e) => toast.error("Failed", errorMessage(e)))
                    }
                  >
                    {c.is_enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(c)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

      <CredentialFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={editing}
        submitting={m.create.isPending || m.update.isPending}
        onSubmit={async (payload) => {
          if ("id" in payload) {
            await m.update.mutateAsync({ id: payload.id, input: payload.patch });
            toast.success("Credential updated");
          } else {
            await m.create.mutateAsync(payload);
            toast.success("Credential added");
          }
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title="Delete credential"
        message={`Delete ${deleting?.provider}/${deleting?.name}? Automations using it will stop working.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await m.remove.mutateAsync(deleting.id);
            toast.success("Credential deleted");
          } catch (e) {
            toast.error("Delete failed", errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
