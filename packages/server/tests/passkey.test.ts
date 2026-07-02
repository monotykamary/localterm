import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import { CredentialStore } from "../src/identity/credential-store.js";
import { UserStore } from "../src/identity/user-store.js";
import { createHeaderIdentityProvider } from "../src/identity/header-provider.js";
import { createPasskeyIdentityProvider } from "../src/identity/passkey-provider.js";
import { createAuthGateMiddleware } from "../src/identity/resolve.js";
import { readSessionIdentity, setSessionCookie } from "../src/identity/session-cookie.js";

const secret = "passkey-test-secret";

describe("UserStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-users-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("findOrCreate creates then reuses, and addCredential persists", () => {
    const store = new UserStore(path.join(dir, "users.json"));
    expect(store.findOrCreate("alice").credentialIds).toEqual([]);
    expect(store.findOrCreate("alice").username).toBe("alice");
    store.addCredential("alice", "cred-1");
    expect(store.get("alice")?.credentialIds).toEqual(["cred-1"]);
    expect(store.get("bob")).toBeNull();

    const reloaded = new UserStore(path.join(dir, "users.json"));
    expect(reloaded.get("alice")?.credentialIds).toEqual(["cred-1"]);
  });
});

describe("CredentialStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-creds-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("put/get/updateCounter round-trips and persists", () => {
    const store = new CredentialStore(path.join(dir, "credentials.json"));
    store.put({ id: "cred-1", publicKey: "aGk=", counter: 3, username: "alice" });
    expect(store.get("cred-1")?.username).toBe("alice");
    store.updateCounter("cred-1", 4);
    expect(store.get("cred-1")?.counter).toBe(4);
    expect(store.get("missing")).toBeNull();

    const reloaded = new CredentialStore(path.join(dir, "credentials.json"));
    expect(reloaded.get("cred-1")?.counter).toBe(4);
  });
});

const providerDeps = (dir: string) => ({
  secret,
  getOrigin: () => "https://node.ts.net",
  stateDirectory: dir,
});

describe("passkey provider", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-passkey-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("denies unauthenticated (header does not)", () => {
    expect(
      createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir)).denyUnauthenticated,
    ).toBe(true);
    expect(createHeaderIdentityProvider({ provider: "header" }).denyUnauthenticated).toBe(false);
  });

  it("register/options returns registration options scoped to the request origin", async () => {
    const provider = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir));
    const routes = provider.routes;
    if (!routes) throw new Error("passkey provider should expose routes");
    const app = routes();
    const res = await app.request("/passkey/register/options", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://node.ts.net" },
      body: JSON.stringify({ username: "alice" }),
    });
    expect(res.status).toBe(200);
    const options = await res.json();
    expect(options.rp.id).toBe("node.ts.net");
    expect(options.user.name).toBe("alice");
    expect(options.challenge).toBeTruthy();
  });

  it("register/options 400 without a username", async () => {
    const routes = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const res = await routes().request("/passkey/register/options", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://node.ts.net" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("register/verify 400 on a malformed response (no authenticator needed)", async () => {
    const routes = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const res = await routes().request("/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://node.ts.net" },
      body: JSON.stringify({ username: "alice", response: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("me returns null without a session, the user after login-set", async () => {
    const routes = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const app = routes();
    expect(await (await app.request("/passkey/me")).json()).toEqual({ user: null });
  });

  it("login/options returns authentication options (discoverable when no username)", async () => {
    const routes = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir)).routes;
    if (!routes) throw new Error("no routes");
    const res = await routes().request("/passkey/login/options", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://node.ts.net" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const options = await res.json();
    expect(options.rpId).toBe("node.ts.net");
    expect(options.challenge).toBeTruthy();
  });

  it("register/options 403 when registration is closed", async () => {
    const routes = createPasskeyIdentityProvider(
      { provider: "passkey", registration: "closed" },
      providerDeps(dir),
    ).routes;
    if (!routes) throw new Error("no routes");
    const res = await routes().request("/passkey/register/options", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://node.ts.net" },
      body: JSON.stringify({ username: "alice" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("createAuthGateMiddleware", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-gate-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unauthenticated /api requests when the provider denies them", async () => {
    const provider = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir));
    const resolveIdentity = (c: Context) => readSessionIdentity(c, secret);
    const app = new Hono();
    app.use("*", createAuthGateMiddleware(provider, resolveIdentity));
    app.get("/api/sessions", (c) => c.json({ ok: true }));
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(401);
  });

  it("admits a request carrying a valid session cookie", async () => {
    const provider = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir));
    const resolveIdentity = (c: Context) => readSessionIdentity(c, secret);
    const app = new Hono();
    app.use("*", createAuthGateMiddleware(provider, resolveIdentity));
    app.get("/set", (c) => {
      setSessionCookie(c, secret, "alice");
      return c.text("ok");
    });
    app.get("/api/sessions", (c) => c.json({ ok: true }));

    const setRes = await app.request("/set");
    const setCookie = setRes.headers.get("set-cookie");
    if (!setCookie) throw new Error("no set-cookie");
    const res = await app.request("/api/sessions", {
      headers: { cookie: setCookie.split(";")[0] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("admits an operator bearer token (CLI) as the operator tier", async () => {
    const provider = createPasskeyIdentityProvider(
      { provider: "passkey", operatorToken: "op-token" },
      providerDeps(dir),
    );
    const resolveIdentity = (c: Context) => readSessionIdentity(c, secret);
    const app = new Hono();
    app.use("*", createAuthGateMiddleware(provider, resolveIdentity));
    app.get("/api/sessions", (c) => c.json({ ok: true }));

    // No cookie, no token → 401.
    expect((await app.request("/api/sessions")).status).toBe(401);
    // Wrong token → 401.
    expect(
      (await app.request("/api/sessions", { headers: { authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    // Valid operator token → 200 (operator tier, full access).
    expect(
      (await app.request("/api/sessions", { headers: { authorization: "Bearer op-token" } })).status,
    ).toBe(200);
  });

  it("exempts /api/health and the static/login surface", async () => {
    const provider = createPasskeyIdentityProvider({ provider: "passkey" }, providerDeps(dir));
    const resolveIdentity = (c: Context) => readSessionIdentity(c, secret);
    const app = new Hono();
    app.use("*", createAuthGateMiddleware(provider, resolveIdentity));
    app.get("/api/health", (c) => c.json({ ok: true }));
    app.get("/", (c) => c.html("<html></html>"));
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
  });

  it("does not gate when the provider allows unauthenticated (header mode)", async () => {
    const provider = createHeaderIdentityProvider({ provider: "header" });
    const resolveIdentity = () => null;
    const app = new Hono();
    app.use("*", createAuthGateMiddleware(provider, resolveIdentity));
    app.get("/api/sessions", (c) => c.json({ ok: true }));
    expect((await app.request("/api/sessions")).status).toBe(200);
  });
});
