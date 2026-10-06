import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authApi, authEvents, ApiError } from "@/api";
import { isAuthFailure, verifyIdentity } from "@/api/identity";
import {
  fromTokenResponse,
  getSession,
  setSession,
  subscribe,
  type Session,
} from "@/api/tokenStore";
import type { User } from "@/api/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthCtx {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  isAdmin: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (getSession() ? "loading" : "anonymous"));
  const [user, setUser] = useState<User | null>(() => getSession()?.user ?? null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Validate a persisted session on boot.
  //
  // `verifyIdentity` de-duplicates: StrictMode runs this effect twice and a
  // recently verified session is not re-verified at all, so a burst of reloads
  // no longer spends the backend's auth rate limit on bookkeeping.
  //
  // The failure branch is the important part. Dropping the session on *any*
  // error meant a 429, a hiccup or an offline moment logged the user out while
  // their token was still perfectly valid. Now only real evidence - the API
  // saying 401 - ends the session; anything else leaves it alone and trusts the
  // stored identity until a genuine call proves otherwise.
  useEffect(() => {
    const stored = getSession();
    if (!stored) return;
    let cancelled = false;
    verifyIdentity()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch((err) => {
        if (cancelled) return;
        if (isAuthFailure(err)) {
          setSession(null);
          setUser(null);
          setStatus("anonymous");
          return;
        }
        setUser(stored.user);
        setStatus("authenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // React to session drops from the API layer (failed refresh) and other tabs.
  useEffect(() => {
    const onExpired = () => {
      if (!mounted.current) return;
      setUser(null);
      setStatus("anonymous");
      setError("Your session has expired. Please sign in again.");
    };
    authEvents.addEventListener("expired", onExpired);
    const unsub = subscribe((s: Session | null) => {
      if (!mounted.current) return;
      if (!s) {
        setUser(null);
        setStatus("anonymous");
      } else {
        setUser(s.user);
        setStatus("authenticated");
      }
    });
    return () => {
      authEvents.removeEventListener("expired", onExpired);
      unsub();
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    try {
      const res = await authApi.login(identifier, password);
      setSession(fromTokenResponse(res));
      setUser(res.user);
      setStatus("authenticated");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 401
            ? "Incorrect email/username or password."
            : err.message
          : "Unable to sign in right now.";
      setError(message);
      throw err;
    }
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      setError(null);
      try {
        const res = await authApi.register(email, username, password);
        setSession(fromTokenResponse(res));
        setUser(res.user);
        setStatus("authenticated");
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.status === 409
              ? "That email or username is already registered."
              : err.message
            : "Unable to create the account right now.";
        setError(message);
        throw err;
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    const s = getSession();
    if (s?.refresh_token) {
      try {
        await authApi.logout(s.refresh_token);
      } catch {
        /* best effort */
      }
    }
    setSession(null);
    setUser(null);
    setStatus("anonymous");
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      error,
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
      clearError,
    }),
    [status, user, error, login, register, logout, clearError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
