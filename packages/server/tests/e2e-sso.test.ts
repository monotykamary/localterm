import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { generateKeyPairSync, createSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { generate } from "selfsigned";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { createServer, type RunningServer } from "../src/index.js";
import { signSessionToken } from "../src/identity/session-cookie.js";
import { AUTH_COOKIE_NAME, AUTH_SECRET_FILENAME } from "../src/constants.js";
import type { SecretBackend } from "../src/secret-backend.js";

// Two hermetic e2e suites for the parts of SSO a browser isn't needed for:
//   1. passkey mode — the auth gate, the operator bearer token, the signed
//      session cookie (verified through the real /me route), and per-user
//      session partitioning. Cookies are minted with the daemon's real
//      signSessionToken + auth secret (a real login would issue the same
//      bytes), so the gate's cookie verification + the registry's owner-scoping
//      run for real — the WebAuthn ceremony itself is the browser harness.
//   2. OIDC mode over HTTPS — the full authorization-code + PKCE round-trip
//      (discovery → authorize → callback → token exchange → id_token
//      validation → userinfo → cookie) against a mock IdP that signs id_tokens
//      with a generated RSA key, plus the same isolation + operator-token
//      assertions through a real login. oauth4webapi enforces HTTPS, so the
//      IdP runs over TLS with a self-signed cert and the test disables Node's
//      cert verification for the process (this file's worker only).

class InMemorySecretBackend implements SecretBackend {
  readonly supported = true;
  readonly store = new Map<string, string>();
  async get(name: string) {
    return this.store.get(name) ?? null;
  }
  async has(name: string) {
    return this.store.has(name);
  }
  async set(name: string, value: string) {
    this.store.set(name, value);
  }
  async delete(name: string) {
    this.store.delete(name);
  }
  shimResolveSnippet(name: string, envVar: string): string {
    return `_test_resolve '${name}' ${envVar}`;
  }
}

interface MockIdp {
  origin: string;
  setUser: (email: string) => void;
  stop: () => Promise<void>;
}

const KEY_ID = "test-key";

// A minimal OIDC IdP: discovery, JWKS, authorize, token, userinfo. id_tokens
// are signed RS256 with a generated RSA key (verified against the JWKS by the
// daemon's processAuthorizationCodeResponse). `setUser` picks the identity the
// next /authorize issues, so two browser-less logins yield two distinct users.
const startHttpsMockIdp = async (): Promise<MockIdp> => {
  const pems = await generate(null, { keySize: 2048, algorithm: "sha256" });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  let origin = "";
  const codes = new Map<string, { user: string; nonce: string }>();
  const accessTokens = new Map<string, string>();
  let currentUser = "alice@example.com";

  const signIdToken = (payload: Record<string, unknown>): string => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const input = `${header}.${body}`;
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    return `${input}.${signer.sign(privateKey).toString("base64url")}`;
  };

  const app = new Hono();
  app.get("/.well-known/openid-configuration", (context) =>
    context.json({
      // `new URL(origin).href` normalizes the empty path to "/", so the issuer
      // oauth4webapi validates against carries a trailing slash.
      issuer: `${origin}/`,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      userinfo_endpoint: `${origin}/userinfo`,
      jwks_uri: `${origin}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
    }),
  );
  app.get("/jwks", (context) =>
    context.json({ keys: [{ ...publicJwk, kid: KEY_ID, use: "sig", alg: "RS256" }] }),
  );
  app.get("/authorize", (context) => {
    const code = `code_${Math.random().toString(36).slice(2)}`;
    codes.set(code, { user: currentUser, nonce: context.req.query("nonce") ?? "" });
    const callback = new URL(context.req.query("redirect_uri") ?? "");
    callback.searchParams.set("code", code);
    const state = context.req.query("state");
    if (state) callback.searchParams.set("state", state);
    return context.redirect(callback.toString(), 302);
  });
  app.post("/token", async (context) => {
    const form = new URLSearchParams(await context.req.text());
    const entry = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    if (!entry) return context.json({ error: "invalid_grant" }, 400);
    const accessToken = `at_${Math.random().toString(36).slice(2)}`;
    accessTokens.set(accessToken, entry.user);
    const now = Math.floor(Date.now() / 1000);
    return context.json({
      access_token: accessToken,
      token_type: "bearer",
      id_token: signIdToken({
        iss: `${origin}/`,
        sub: entry.user,
        aud: form.get("client_id"),
        nonce: entry.nonce,
        iat: now,
        exp: now + 3600,
        email: entry.user,
      }),
    });
  });
  app.get("/userinfo", (context) => {
    const token = (context.req.header("authorization") ?? "").replace(/^Bearer /, "");
    const user = accessTokens.get(token);
    if (!user) return context.json({ error: "invalid_token" }, 401);
    return context.json({ sub: user, email: user });
  });

  return new Promise<MockIdp>((resolve, reject) => {
    const node = https.createServer(
      { cert: pems.cert, key: pems.private },
      getRequestListener(app.fetch),
    );
    node.once("error", reject);
    node.listen(0, "127.0.0.1", () => {
      origin = `https://127.0.0.1:${(node.address() as AddressInfo).port}`;
      resolve({
        origin,
        setUser: (email: string) => {
          currentUser = email;
        },
        stop: () =>
          new Promise((resolveStop) => {
            node.close(() => resolveStop());
          }),
      });
    });
  });
};

// Drive the full authorization-code + PKCE flow without a browser: follow the
// 302 chain (login → IdP authorize → callback) with manual redirects and
// return the daemon's `Set-Cookie` (the signed session cookie).
const loginAs = async (daemonOrigin: string, idp: MockIdp, email: string): Promise<string> => {
  idp.setUser(email);
  const loginRes = await fetch(`${daemonOrigin}/auth/oidc/login`, { redirect: "manual" });
  if (loginRes.status !== 302) throw new Error(`login returned ${loginRes.status}: ${await loginRes.text()}`);
  const authorizeRes = await fetch(loginRes.headers.get("location")!, { redirect: "manual" });
  if (authorizeRes.status !== 302) throw new Error(`authorize returned ${authorizeRes.status}`);
  const callbackRes = await fetch(authorizeRes.headers.get("location")!, { redirect: "manual" });
  const setCookie = callbackRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("callback set no session cookie");
  return setCookie.split(";")[0];
};

const listSessions = async (origin: string, headers: Record<string, string>) =>
  (await (await fetch(`${origin}/api/sessions`, { headers })).json()) as {
    sessions: { id: string }[];
  };

const spawnSession = async (origin: string, headers: Record<string, string>) => {
  const res = await fetch(`${origin}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: (await res.json()) as { session?: { id: string } } };
};

let savedTlsReject: string | undefined;
beforeAll(() => {
  savedTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
});
afterAll(() => {
  if (savedTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTlsReject;
});

describe("e2e: auth gate + operator token + gateway mux (passkey mode)", () => {
  let server: RunningServer;
  let daemonOrigin: string;
  let cookieFor: (user: string) => string;
  let stateDirectory: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-e2e-"));
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: new InMemorySecretBackend(),
      tabController: { open: async () => null, close: async () => {} },
      identity: { provider: "passkey", operatorToken: "op-token" },
    });
    daemonOrigin = `http://127.0.0.1:${server.port}`;
    const secret = readFileSync(path.join(stateDirectory, AUTH_SECRET_FILENAME), "utf8");
    cookieFor = (user: string) => `${AUTH_COOKIE_NAME}=${signSessionToken(secret, user)}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("rejects /api/* without a session cookie (the auth gate)", async () => {
    const res = await fetch(`${daemonOrigin}/api/sessions`);
    expect(res.status).toBe(401);
  });

  it("admits the operator bearer token as the operator tier (the CLI)", async () => {
    const res = await fetch(`${daemonOrigin}/api/sessions`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).sessions).toEqual([]);
  });

  it("verifies a signed session cookie via the real /me route", async () => {
    const me = await (
      await fetch(`${daemonOrigin}/auth/passkey/me`, {
        headers: { cookie: cookieFor("alice@example.com") },
      })
    ).json();
    expect(me).toEqual({ user: "alice@example.com" });
  });

  it("partitions the session switcher by user (gateway mux isolation)", async () => {
    const aliceCookie = cookieFor("alice@example.com");
    const created = await spawnSession(daemonOrigin, { cookie: aliceCookie });
    expect(created.status).toBe(201);
    const aliceSessionId = created.body.session!.id;

    expect(
      (await listSessions(daemonOrigin, { cookie: aliceCookie })).sessions.map((s) => s.id),
    ).toContain(aliceSessionId);
    const bobList = await listSessions(daemonOrigin, {
      cookie: cookieFor("bob@example.com"),
    });
    expect(bobList.sessions).toEqual([]);
    expect(bobList.sessions.map((s) => s.id)).not.toContain(aliceSessionId);

    // The operator bearer token sees every session (full access, unpartitioned).
    const operatorList = await listSessions(daemonOrigin, { authorization: "Bearer op-token" });
    expect(operatorList.sessions.map((s) => s.id)).toContain(aliceSessionId);
  });
});

describe("e2e: OIDC round-trip over HTTPS", () => {
  let idp: MockIdp;
  let server: RunningServer;
  let daemonOrigin: string;
  let stateDirectory: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-e2e-oidc-"));
    idp = await startHttpsMockIdp();
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: new InMemorySecretBackend(),
      tabController: { open: async () => null, close: async () => {} },
      identity: {
        provider: "oidc",
        issuer: idp.origin,
        clientId: "localterm-test",
        clientSecret: "shh",
        operatorToken: "op-token",
      },
    });
    daemonOrigin = `http://127.0.0.1:${server.port}`;
    server.setPublicUrl(daemonOrigin);
  });

  afterEach(async () => {
    await server.stop();
    await idp.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("rejects /api/* without a session cookie (the auth gate)", async () => {
    expect((await fetch(`${daemonOrigin}/api/sessions`)).status).toBe(401);
  });

  it("completes the authorization-code flow and partitions sessions by user", async () => {
    const aliceCookie = await loginAs(daemonOrigin, idp, "alice@example.com");

    // The callback's cookie resolves to the IdP's `email` claim.
    const me = await (
      await fetch(`${daemonOrigin}/auth/oidc/me`, { headers: { cookie: aliceCookie } })
    ).json();
    expect(me).toEqual({ user: "alice@example.com" });

    const created = await spawnSession(daemonOrigin, { cookie: aliceCookie });
    expect(created.status).toBe(201);
    const aliceSessionId = created.body.session!.id;

    // Alice sees her session; Bob (a separate login) does not.
    expect(
      (await listSessions(daemonOrigin, { cookie: aliceCookie })).sessions.map((s) => s.id),
    ).toContain(aliceSessionId);
    const bobCookie = await loginAs(daemonOrigin, idp, "bob@example.com");
    const bobList = await listSessions(daemonOrigin, { cookie: bobCookie });
    expect(bobList.sessions).toEqual([]);
    expect(bobList.sessions.map((s) => s.id)).not.toContain(aliceSessionId);

    // The operator bearer token (the CLI's credential) sees every session.
    const operatorList = await listSessions(daemonOrigin, { authorization: "Bearer op-token" });
    expect(operatorList.sessions.map((s) => s.id)).toContain(aliceSessionId);
  });
});
