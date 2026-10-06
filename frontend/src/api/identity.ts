/**
 * Session verification: one request, one answer, shared by every caller.
 *
 * `GET /api/auth/me` sits behind the backend's auth rate limit (10/minute), and
 * the panel used to spend that budget on itself: React StrictMode invokes the
 * boot effect twice, and every full page load re-verified from scratch. Six
 * reloads were enough to earn an HTTP 429 - which the provider then read as
 * "your session is gone" and logged the user out mid-session.
 *
 * Two separate problems, fixed separately:
 *
 *   - the traffic, here: concurrent callers share one in-flight request, and a
 *     session verified moments ago is trusted rather than re-verified. The
 *     freshness stamp lives in the stored session, so it survives a reload and
 *     is shared across tabs.
 *   - the interpretation, in `isAuthFailure`: only the backend actually saying
 *     "not authenticated" ends a session. A rate limit, an outage or a dropped
 *     connection say nothing about whether the token is still valid.
 */
import { ApiError } from "./client";
import { authApi } from "./index";
import { getSession, setSession } from "./tokenStore";
import type { User } from "./types";

/**
 * How long a verified session is trusted without asking again. Short enough
 * that a role change or a revoked account is noticed promptly, long enough to
 * cover a burst of reloads and a StrictMode double mount.
 */
export const FRESHNESS_MS = 30_000;

let inFlight: Promise<User> | null = null;

/** Test seam: drop the shared promise between cases. */
export function resetIdentityCache(): void {
  inFlight = null;
}

/**
 * Confirm who the stored session belongs to.
 *
 * Resolves with the user, from cache when it was checked recently. Rejects with
 * whatever the API layer threw - the caller decides what that means, using
 * `isAuthFailure`.
 */
export function verifyIdentity(options: { force?: boolean } = {}): Promise<User> {
  const session = getSession();
  if (!session) return Promise.reject(new ApiError(401, "No session stored.", null, "no_session"));

  if (
    !options.force &&
    typeof session.validated_at === "number" &&
    Date.now() - session.validated_at < FRESHNESS_MS
  ) {
    return Promise.resolve(session.user);
  }

  if (!inFlight) {
    inFlight = authApi
      .me()
      .then((user) => {
        // Refresh both the identity and the stamp, keeping the tokens as they
        // are: this call proves the session works, it does not replace it.
        const current = getSession();
        if (current) setSession({ ...current, user, validated_at: Date.now() });
        return user;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Is this error evidence that the session itself is no longer valid?
 *
 * Only an explicit 401 from the API qualifies - including the synthetic one the
 * client raises after a refresh attempt fails. Everything else (429 rate limit,
 * 5xx, a network error, an aborted request) is a temporary condition, and
 * throwing the user out over it loses their place for no reason.
 */
export function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "network") return false;
  return error.status === 401;
}
