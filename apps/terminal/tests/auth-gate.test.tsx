import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthGate } from "../src/components/auth-gate";

// WebAuthn is browser-side; stub the @simplewebauthn/browser entry points the
// gate touches so jsdom never loads the real WebAuthn code.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

const Terminal = () => <div data-testid="terminal" />;

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Stub global fetch with a pathname → JSON body map. Unmatched paths 404
// (the gate's /me probe on a provider with no routes, or any stray call).
const stubFetch = (routes: Record<string, unknown>): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const pathname = new URL(input).pathname;
    if (pathname in routes) return jsonRes(routes[pathname]);
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(browserSupportsWebAuthn).mockReset();
});

describe("AuthGate", () => {
  it("shows the passkey login screen when there is no session", async () => {
    stubFetch({
      "/auth/provider": { provider: "passkey", registration: "open" },
      "/auth/passkey/me": { user: null },
    });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByText("Register a passkey")).toBeDefined();
    expect(await screen.findByText("Sign in with passkey")).toBeDefined();
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("renders the terminal when a passkey session exists", async () => {
    stubFetch({
      "/auth/provider": { provider: "passkey", registration: "open" },
      "/auth/passkey/me": { user: "alice" },
    });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByTestId("terminal")).toBeDefined();
  });

  it("renders the terminal for the header provider with no /me probe", async () => {
    const fetchMock = stubFetch({ "/auth/provider": { provider: "header" } });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByTestId("terminal")).toBeDefined();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/header/me")),
    ).toBe(false);
  });

  it("renders the terminal when no provider is configured (provider null)", async () => {
    stubFetch({ "/auth/provider": { provider: null } });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByTestId("terminal")).toBeDefined();
  });

  it("shows the OIDC login button when there is no session", async () => {
    stubFetch({
      "/auth/provider": { provider: "oidc" },
      "/auth/oidc/me": { user: null },
    });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByText("Sign in with your identity provider")).toBeDefined();
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("falls through to the terminal when the probe fails (daemon unreachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByTestId("terminal")).toBeDefined();
  });

  it("shows the unsupported-browser message when WebAuthn is unavailable", async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    stubFetch({
      "/auth/provider": { provider: "passkey", registration: "open" },
      "/auth/passkey/me": { user: null },
    });
    render(
      <AuthGate>
        <Terminal />
      </AuthGate>,
    );
    expect(await screen.findByText(/doesn.t support passkeys/)).toBeDefined();
    expect(screen.queryByText("Register a passkey")).toBeNull();
  });
});
