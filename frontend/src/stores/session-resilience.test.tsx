import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth";
import { ToastProvider } from "./toast";
import { getSession, setSession } from "@/api/tokenStore";
import { resetIdentityCache, isAuthFailure } from "@/api/identity";
import { ApiError } from "@/api";
import { sampleToken, sampleUser } from "@/test/utils";

/**
 * A session must end only when the backend says it has.
 *
 * Observed against the real installation: six page reloads produced twelve
 * `/api/auth/me` calls (StrictMode doubles the boot effect), tripped the
 * backend's 10/minute auth limit, and the HTTP 429 signed the user out with a
 * perfectly valid token. Both halves are covered here - what counts as
 * evidence, and how often we ask.
 */

function Probe() {
  const { status, user } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? "-"}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <ToastProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </ToastProvider>,
  );
}

/** A stored session that is due for verification. */
function storedSession(over: Record<string, unknown> = {}) {
  setSession({
    ...sampleToken(),
    expires_at: Date.now() + 30 * 60_000,
    validated_at: undefined,
    ...over,
  } as never);
}

function stubMe(status: number, body: unknown = { detail: "x" }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      // a 401 makes the client try to refresh; refuse that too, definitively
      if (url.includes("/api/auth/refresh")) {
        return new Response(JSON.stringify({ detail: "no" }), { status: 401 });
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  setSession(null);
  resetIdentityCache();
  vi.unstubAllGlobals();
});

describe("a temporary failure never ends the session", () => {
  it("keeps the session when /auth/me is rate limited (429)", async () => {
    storedSession();
    stubMe(429, { detail: "Rate limit exceeded: 10 per 1 minute" });
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("user")).toHaveTextContent("admin");
    expect(getSession()).not.toBeNull();
  });

  it("keeps the session when the backend is unavailable (503)", async () => {
    storedSession();
    stubMe(503, { detail: "service unavailable" });
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(getSession()).not.toBeNull();
  });

  it("keeps the session when the network drops", async () => {
    storedSession();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(getSession()).not.toBeNull();
  });

  it("keeps the session when the refresh endpoint is itself rate limited", async () => {
    storedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // the access token is rejected, and renewing it is rate limited
        if (url.includes("/api/auth/refresh")) {
          return new Response(JSON.stringify({ detail: "slow down" }), { status: 429 });
        }
        return new Response(JSON.stringify({ detail: "not authenticated" }), { status: 401 });
      }),
    );
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(getSession()).not.toBeNull();
  });
});

describe("a real authentication failure does end the session", () => {
  it("signs out on 401 when the refresh token is rejected too", async () => {
    storedSession();
    stubMe(401, { detail: "not authenticated" });
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(getSession()).toBeNull();
  });
});

describe("isAuthFailure", () => {
  it("accepts only an explicit 401", () => {
    expect(isAuthFailure(new ApiError(401, "no"))).toBe(true);
    expect(isAuthFailure(new ApiError(401, "expired", null, "session_expired"))).toBe(true);
    expect(isAuthFailure(new ApiError(429, "slow down"))).toBe(false);
    expect(isAuthFailure(new ApiError(503, "later", null, "refresh_unavailable"))).toBe(false);
    expect(isAuthFailure(new ApiError(0, "offline", null, "network"))).toBe(false);
    expect(isAuthFailure(new Error("boom"))).toBe(false);
  });
});

describe("verification traffic", () => {
  it("asks once even though StrictMode mounts the provider twice", async () => {
    storedSession();
    const calls = stubMe(200, sampleUser);
    renderProbe();
    renderProbe();

    await waitFor(() => expect(screen.getAllByTestId("status")[0]).toHaveTextContent("authenticated"));
    expect(calls.filter((u) => u.includes("/api/auth/me"))).toHaveLength(1);
  });

  it("does not re-verify a session that was just verified", async () => {
    storedSession({ validated_at: Date.now() - 2_000 });
    const calls = stubMe(200, sampleUser);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(calls.filter((u) => u.includes("/api/auth/me"))).toHaveLength(0);
  });

  it("does verify again once the stamp is stale", async () => {
    storedSession({ validated_at: Date.now() - 5 * 60_000 });
    const calls = stubMe(200, sampleUser);
    renderProbe();

    await waitFor(() => expect(calls.filter((u) => u.includes("/api/auth/me"))).toHaveLength(1));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });
});
