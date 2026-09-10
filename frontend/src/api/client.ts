/**
 * Central API client. One place builds requests, attaches the bearer token,
 * normalises errors, and handles a single transparent token refresh on 401.
 *
 * Nothing in the app calls `fetch()` directly.
 */
import { API_URL } from "@/config";
import { getSession, setSession, fromTokenResponse } from "./tokenStore";

export class ApiError extends Error {
  status: number;
  code?: string;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/** Fired once when refreshing fails and the session is dropped. */
export const authEvents = new EventTarget();

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : API_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function extractMessage(payload: unknown, fallback: string): { message: string; code?: string } {
  if (typeof payload === "string" && payload) return { message: payload };
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const d = p.detail;
    if (typeof d === "string") return { message: d };
    // The array test comes FIRST: an array is also an object in JavaScript, so
    // the object branch below used to swallow FastAPI's validation list and
    // fall through to the generic fallback. That turned a precise "password
    // must be at least 10 characters" into "Request failed (422)".
    if (Array.isArray(d) && d.length) {
      // FastAPI validation error list: [{loc:["body","password"], msg:"..."}]
      const first = d[0] as Record<string, unknown>;
      if (typeof first?.msg === "string") {
        // Pydantic prefixes value errors with "Value error, "; the field name
        // is more useful to the reader than that.
        const msg = first.msg.replace(/^Value error,\s*/, "");
        const loc = Array.isArray(first.loc) ? first.loc : [];
        const field = loc.length ? String(loc[loc.length - 1]) : "";
        return { message: field && !msg.includes(field) ? `${field}: ${msg}` : msg };
      }
    }
    if (d && typeof d === "object") {
      const dd = d as Record<string, unknown>;
      return {
        message: typeof dd.message === "string" ? dd.message : fallback,
        code: typeof dd.code === "string" ? dd.code : undefined,
      };
    }
    if (typeof p.message === "string") return { message: p.message };
  }
  return { message: fallback };
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const session = getSession();
  if (!session?.refresh_token) return false;
  try {
    const res = await fetch(buildUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      dropSession();
      return false;
    }
    const data = await res.json();
    setSession(fromTokenResponse(data));
    return true;
  } catch {
    // network error: keep the session, the caller will surface the failure
    return false;
  }
}

/** Force a single token refresh (used by the WebSocket layer after a 1008). */
export function refreshAccessToken(): Promise<boolean> {
  return refreshOnce();
}

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function dropSession(): void {
  setSession(null);
  authEvents.dispatchEvent(new Event("expired"));
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal, query } = opts;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = getSession()?.access_token;
    if (auth && token) headers.authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Cannot reach the Automation Center backend.", err, "network");
  }

  if (res.status === 401 && auth && getSession()) {
    const ok = await refreshOnce();
    if (ok) {
      try {
        res = await send();
      } catch (err) {
        throw new ApiError(0, "Cannot reach the Automation Center backend.", err, "network");
      }
    } else {
      throw new ApiError(401, "Your session has expired. Please sign in again.", null, "session_expired");
    }
  }

  if (res.status === 204 || res.status === 205) return undefined as T;

  const payload = await parseBody(res);

  if (!res.ok) {
    const { message, code } = extractMessage(payload, `Request failed (${res.status})`);
    throw new ApiError(res.status, message, payload, code);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
  /** Unauthenticated GET (health probes work without a session). */
  getPublic: <T>(path: string, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", auth: false, signal }),
};
