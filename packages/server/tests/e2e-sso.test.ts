import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type RunningServer } from "../src/index.js";
import { signSessionToken } from "../src/identity/session-cookie.js";
import { AUTH_COOKIE_NAME, AUTH_SECRET_FILENAME } from "../src/constants.js";
import type { SecretBackend } from "../src/secret-backend.js";

// Hermetic e2e of the auth gate, the operator bearer token, the signed session
// cookie, and per-user session partitioning (the "gateway mux") — the parts of
// SSO that don't need a browser. The daemon runs in-process in the `passkey`
// mode (gate active, denyUnauthenticated) but the WebAuthn login ceremony is
// NOT exercised here: instead we mint session cookies directly with the
// daemon's real `signSessionToken` and its generated auth secret, so the
// gate's cookie verification + the registry's owner-scoping run for real. The
// WebAuthn/OIDC login ceremony + the HTTPS IdP round-trip live in the Docker
// + Playwright harness (oauth4webapi enforces HTTPS, so an in-process HTTP IdP
// can't drive them).

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

interface Setup {
  server: RunningServer;
  daemonOrigin: string;
  secret: string;
  cookieFor: (user: string) => string;
  stateDirectory: string;
}

const setup = async (): Promise<Setup> => {
  const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-e2e-"));
  const server = await createServer({
    port: 0,
    host: "127.0.0.1",
    stateDirectory,
    secretBackend: new InMemorySecretBackend(),
    tabController: { open: async () => null, close: async () => {} },
    identity: { provider: "passkey", operatorToken: "op-token" },
  });
  const daemonOrigin = `http://127.0.0.1:${server.port}`;
  // The daemon generated + persisted the HMAC secret on start; read it back so
  // we can mint the same signed cookies a real passkey login would issue.
  const secret = readFileSync(path.join(stateDirectory, AUTH_SECRET_FILENAME), "utf8");
  return {
    server,
    daemonOrigin,
    secret,
    stateDirectory,
    cookieFor: (user: string) => `${AUTH_COOKIE_NAME}=${signSessionToken(secret, user)}`,
  };
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

describe("e2e: auth gate + operator token + gateway mux", () => {
  let env: Setup;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await env.server.stop();
    rmSync(env.stateDirectory, { recursive: true, force: true });
  });

  it("rejects /api/* without a session cookie (the auth gate)", async () => {
    const res = await fetch(`${env.daemonOrigin}/api/sessions`);
    expect(res.status).toBe(401);
  });

  it("admits the operator bearer token as the operator tier (the CLI)", async () => {
    const res = await fetch(`${env.daemonOrigin}/api/sessions`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });

  it("verifies a signed session cookie via the real /me route", async () => {
    const me = await (
      await fetch(`${env.daemonOrigin}/auth/passkey/me`, {
        headers: { cookie: env.cookieFor("alice@example.com") },
      })
    ).json();
    expect(me).toEqual({ user: "alice@example.com" });
  });

  it("partitions the session switcher by user (gateway mux isolation)", async () => {
    // Alice (a real login would have issued this cookie) spawns a session.
    const aliceCookie = env.cookieFor("alice@example.com");
    const created = await spawnSession(env.daemonOrigin, { cookie: aliceCookie });
    expect(created.status).toBe(201);
    const aliceSessionId = created.body.session!.id;

    // Alice sees her session; Bob (a different login) does not.
    const aliceList = await listSessions(env.daemonOrigin, { cookie: aliceCookie });
    expect(aliceList.sessions.map((session) => session.id)).toContain(aliceSessionId);
    const bobList = await listSessions(env.daemonOrigin, {
      cookie: env.cookieFor("bob@example.com"),
    });
    expect(bobList.sessions).toEqual([]);
    expect(bobList.sessions.map((session) => session.id)).not.toContain(aliceSessionId);

    // The operator bearer token sees every session (full access, unpartitioned).
    const operatorList = await listSessions(env.daemonOrigin, {
      authorization: "Bearer op-token",
    });
    expect(operatorList.sessions.map((session) => session.id)).toContain(aliceSessionId);
  });
});
