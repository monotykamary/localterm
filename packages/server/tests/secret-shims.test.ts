import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildShimContent, regenerateShims } from "../src/secret-shims.js";
import type { SecretBackend } from "../src/secret-backend.js";

const backend: SecretBackend = {
  supported: true,
  get: async () => null,
  has: async () => false,
  set: async () => {},
  delete: async () => {},
  shimResolveSnippet: (name, envVar) => `_custom_resolve '${name}' ${envVar}`,
};

const helperBackend: SecretBackend = {
  ...backend,
  nativeHelperProtocol: "localterm-keychain-v1",
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("secret shims", () => {
  it("batches mappings into one native-helper invocation and keeps ordinary exec behavior", () => {
    const content = buildShimContent(
      "pi",
      "/tmp/localterm shims",
      helperBackend,
      "/synthetic/helper path",
      [
        { name: "anthropic", envVar: "ANTHROPIC_API_KEY" },
        { name: "github", envVar: "GITHUB_TOKEN" },
      ],
    );

    expect(content).toContain(
      "exec '/synthetic/helper path' 'ANTHROPIC_API_KEY' 'anthropic' 'GITHUB_TOKEN' 'github' -- \"$_real\" \"$@\"",
    );
    expect(content.match(/localterm secret get/g)).toBeNull();
    expect(content.match(/localterm-secret-helper/g)).toBeNull();
    expect(content).not.toContain("/usr/bin/security");
  });

  it("runs activity targets as children, records activity, and preserves their exit status", () => {
    const content = buildShimContent(
      "gh",
      "/tmp/shims",
      helperBackend,
      "/fake/helper",
      [{ name: "github", envVar: "GITHUB_TOKEN" }],
      "/tmp/activity/gh",
    );
    expect(content).toContain("'/fake/helper' 'GITHUB_TOKEN' 'github' -- \"$_real\" \"$@\"");
    expect(content).toContain("_rc=$?");
    expect(content).toContain('> "$_activity_file"');
    expect(content).toContain("exit $_rc");
    expect(content).not.toContain("exec '/fake/helper'");
  });

  it("allows activity-only shims without a configured helper", () => {
    const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-shims-"));
    temporaryDirectories.push(stateDirectory);
    const shimsDirectory = path.join(stateDirectory, "shims");
    regenerateShims(
      [],
      new Map(),
      shimsDirectory,
      backend,
      path.join(stateDirectory, "activity"),
      undefined,
      ["gh"],
    );

    const content = readFileSync(path.join(shimsDirectory, "gh"), "utf8");
    expect(content).toContain('"$_real" "$@"');
    expect(content).not.toContain("localterm-secret-helper");
    expect(content).not.toContain("_custom_resolve");
  });

  it("rejects a relative helper before sweeping existing shims", () => {
    const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-shims-"));
    temporaryDirectories.push(stateDirectory);
    const shimsDirectory = path.join(stateDirectory, "shims");
    regenerateShims(
      [{ name: "old", requestedSecrets: ["provider"] }],
      new Map([["provider", "PROVIDER_KEY"]]),
      shimsDirectory,
      helperBackend,
      path.join(stateDirectory, "activity"),
      "/absolute/helper",
      [],
    );

    expect(() =>
      regenerateShims(
        [{ name: "new", requestedSecrets: ["provider"] }],
        new Map([["provider", "PROVIDER_KEY"]]),
        shimsDirectory,
        helperBackend,
        path.join(stateDirectory, "activity"),
        "relative/helper",
        [],
      ),
    ).toThrow("secretHelperPath must be an absolute path");
    expect(readdirSync(shimsDirectory)).toEqual(["old"]);
  });

  it("builds every shim before mutating the directory", () => {
    const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-shims-"));
    temporaryDirectories.push(stateDirectory);
    const shimsDirectory = path.join(stateDirectory, "shims");
    regenerateShims(
      [{ name: "old", requestedSecrets: ["provider"] }],
      new Map([["provider", "PROVIDER_KEY"]]),
      shimsDirectory,
      backend,
      path.join(stateDirectory, "activity"),
      undefined,
      [],
    );
    const oldContent = readFileSync(path.join(shimsDirectory, "old"), "utf8");
    const failingBackend = {
      ...backend,
      shimResolveSnippet: () => {
        throw new Error("cannot build snippet");
      },
    };

    expect(() =>
      regenerateShims(
        [{ name: "new", requestedSecrets: ["provider"] }],
        new Map([["provider", "PROVIDER_KEY"]]),
        shimsDirectory,
        failingBackend,
        path.join(stateDirectory, "activity"),
        undefined,
        [],
      ),
    ).toThrow("cannot build snippet");
    expect(readdirSync(shimsDirectory)).toEqual(["old"]);
    expect(readFileSync(path.join(shimsDirectory, "old"), "utf8")).toBe(oldContent);
  });

  it("uses custom backend snippets without a helper, even when one is supplied", () => {
    const withoutHelper = buildShimContent("pi", "/tmp/shims", backend, undefined, [
      { name: "provider", envVar: "PROVIDER_KEY" },
    ]);
    const withIgnoredHelper = buildShimContent("pi", "/tmp/shims", backend, "/fake/helper", [
      { name: "provider", envVar: "PROVIDER_KEY" },
    ]);

    for (const content of [withoutHelper, withIgnoredHelper]) {
      expect(content).toContain("_custom_resolve 'provider' PROVIDER_KEY");
      expect(content).toContain('exec "$_real" "$@"');
      expect(content).not.toContain("/fake/helper");
    }
  });

  it("writes executable shims atomically without leaving temporary files", () => {
    const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-shims-"));
    temporaryDirectories.push(stateDirectory);
    const shimsDirectory = path.join(stateDirectory, "shims");
    regenerateShims(
      [{ name: "pi", requestedSecrets: ["provider"] }],
      new Map([["provider", "PROVIDER_KEY"]]),
      shimsDirectory,
      helperBackend,
      path.join(stateDirectory, "activity"),
      "/fake/native-helper",
      [],
    );

    expect(readdirSync(shimsDirectory)).toEqual(["pi"]);
    expect(statSync(path.join(shimsDirectory, "pi")).mode & 0o777).toBe(0o700);
    expect(readFileSync(path.join(shimsDirectory, "pi"), "utf8")).toContain(
      "'/fake/native-helper' 'PROVIDER_KEY' 'provider'",
    );
  });
});
