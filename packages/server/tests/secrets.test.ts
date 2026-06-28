import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type RunningServer } from "../src/index.js";
import type { SecretBackend } from "../src/secret-backend.js";

// In-memory backend so the tests never touch the real Keychain. The shim
// snippet is recognizable in assertions (contains the env var name).
class FakeBackend implements SecretBackend {
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
    return `_fake_resolve '${name}' ${envVar}`;
  }
}

describe("secrets API", () => {
  let server: RunningServer;
  let backend: FakeBackend;
  let stateDirectory: string;
  let shimsDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-secrets-"));
    shimsDir = path.join(stateDirectory, "shims");
    backend = new FakeBackend();
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: backend,
      tabController: { open: async () => null, close: async () => {} },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  const listSecrets = async () =>
    (await (await fetch(`${baseUrl}/api/secrets`)).json()) as {
      supported: boolean;
      shimsDir: string;
      secrets: Array<{ name: string; envVar: string; programs: string[]; hasValue: boolean }>;
    };

  it("lists an empty policy with the backend's supported flag", async () => {
    const body = await listSecrets();
    expect(body.supported).toBe(true);
    expect(body.secrets).toEqual([]);
    expect(body.shimsDir).toBe(shimsDir);
  });

  it("creates a secret, stores the value in the backend, and generates a shim", async () => {
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", programs: ["pi"], value: "sk-test" }),
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created.name).toBe("anthropic-api-key");
    expect(created.envVar).toBe("ANTHROPIC_API_KEY");
    expect(created.hasValue).toBe(true);
    // The value is never echoed back in any response.
    expect(JSON.stringify(created)).not.toContain("sk-test");

    // Value lives in the backend, not the policy file.
    expect(backend.store.get("anthropic-api-key")).toBe("sk-test");
    const policyFile = readFileSync(path.join(stateDirectory, "secrets.json"), "utf8");
    expect(policyFile).not.toContain("sk-test");

    // A shim for `pi` exists, is executable, and references the env var.
    const shimPath = path.join(shimsDir, "pi");
    expect(existsSync(shimPath)).toBe(true);
    expect(statSync(shimPath).mode & 0o111).toBeTruthy();
    const shim = readFileSync(shimPath, "utf8");
    expect(shim).toContain("ANTHROPIC_API_KEY");
    expect(shim).toContain("anthropic-api-key");
    // The shim strips its own dir to avoid recursion.
    expect(shim).toContain(shimsDir);
  });

  it("updates a policy without a value, keeping the stored value", async () => {
    await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", programs: ["pi"], value: "sk-test" }),
    });
    // Add a program without re-sending the value.
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", programs: ["pi", "claude"] }),
    });
    expect(response.status).toBe(200);
    expect(backend.store.get("anthropic-api-key")).toBe("sk-test");
    expect(existsSync(path.join(shimsDir, "claude"))).toBe(true);
    const body = await listSecrets();
    expect(body.secrets[0].programs).toEqual(["pi", "claude"]);
    expect(body.secrets[0].hasValue).toBe(true);
  });

  it("deletes a secret, its value, and its shims", async () => {
    await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", programs: ["pi"], value: "sk-test" }),
    });
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(backend.store.has("anthropic-api-key")).toBe(false);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(false);
    const body = await listSecrets();
    expect(body.secrets).toEqual([]);
  });

  it("rejects creating a new secret without a value", async () => {
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", programs: ["pi"] }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid name or body", async () => {
    const badName = await fetch(`${baseUrl}/api/secrets/bad name!`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "X", programs: ["pi"], value: "v" }),
    });
    expect(badName.status).toBe(400);

    const badBody = await fetch(`${baseUrl}/api/secrets/x`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "lowercase", programs: ["pi"], value: "v" }),
    });
    expect(badBody.status).toBe(400);
  });

  it("removes a stale shim when a program is dropped from all secrets", async () => {
    await fetch(`${baseUrl}/api/secrets/a`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "A_KEY", programs: ["pi", "claude"], value: "va" }),
    });
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);
    expect(existsSync(path.join(shimsDir, "claude"))).toBe(true);
    // Drop `claude` from the policy → its shim is stale and removed.
    await fetch(`${baseUrl}/api/secrets/a`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "A_KEY", programs: ["pi"] }),
    });
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);
    expect(existsSync(path.join(shimsDir, "claude"))).toBe(false);
  });
});

describe("secrets API on an unsupported backend", () => {
  let server: RunningServer;
  let stateDirectory: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-secrets-unsupported-"));
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: {
        supported: false,
        get: async () => null,
        has: async () => false,
        set: async () => {
          throw new Error("unsupported");
        },
        delete: async () => {},
        shimResolveSnippet: () => ":",
      },
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("reports unsupported in the list and rejects writes", async () => {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const list = (await (await fetch(`${baseUrl}/api/secrets`)).json()) as {
      supported: boolean;
    };
    expect(list.supported).toBe(false);
    const response = await fetch(`${baseUrl}/api/secrets/x`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "X", programs: ["pi"], value: "v" }),
    });
    expect(response.status).toBe(409);
  });
});
