import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

interface Setup {
  server: RunningServer;
  backend: FakeBackend;
  stateDirectory: string;
  shimsDir: string;
  baseUrl: string;
}

const setup = async (stateDirectory: string, backend: SecretBackend): Promise<Setup> => {
  const shimsDir = path.join(stateDirectory, "shims");
  const server = await createServer({
    port: 0,
    host: "127.0.0.1",
    stateDirectory,
    secretBackend: backend,
    tabController: { open: async () => null, close: async () => {} },
  });
  return {
    server,
    backend: backend as FakeBackend,
    stateDirectory,
    shimsDir,
    baseUrl: `http://127.0.0.1:${server.port}`,
  };
};

const createSecret = async (baseUrl: string, name: string, envVar: string, value: string) => {
  const response = await fetch(`${baseUrl}/api/secrets/${name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ envVar, value }),
  });
  expect(response.status).toBe(200);
};

const putProcess = async (baseUrl: string, name: string, requestedSecrets: string[]) => {
  const response = await fetch(`${baseUrl}/api/processes/${name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestedSecrets }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const listProcesses = async (baseUrl: string) =>
  (await (await fetch(`${baseUrl}/api/processes`)).json()) as {
    processes: Array<{ name: string; requestedSecrets: string[] }>;
  };

describe("processes API + shim generation", () => {
  let setupResult: Setup;

  beforeEach(async () => {
    setupResult = await setup(
      mkdtempSync(path.join(os.tmpdir(), "localterm-processes-")),
      new FakeBackend(),
    );
  });

  afterEach(async () => {
    await setupResult.server.stop();
    rmSync(setupResult.stateDirectory, { recursive: true, force: true });
  });

  it("lists an empty set of processes", async () => {
    const body = await listProcesses(setupResult.baseUrl);
    expect(body).toEqual({ processes: [] });
  });

  it("generates a shim for a process that requests a secret, referencing the env var", async () => {
    const { baseUrl, shimsDir, backend } = setupResult;
    await createSecret(baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "sk-test");
    const { status, body } = await putProcess(baseUrl, "pi", ["anthropic-api-key"]);
    expect(status).toBe(200);
    expect(body.process).toEqual({ name: "pi", requestedSecrets: ["anthropic-api-key"] });

    const shimPath = path.join(shimsDir, "pi");
    expect(existsSync(shimPath)).toBe(true);
    const shim = readFileSync(shimPath, "utf8");
    expect(shim).toContain("ANTHROPIC_API_KEY");
    expect(shim).toContain("anthropic-api-key");
    expect(shim).toContain(shimsDir);
    // The value is never baked into the shim (only the resolve snippet is).
    expect(shim).not.toContain("sk-test");
    expect(backend.store.get("anthropic-api-key")).toBe("sk-test");
  });

  it("merges secrets from several processes into one shim per process", async () => {
    const { baseUrl, shimsDir } = setupResult;
    await createSecret(baseUrl, "a", "A_KEY", "va");
    await createSecret(baseUrl, "b", "B_KEY", "vb");
    await putProcess(baseUrl, "pi", ["a", "b"]);
    const shim = readFileSync(path.join(shimsDir, "pi"), "utf8");
    expect(shim).toContain("A_KEY");
    expect(shim).toContain("B_KEY");
  });

  it("re-bakes the shim when the secret's env var changes", async () => {
    const { baseUrl, shimsDir } = setupResult;
    await createSecret(baseUrl, "anthropic-api-key", "ANTHROPIC_API_KEY", "sk-test");
    await putProcess(baseUrl, "pi", ["anthropic-api-key"]);
    expect(readFileSync(path.join(shimsDir, "pi"), "utf8")).toContain("ANTHROPIC_API_KEY");
    // Change the secret's env var; the shim is regenerated with the new var.
    await fetch(`${baseUrl}/api/secrets/anthropic-api-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar: "ANTHROPIC_KEY" }),
    });
    const shim = readFileSync(path.join(shimsDir, "pi"), "utf8");
    expect(shim).toContain("ANTHROPIC_KEY");
    expect(shim).not.toContain("ANTHROPIC_API_KEY");
  });

  it("removes a stale shim when a process no longer requests any secret", async () => {
    const { baseUrl, shimsDir } = setupResult;
    await createSecret(baseUrl, "a", "A_KEY", "va");
    await putProcess(baseUrl, "pi", ["a"]);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);
    // Empty the selection — the process now requests nothing, so no shim.
    await putProcess(baseUrl, "pi", []);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(false);
    // The process still exists in the policy, just with no requested secrets.
    expect(await listProcesses(baseUrl)).toEqual({
      processes: [{ name: "pi", requestedSecrets: [] }],
    });
  });

  it("removes a process's shim when the process is deleted", async () => {
    const { baseUrl, shimsDir } = setupResult;
    await createSecret(baseUrl, "a", "A_KEY", "va");
    await putProcess(baseUrl, "pi", ["a"]);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);
    const response = await fetch(`${baseUrl}/api/processes/pi`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(false);
    expect(await listProcesses(baseUrl)).toEqual({ processes: [] });
  });

  it("rejects a process referencing an unknown secret name", async () => {
    const { baseUrl } = setupResult;
    const { status, body } = await putProcess(baseUrl, "pi", ["ghost"]);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_secret" });
  });

  it("rejects an invalid process name or body", async () => {
    const { baseUrl } = setupResult;
    const badName = await fetch(`${baseUrl}/api/processes/bad name!`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestedSecrets: [] }),
    });
    expect(badName.status).toBe(400);
    const badBody = await fetch(`${baseUrl}/api/processes/pi`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestedSecrets: "not-an-array" }),
    });
    expect(badBody.status).toBe(400);
  });

  it("returns 404 deleting an unknown process", async () => {
    const response = await fetch(`${setupResult.baseUrl}/api/processes/ghost`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});

describe("secret-delete cascade", () => {
  let setupResult: Setup;

  beforeEach(async () => {
    setupResult = await setup(
      mkdtempSync(path.join(os.tmpdir(), "localterm-cascade-")),
      new FakeBackend(),
    );
  });

  afterEach(async () => {
    await setupResult.server.stop();
    rmSync(setupResult.stateDirectory, { recursive: true, force: true });
  });

  const createAutomation = async (baseUrl: string, requestedSecrets: string[]) => {
    const response = await fetch(`${baseUrl}/api/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "uses secrets",
        trigger: { kind: "schedule", schedule: "0 2 * * *" },
        cwd: os.tmpdir(),
        runner: { kind: "shell", command: "echo hi" },
        requestedSecrets,
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  };

  const listAutomations = async (baseUrl: string) =>
    (await (await fetch(`${baseUrl}/api/automations`)).json()) as {
      automations: Array<{ id: string; requestedSecrets: string[] }>;
    };

  it("strips the deleted secret from processes, automations, and shims", async () => {
    const { baseUrl, shimsDir, backend } = setupResult;
    await createSecret(baseUrl, "a", "A_KEY", "va");
    await putProcess(baseUrl, "pi", ["a"]);
    await createAutomation(baseUrl, ["a"]);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);

    const response = await fetch(`${baseUrl}/api/secrets/a`, { method: "DELETE" });
    expect(response.status).toBe(200);

    // Value gone.
    expect(backend.store.has("a")).toBe(false);

    // The process no longer requests the deleted secret → no shim.
    expect(await listProcesses(baseUrl)).toEqual({
      processes: [{ name: "pi", requestedSecrets: [] }],
    });
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(false);

    // The automation's requestedSecrets is also cleared (parity the automation
    // path was missing — a delete used to leave a stale name).
    const automations = await listAutomations(baseUrl);
    expect(automations.automations[0].requestedSecrets).toEqual([]);
  });
});

describe("migrate-secrets-to-processes (one-time, in-place)", () => {
  let server: RunningServer;
  let stateDirectory: string;
  let shimsDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-migrate-"));
    shimsDir = path.join(stateDirectory, "shims");
  });

  afterEach(async () => {
    await server?.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("inverts a v1 secrets.json (with programs) into v2 secrets + processes and builds shims", async () => {
    // v1 shape: programs live on each secret.
    writeFileSync(
      path.join(stateDirectory, "secrets.json"),
      JSON.stringify({
        version: 1,
        secrets: [
          { name: "anthropic", envVar: "ANTHROPIC_API_KEY", programs: ["pi", "claude"] },
          { name: "openai", envVar: "OPENAI_API_KEY", programs: ["pi"] },
        ],
      }),
    );

    const backend = new FakeBackend();
    backend.store.set("anthropic", "sk-anthropic");
    backend.store.set("openai", "sk-openai");
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: backend,
      tabController: { open: async () => null, close: async () => {} },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;

    // secrets.json rewritten to v2 with programs stripped.
    const secretsFile = JSON.parse(readFileSync(path.join(stateDirectory, "secrets.json"), "utf8"));
    expect(secretsFile.version).toBe(2);
    expect(secretsFile.secrets).toEqual([
      { name: "anthropic", envVar: "ANTHROPIC_API_KEY" },
      { name: "openai", envVar: "OPENAI_API_KEY" },
    ]);

    // processes.json built by inverting programs: pi requests both secrets,
    // claude requests only anthropic (policy order preserves anthropic first).
    const processes = await listProcesses(baseUrl);
    expect(processes.processes).toContainEqual({
      name: "pi",
      requestedSecrets: ["anthropic", "openai"],
    });
    expect(processes.processes).toContainEqual({
      name: "claude",
      requestedSecrets: ["anthropic"],
    });

    // Shims generated for both programs, referencing each requested env var.
    const piShim = readFileSync(path.join(shimsDir, "pi"), "utf8");
    expect(piShim).toContain("ANTHROPIC_API_KEY");
    expect(piShim).toContain("OPENAI_API_KEY");
    const claudeShim = readFileSync(path.join(shimsDir, "claude"), "utf8");
    expect(claudeShim).toContain("ANTHROPIC_API_KEY");
  });

  it("no-ops when secrets.json is already v2 (or absent)", async () => {
    writeFileSync(
      path.join(stateDirectory, "secrets.json"),
      JSON.stringify({
        version: 2,
        secrets: [{ name: "anthropic", envVar: "ANTHROPIC_API_KEY" }],
      }),
    );
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: new FakeBackend(),
      tabController: { open: async () => null, close: async () => {} },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;

    // No processes created from a v2 file.
    expect(await listProcesses(baseUrl)).toEqual({ processes: [] });
    const secretsFile = JSON.parse(readFileSync(path.join(stateDirectory, "secrets.json"), "utf8"));
    expect(secretsFile.version).toBe(2);
  });
});
