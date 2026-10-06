import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/pages/auth/AuthShell";
import { cn } from "@/utils/cn";

/**
 * Registration. Same endpoint, same policy, same store call as before - the
 * password rules below mirror app/schemas/auth.py rather than adding a second
 * one, and they are now shown as a live checklist instead of as an error after
 * the fact. There is no role selector: the backend assigns the role.
 */

interface Rule {
  label: string;
  test: (pw: string) => boolean;
}

const RULES: Rule[] = [
  { label: "Minimum 10 characters", test: (pw) => pw.length >= 10 },
  { label: "An upper-case letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A lower-case letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "A number", test: (pw) => /\d/.test(pw) },
];

function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "At least 10 characters.";
  if (pw === pw.toLowerCase() || pw === pw.toUpperCase() || !/\d/.test(pw))
    return "Needs an upper-case letter, a lower-case letter and a digit.";
  return null;
}

function Checklist({ password }: { password: string }) {
  return (
    <ul className="space-y-1.5">
      {RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.label}
            className={cn("flex items-center gap-2 text-xs transition-colors", met ? "text-ok" : "text-muted")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid h-3.5 w-3.5 place-items-center rounded-full border text-[9px]",
                met ? "border-ok bg-ok/15" : "border-border",
              )}
            >
              {met ? "✓" : ""}
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export function RegisterPage() {
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  const pwProblem = useMemo(() => passwordProblem(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !!email && username.length >= 3 && !pwProblem && !mismatch;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    clearError();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await register(email.trim(), username.trim(), password);
      navigate(from, { replace: true });
    } catch {
      /* error surfaced via context */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up access to your automation center."
      footer={
        <p className="text-sm text-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="3–64 chars: letters, digits, . _ -"
          error={touched && username.length > 0 && username.length < 3 ? "Too short." : undefined}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={touched && pwProblem ? pwProblem : undefined}
          required
        />
        <Checklist password={password} />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? "Passwords do not match." : undefined}
          required
        />

        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={submitting}
          disabled={submitting || (touched && !canSubmit)}
        >
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
