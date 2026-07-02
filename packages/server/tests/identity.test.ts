import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import { Hono } from "hono";
import { SessionManager } from "../src/session-manager.js";
import { createProxyAllowlist } from "../src/identity/proxy-allowlist.js";
import { createHeaderIdentityProvider } from "../src/identity/header-provider.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";

const createFakeSocket = (): ClientSocket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
});

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    getGraceMs: () => graceMs,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

const shellInput = { shell: "/bin/sh", cwd: os.tmpdir() };

// Run the provider's `identify` against a real Hono context (built by
// `app.request`) so the test exercises `context.req.header` exactly as the
// daemon does, not a hand-rolled Context mock.
const identifyViaApp = async (
  provider: ReturnType<typeof createHeaderIdentityProvider>,
  headers: Record<string, string>,
  sourceIp: string | null,
): Promise<string | null> => {
  const app = new Hono();
  let captured: string | null = "__unset__";
  app.get("/", (c) => {
    captured = provider.identify(c, sourceIp)?.user ?? null;
    return c.text("ok");
  });
  await app.request("/", { headers });
  return captured;
};

describe("createProxyAllowlist", () => {
  it('matches loopback (127/8, ::1) and rejects a public address', () => {
    const allow = createProxyAllowlist("loopback");
    expect(allow.contains("127.0.0.1")).toBe(true);
    expect(allow.contains("127.0.0.2")).toBe(true);
    expect(allow.contains("::1")).toBe(true);
    expect(allow.contains("8.8.8.8")).toBe(false);
  });

  it("matches RFC1918 / CGNAT / link-local for the private shorthand", () => {
    const allow = createProxyAllowlist("private");
    expect(allow.contains("192.168.1.1")).toBe(true);
    expect(allow.contains("172.16.0.1")).toBe(true);
    expect(allow.contains("10.0.0.1")).toBe(true);
    expect(allow.contains("100.64.0.1")).toBe(true);
    expect(allow.contains("8.8.8.8")).toBe(false);
  });

  it("matches a CIDR and normalizes an IPv4-mapped IPv6 address to it", () => {
    const allow = createProxyAllowlist("10.0.0.0/8");
    expect(allow.contains("10.5.5.5")).toBe(true);
    expect(allow.contains("::ffff:10.5.5.5")).toBe(true);
    expect(allow.contains("11.0.0.1")).toBe(false);
  });

  it("matches a single bare address only", () => {
    const allow = createProxyAllowlist("127.0.0.1");
    expect(allow.contains("127.0.0.1")).toBe(true);
    expect(allow.contains("127.0.0.2")).toBe(false);
  });
});

describe("createHeaderIdentityProvider", () => {
  it("identifies a user from the proxy header when the source IP is trusted", async () => {
    const provider = createHeaderIdentityProvider({ provider: "header", trustedProxy: "loopback" });
    expect(await identifyViaApp(provider, { "x-forwarded-user": "alice@example.com" }, "127.0.0.1")).toBe(
      "alice@example.com",
    );
  });

  it("ignores the header when the source IP is outside the trusted proxy", async () => {
    const provider = createHeaderIdentityProvider({ provider: "header", trustedProxy: "loopback" });
    expect(await identifyViaApp(provider, { "x-forwarded-user": "alice" }, "8.8.8.8")).toBeNull();
  });

  it("resolves to the operator tier (null) when the header is absent", async () => {
    const provider = createHeaderIdentityProvider({ provider: "header", trustedProxy: "loopback" });
    expect(await identifyViaApp(provider, {}, "127.0.0.1")).toBeNull();
  });

  it("honors a custom header name and a CIDR trustedProxy", async () => {
    const provider = createHeaderIdentityProvider({
      provider: "header",
      header: "X-Remote-User",
      trustedProxy: "10.0.0.0/8",
    });
    expect(await identifyViaApp(provider, { "x-remote-user": "bob" }, "10.1.2.3")).toBe("bob");
    expect(await identifyViaApp(provider, { "x-remote-user": "bob" }, "192.168.1.1")).toBeNull();
  });
});

describe("SessionManager owner partition", () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("scopes list/attach/kill by owner; null is the operator tier (sees all)", () => {
    manager = createManager(10_000);
    const alice = manager.spawnAndAttach(createFakeSocket(), shellInput, undefined, "alice");
    expect(alice).not.toBeNull();
    if (!alice) return;
    const sid = alice.id;

    expect(manager.list("alice").map((session) => session.id)).toContain(sid);
    expect(manager.list("bob")).toEqual([]);
    expect(manager.list(null).map((session) => session.id)).toContain(sid);

    // Cross-tenant attach is denied (surfaces as a miss so the caller spawns
    // fresh); same-tenant and operator (null) attach succeed.
    expect(manager.attach(createFakeSocket(), sid, "bob")).toBeNull();
    expect(manager.attach(createFakeSocket(), sid, "alice")).not.toBeNull();
    expect(manager.attach(createFakeSocket(), sid, null)).not.toBeNull();

    // Cross-tenant kill is denied; the operator tier can kill any session.
    expect(manager.kill(sid, "bob")).toBe(false);
    expect(manager.kill(sid, null)).toBe(true);
    expect(manager.size()).toBe(0);
  });

  it("with no owner (legacy mode) every session is shared, matching no-auth", () => {
    manager = createManager(10_000);
    const sid = manager.spawnAndAttach(createFakeSocket(), shellInput)?.id;
    expect(sid).toBeTruthy();
    if (!sid) return;

    // owner defaults to null → the operator tier → all requests see all
    // sessions and can attach/kill, byte-identical to the pre-identity behavior.
    expect(manager.list().map((session) => session.id)).toContain(sid);
    expect(manager.list(null).map((session) => session.id)).toContain(sid);
    expect(manager.attach(createFakeSocket(), sid)).not.toBeNull();
    expect(manager.kill(sid)).toBe(true);
    expect(manager.size()).toBe(0);
  });
});
