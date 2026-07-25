import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readLocaltermSecretValuesForPi } from "../src/utils/read-secret-values.js";

describe("readLocaltermSecretValuesForPi", () => {
  let stateDirectory: string;

  beforeEach(() => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-pi-values-"));
  });

  afterEach(() => {
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  const writeSecrets = (secrets: unknown): void =>
    writeFileSync(path.join(stateDirectory, "secrets.json"), JSON.stringify(secrets));
  const writeProcesses = (processes: unknown): void =>
    writeFileSync(path.join(stateDirectory, "processes.json"), JSON.stringify(processes));

  const wirePi = (names: string[]): void => {
    writeSecrets({
      version: 2,
      secrets: names.map((name) => ({ name, envVar: name.toUpperCase() })),
    });
    writeProcesses({ version: 1, processes: [{ name: "pi", requestedSecrets: names }] });
  };

  it("returns [] when there is no pi process", () => {
    expect(readLocaltermSecretValuesForPi(stateDirectory, {})).toEqual([]);
  });

  it("reads the values of pi's secret env vars from process.env", () => {
    wirePi(["alpha_key", "beta_key"]);
    const env = { ALPHA_KEY: "sk_alpha_live", BETA_KEY: "ghp_beta_1234" };
    expect(readLocaltermSecretValuesForPi(stateDirectory, env)).toEqual([
      "sk_alpha_live",
      "ghp_beta_1234",
    ]);
  });

  it("skips env vars that are unset", () => {
    wirePi(["alpha_key", "beta_key"]);
    const env = { ALPHA_KEY: "sk_alpha_live" };
    expect(readLocaltermSecretValuesForPi(stateDirectory, env)).toEqual(["sk_alpha_live"]);
  });

  it("drops values below the redaction floor", () => {
    wirePi(["alpha_key", "tiny_key"]);
    const env = { ALPHA_KEY: "sk_alpha_live", TINY_KEY: "ab" };
    expect(readLocaltermSecretValuesForPi(stateDirectory, env)).toEqual(["sk_alpha_live"]);
  });

  it("deduplicates identical values", () => {
    wirePi(["alpha_key", "beta_key"]);
    const env = { ALPHA_KEY: "shared_value_1", BETA_KEY: "shared_value_1" };
    expect(readLocaltermSecretValuesForPi(stateDirectory, env)).toEqual(["shared_value_1"]);
  });
});
