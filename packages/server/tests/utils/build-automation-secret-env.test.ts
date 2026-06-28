import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SecretStore } from "../../src/secret-store.js";
import type { SecretBackend } from "../../src/secret-backend.js";
import { buildAutomationSecretEnv } from "../../src/utils/build-automation-secret-env.js";

// In-memory backend so the test never touches the real Keychain.
class FakeBackend implements SecretBackend {
  readonly supported = true;
  readonly values = new Map<string, string>();
  async get(name: string) {
    return this.values.get(name) ?? null;
  }
  async has(name: string) {
    return this.values.has(name);
  }
  async set(name: string, value: string) {
    this.values.set(name, value);
  }
  async delete(name: string) {
    this.values.delete(name);
  }
  shimResolveSnippet(): string {
    return ":";
  }
}

class UnsupportedFakeBackend implements SecretBackend {
  readonly supported = false;
  async get() {
    return null;
  }
  async has() {
    return false;
  }
  async set() {}
  async delete() {}
  shimResolveSnippet(): string {
    return ":";
  }
}

describe("buildAutomationSecretEnv", () => {
  let stateDirectory: string;
  let store: SecretStore;
  let backend: FakeBackend;

  beforeEach(() => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-automation-secret-env-"));
    store = new SecretStore({
      filePath: path.join(stateDirectory, "secrets.json"),
      shimsDir: path.join(stateDirectory, "shims"),
    });
    backend = new FakeBackend();
  });

  afterEach(() => {
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("returns an empty env when nothing is requested (zero backend cost)", async () => {
    const spy = vi.spyOn(backend, "get");
    expect(await buildAutomationSecretEnv([], store, backend)).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns an empty env when the backend is unsupported", async () => {
    store.upsert({ name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" });
    backend.values.set("neuralwatt_api_key", "secret");
    expect(
      await buildAutomationSecretEnv(["neuralwatt_api_key"], store, new UnsupportedFakeBackend()),
    ).toEqual({});
  });

  it("resolves each requested secret to its policy env var", async () => {
    store.upsert({ name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" });
    store.upsert({ name: "deepseek_api_key", envVar: "DEEPSEEK_API_KEY" });
    backend.values.set("neuralwatt_api_key", "nw-token");
    backend.values.set("deepseek_api_key", "ds-token");
    expect(
      await buildAutomationSecretEnv(["neuralwatt_api_key", "deepseek_api_key"], store, backend),
    ).toEqual({
      NEURALWATT_API_KEY: "nw-token",
      DEEPSEEK_API_KEY: "ds-token",
    });
  });

  it("skips a name deleted since the automation was authored (fail-closed)", async () => {
    store.upsert({ name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" });
    backend.values.set("neuralwatt_api_key", "nw-token");
    expect(
      await buildAutomationSecretEnv(["neuralwatt_api_key", "ghost_api_key"], store, backend),
    ).toEqual({
      NEURALWATT_API_KEY: "nw-token",
    });
  });

  it("skips a secret with no value (locked Keychain / never set) without clobbering", async () => {
    store.upsert({ name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" });
    store.upsert({ name: "deepseek_api_key", envVar: "DEEPSEEK_API_KEY" });
    backend.values.set("neuralwatt_api_key", "nw-token");
    expect(
      await buildAutomationSecretEnv(["neuralwatt_api_key", "deepseek_api_key"], store, backend),
    ).toEqual({
      NEURALWATT_API_KEY: "nw-token",
    });
  });

  it("resolves in parallel (backend.get is awaited for every requested name)", async () => {
    store.upsert({ name: "a", envVar: "A" });
    store.upsert({ name: "b", envVar: "B" });
    let resolveB: (value: string | null) => void = () => {};
    const bPromise = new Promise<string | null>((resolve) => {
      resolveB = resolve;
    });
    const get = vi.spyOn(backend, "get").mockImplementation(async (name: string) => {
      if (name === "b") return bPromise;
      return "value-a";
    });
    const resultPromise = buildAutomationSecretEnv(["a", "b"], store, backend);
    resolveB("value-b");
    expect(await resultPromise).toEqual({ A: "value-a", B: "value-b" });
    expect(get).toHaveBeenCalledWith("a");
    expect(get).toHaveBeenCalledWith("b");
  });
});
