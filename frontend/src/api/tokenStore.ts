/**
 * Session token storage.
 *
 * Trade-off: JWT access + opaque refresh token are kept in localStorage so the
 * session survives a reload / new tab (a product requirement). The access token
 * is short-lived (30 min) and the refresh token is revocable server-side
 * (`POST /api/auth/logout`, and rotated on every refresh). We never store any
 * other secret in the browser.
 */
import type { User } from "./types";

const KEY = "ac.session";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  user: User;
  /**
   * When `/api/auth/me` last confirmed this session, epoch ms. Persisted so a
   * reload does not re-verify what was verified a second ago - see
   * `api/identity.ts`. Absent on a session stored by an older build, which
   * simply means "verify now".
   */
  validated_at?: number;
}

type Listener = (session: Session | null) => void;

let current: Session | null = load();
const listeners = new Set<Listener>();

function load(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return current;
}

export function getAccessToken(): string | null {
  return current?.access_token ?? null;
}

export function setSession(next: Session | null): void {
  current = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage disabled (private mode) — session lives in memory only */
  }
  listeners.forEach((l) => l(next));
}

export function fromTokenResponse(r: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}): Session {
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.now() + r.expires_in * 1000,
    user: r.user,
    // The server just authenticated this token and told us who it belongs to;
    // asking it again immediately would be asking a question we know.
    validated_at: Date.now(),
  };
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab sync: reflect logout/login done in another tab.
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    current = load();
    listeners.forEach((l) => l(current));
  }
});
