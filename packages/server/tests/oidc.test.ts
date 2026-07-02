import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { OidcIdentityConfig } from "../src/identity/types.js";
import { createOidcIdentityProvider, sanitizeReturnTo } from "../src/identity/oidc-provider.js";
import { oidcConfigSchema } from "../src/schemas.js";
import { setSessionCookie } from "../src/identity/session-cookie.js";

const secret = "oidc-test-secret";
const baseConfig: OidcIdentityConfig = {
  provider: "oidc",
  issuer: "https://accounts.example.com",
  clientId: "localterm",
};

const providerDeps = (dir: string) => ({
  secret,
  getOrigin: () => "https://node.ts.net" as string | null,
  stateDirectory: dir,
});

describe("oidc config schema", () => {
  it("accepts a valid config (minimal and full)", () => {
    expect(oidcConfigSchema.safeParse({ provider: "oidc", issuer: "https://x.com", clientId: "c" }).success).toBe(true);
    expect(
      oidcConfigSchema.safeParse({
        provider: "oidc",
        issuer: "https://x.com",
        clientId: "c",
        clientSecret: "s",
        claim: "preferred_username",
        scope: "openid profile",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-url issuer and missing clientId", () => {
    expect(oidcConfigSchema.safeParse({ provider: "oidc", issuer: "not-a-url", clientId: "c" }).success).toBe(false);
    expect(oidcConfigSchema.safeParse({ provider: "oidc", issuer: "https://x.com" }).success).toBe(false);
  });

  it("rejects extra keys (strict)", () => {
    expect(
      oidcConfigSchema.safeParse({ provider: "oidc", issuer: "https://x.com", clientId: "c", extra: 1 }).success,
    ).toBe(false);
  });
});

describe("sanitizeReturnTo", () => {
  it("allows same-origin relative paths", () => {
    expect(sanitizeReturnTo("/sessions")).toBe("/sessions");
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  it("blocks open redirects and empty values", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
  });
});

describe("oidc provider", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-oidc-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("denies unauthenticated (like passkey)", () => {
    expect(createOidcIdentityProvider(baseConfig, providerDeps(dir)).denyUnauthenticated).toBe(true);
  });

  it("login 500s when no origin is announced (before any network call)", async () => {
    const provider = createOidcIdentityProvider(baseConfig, {
      secret,
      getOrigin: () => null,
      stateDirectory: dir,
    });
    const routes = provider.routes;
    if (!routes) throw new Error("oidc provider should expose routes");
    const res = await routes().request("/oidc/login");
    expect(res.status).toBe(500);
  });

  it("me reads the session cookie set out-of-band", async () => {
    const routes = createOidcIdentityProvider(baseConfig, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const app = new Hono();
    app.route("/auth", routes());
    app.get("/set", (c) => {
      setSessionCookie(c, secret, "alice@example.com");
      return c.text("ok");
    });
    const setRes = await app.request("/set");
    const setCookie = setRes.headers.get("set-cookie");
    if (!setCookie) throw new Error("no set-cookie");
    const meRes = await app.request("/auth/oidc/me", { headers: { cookie: setCookie.split(";")[0] } });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ user: "alice@example.com" });
  });

  it("me returns null without a session", async () => {
    const routes = createOidcIdentityProvider(baseConfig, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const app = new Hono();
    app.route("/auth", routes());
    expect(await (await app.request("/auth/oidc/me")).json()).toEqual({ user: null });
  });

  it("logout clears the session cookie", async () => {
    const routes = createOidcIdentityProvider(baseConfig, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const app = new Hono();
    app.route("/auth", routes());
    const res = await app.request("/auth/oidc/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Max-Age=0");
  });
});
