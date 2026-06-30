import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readLocaltermSecretEnvVarsForPi } from "../src/utils/read-localterm-secret-policy.js";

describe("readLocaltermSecretEnvVarsForPi", () => {
  let stateDirectory: string;

  beforeEach(() => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-pi-policy-"));
  });

  afterEach(() => {
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  const writeSecrets = (secrets: unknown): void =>
    writeFileSync(path.join(stateDirectory, "secrets.json"), JSON.stringify(secrets));
  const writeProcesses = (processes: unknown): void =>
    writeFileSync(path.join(stateDirectory, "processes.json"), JSON.stringify(processes));

  it("returns [] when both files are absent (no localterm install)", () => {
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });

  it("resolves the pi process's requested secrets to their env vars", () => {
    writeSecrets({
      version: 2,
      secrets: [
        { name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" },
        { name: "deepseek_api_key", envVar: "DEEPSEEK_API_KEY" },
      ],
    });
    writeProcesses({
      version: 1,
      processes: [{ name: "pi", requestedSecrets: ["neuralwatt_api_key", "deepseek_api_key"] }],
    });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([
      "NEURALWATT_API_KEY",
      "DEEPSEEK_API_KEY",
    ]);
  });

  it("returns [] when there is no pi process", () => {
    writeSecrets({ version: 2, secrets: [{ name: "x", envVar: "X" }] });
    writeProcesses({ version: 1, processes: [{ name: "other", requestedSecrets: ["x"] }] });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });

  it("skips a requested secret that no longer exists in the secrets file (fail-closed)", () => {
    writeSecrets({
      version: 2,
      secrets: [{ name: "neuralwatt_api_key", envVar: "NEURALWATT_API_KEY" }],
    });
    writeProcesses({
      version: 1,
      processes: [{ name: "pi", requestedSecrets: ["neuralwatt_api_key", "ghost_api_key"] }],
    });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual(["NEURALWATT_API_KEY"]);
  });

  it("preserves the requested order", () => {
    writeSecrets({
      version: 2,
      secrets: [
        { name: "alpha", envVar: "ALPHA" },
        { name: "beta", envVar: "BETA" },
        { name: "gamma", envVar: "GAMMA" },
      ],
    });
    writeProcesses({
      version: 1,
      processes: [{ name: "pi", requestedSecrets: ["gamma", "alpha"] }],
    });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual(["GAMMA", "ALPHA"]);
  });

  it("rejects a hostile env var name so it cannot delete an unrelated key", () => {
    writeSecrets({ version: 2, secrets: [{ name: "evil", envVar: "lowercase-thing" }] });
    writeProcesses({ version: 1, processes: [{ name: "pi", requestedSecrets: ["evil"] }] });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });

  it("rejects an invalid secret name in requestedSecrets", () => {
    writeSecrets({ version: 2, secrets: [{ name: "bad name", envVar: "X" }] });
    writeProcesses({ version: 1, processes: [{ name: "pi", requestedSecrets: ["bad name"] }] });
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });

  it("ignores a malformed processes file", () => {
    writeSecrets({ version: 2, secrets: [{ name: "x", envVar: "X" }] });
    writeFileSync(path.join(stateDirectory, "processes.json"), "not json");
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });

  it("ignores a malformed secrets file", () => {
    writeProcesses({ version: 1, processes: [{ name: "pi", requestedSecrets: ["x"] }] });
    writeFileSync(path.join(stateDirectory, "secrets.json"), "{ broken");
    expect(readLocaltermSecretEnvVarsForPi(stateDirectory)).toEqual([]);
  });
});
