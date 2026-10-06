/**
 * Runtime configuration. Everything comes from Vite env vars so the *same*
 * build runs locally and on Vercel — only the values differ.
 *
 *   VITE_API_URL   base URL of the FastAPI backend        (required in prod)
 *   VITE_WS_URL    base URL for WebSockets                 (optional, derived)
 *   VITE_APP_ENV   cosmetic environment label             (optional)
 *   VITE_N8N_URL   n8n editor URL as the browser sees it  (optional)
 */

const stripTrailingSlash = (u: string): string => u.replace(/\/+$/, "");

const rawApi = import.meta.env.VITE_API_URL?.trim();

export const API_URL = stripTrailingSlash(rawApi || "http://localhost:8080");

function deriveWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  try {
    const u = new URL(API_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return stripTrailingSlash(u.origin);
  } catch {
    return "ws://localhost:8080";
  }
}

export const WS_URL = deriveWsUrl();

export const APP_ENV = import.meta.env.VITE_APP_ENV?.trim() || (import.meta.env.DEV ? "development" : "production");

export const IS_DEV = import.meta.env.DEV;

/**
 * Where the n8n editor answers *in the user's browser*. Not the backend's
 * internal `http://n8n:5678`: this is the address OAuth callbacks and the
 * "Open n8n" buttons must use. Set VITE_N8N_URL when n8n is published elsewhere.
 */
export const N8N_URL = stripTrailingSlash(import.meta.env.VITE_N8N_URL?.trim() || "http://localhost:5678");

/** True when no explicit backend URL was configured (local-dev default). */
export const API_URL_IS_DEFAULT = !rawApi;
