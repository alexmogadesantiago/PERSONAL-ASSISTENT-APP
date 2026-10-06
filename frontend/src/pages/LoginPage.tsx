import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/pages/auth/AuthShell";

/**
 * Sign in. The authentication flow is untouched - the same `login()` from the
 * auth store, the same `/api/auth/login` behind it, the same accepted
 * identifier (email or username). Only the surface changed.
 */
export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      navigate(from, { replace: true });
    } catch {
      /* error surfaced via context */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back to your automation center."
      footer={
        <p className="text-sm text-muted">
          No account yet?{" "}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Email or username"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={submitting} disabled={!identifier || !password}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
