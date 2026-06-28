import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      secrets: Array<{ name: string; envVar: string; hasValue: boolean }>;
    };

  it("lists an empty policy with the backend's supported flag", async () => {
    const body = await listSecrets();
    expect(body.supported).toBe(true);
    expect(body.secrets).toEqual([]);
    expect(body.shimsDir).toBe(shimsDir);
  });

  it("creates a secret and stores the value in the backend (never on disk or echoed)", async () => {
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", value: "sk-test" }),
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
  });

  it("updates the env var without a value, keeping the stored value", async () => {
    await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", value: "sk-test" }),
    });
    // Change the env var without re-sending the value.
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_KEY" }),
    });
    expect(response.status).toBe(200);
    expect(backend.store.get("anthropic-api-key")).toBe("sk-test");
    const body = await listSecrets();
    expect(body.secrets[0].envVar).toBe("ANTHROPIC_KEY");
    expect(body.secrets[0].hasValue).toBe(true);
  });

  it("deletes a secret and its backend value", async () => {
    await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY", value: "sk-test" }),
    });
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(backend.store.has("anthropic-api-key")).toBe(false);
    const body = await listSecrets();
    expect(body.secrets).toEqual([]);
  });

  it("rejects creating a new secret without a value", async () => {
    const response = await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_API_KEY" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid name or body", async () => {
    const badName = await fetch(`${baseUrl}/api/secrets/bad name!`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "X", value: "v" }),
    });
    expect(badName.status).toBe(400);

    const badBody = await fetch(`${baseUrl}/api/secrets/x`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "lowercase", value: "v" }),
    });
    expect(badBody.status).toBe(400);
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
      body: JSON.stringify({ envVar: "X", value: "v" }),
    });
    expect(response.status).toBe(409);
  });
});
