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

describe("secrets export/import", () => {
  const makeServer = async () => {
    const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-secrets-export-"));
    const backend = new FakeBackend();
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: backend,
      secretExportScryptWorkFactor: 10,
      tabController: { open: async () => null, close: async () => {} },
    });
    return { server, backend, baseUrl: `http://127.0.0.1:${server.port}`, stateDirectory };
  };

  const putSecret = async (baseUrl: string, name: string, envVar: string, value: string) =>
    fetch(`${baseUrl}/api/secrets/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar, value }),
    });

  it("exports secrets as age-armored ciphertext and round-trips into a fresh store", async () => {
    const source = await makeServer();
    const target = await makeServer();
    try {
      await putSecret(source.baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "sk-test");
      await putSecret(source.baseUrl, "github-token", "GITHUB_TOKEN", "ghp_test");

      const exportResponse = await fetch(`${source.baseUrl}/api/secrets/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "correct-horse-battery-staple" }),
      });
      expect(exportResponse.status).toBe(200);
      const exported = (await exportResponse.json()) as {
        data: string;
        count: number;
        skipped: number;
      };
      expect(exported.count).toBe(2);
      expect(exported.skipped).toBe(0);
      // Ciphertext is age-armored; the plaintext values never appear in it.
      expect(exported.data).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
      expect(exported.data).not.toContain("sk-test");
      expect(exported.data).not.toContain("ghp_test");

      const importResponse = await fetch(`${target.baseUrl}/api/secrets/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "correct-horse-battery-staple", data: exported.data }),
      });
      expect(importResponse.status).toBe(200);
      const imported = (await importResponse.json()) as {
        imported: number;
        created: number;
        updated: number;
        errors: { name: string; error: string }[];
      };
      expect(imported.imported).toBe(2);
      expect(imported.created).toBe(2);
      expect(imported.updated).toBe(0);
      expect(imported.errors).toEqual([]);

      // Values landed in the target backend (never echoed over HTTP) and the
      // policy file carries the names + env vars — never the values.
      expect(target.backend.store.get("anthropic-api-key")).toBe("sk-test");
      expect(target.backend.store.get("github-token")).toBe("ghp_test");
      const policyFile = readFileSync(path.join(target.stateDirectory, "secrets.json"), "utf8");
      expect(policyFile).not.toContain("sk-test");
      expect(policyFile).toContain("anthropic-api-key");
      expect(policyFile).toContain("GITHUB_TOKEN");
    } finally {
      await source.server.stop();
      await target.server.stop();
      rmSync(source.stateDirectory, { recursive: true, force: true });
      rmSync(target.stateDirectory, { recursive: true, force: true });
    }
  });

  it("updates an existing secret on import and reports created vs updated", async () => {
    const server = await makeServer();
    try {
      await putSecret(server.baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "old-value");
      const exportResponse = await fetch(`${server.baseUrl}/api/secrets/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "p" }),
      });
      const exported = (await exportResponse.json()) as { data: string; count: number };
      expect(exported.count).toBe(1);

      // Import back over the existing entry; the value survives the round-trip.
      const importResponse = await fetch(`${server.baseUrl}/api/secrets/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "p", data: exported.data }),
      });
      const imported = (await importResponse.json()) as {
        imported: number;
        created: number;
        updated: number;
      };
      expect(imported.imported).toBe(1);
      expect(imported.updated).toBe(1);
      expect(imported.created).toBe(0);
      expect(server.backend.store.get("anthropic-api-key")).toBe("old-value");
    } finally {
      await server.server.stop();
      rmSync(server.stateDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an import with the wrong passphrase before any write", async () => {
    const source = await makeServer();
    const target = await makeServer();
    try {
      await putSecret(source.baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "sk-test");
      const exportResponse = await fetch(`${source.baseUrl}/api/secrets/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "right" }),
      });
      const exported = (await exportResponse.json()) as { data: string };

      const importResponse = await fetch(`${target.baseUrl}/api/secrets/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "wrong", data: exported.data }),
      });
      expect(importResponse.status).toBe(400);
      expect(target.backend.store.size).toBe(0);
    } finally {
      await source.server.stop();
      await target.server.stop();
      rmSync(source.stateDirectory, { recursive: true, force: true });
      rmSync(target.stateDirectory, { recursive: true, force: true });
    }
  });

  it("skips policy-only secrets (no value) on export", async () => {
    const source = await makeServer();
    try {
      await putSecret(source.baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "sk-test");
      // Strip the value directly, leaving a policy-only row the store still lists.
      source.backend.store.delete("anthropic-api-key");
      const exportResponse = await fetch(`${source.baseUrl}/api/secrets/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "p" }),
      });
      const exported = (await exportResponse.json()) as { count: number; skipped: number };
      expect(exported.count).toBe(0);
      expect(exported.skipped).toBe(1);
    } finally {
      await source.server.stop();
      rmSync(source.stateDirectory, { recursive: true, force: true });
    }
  });
});
