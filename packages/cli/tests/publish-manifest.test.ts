import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifests = globSync("{apps,packages}/*/package.json", { cwd: repoRoot }).map(
  (path) => JSON.parse(readFileSync(`${repoRoot}/${path}`, "utf8")) as PackageManifest,
);

describe("publish manifests", () => {
  for (const manifest of manifests.filter((manifest) => !manifest.private)) {
    it(`${manifest.name} has no local-only runtime dependencies`, () => {
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          expect(range, `${manifest.name} ${field}.${name}`).not.toMatch(/^(workspace|file|link):/);
        }
      }
    });
  }

  it("pins the CLI to the server version in the fixed release group", () => {
    const cli = manifests.find((manifest) => manifest.name === "@monotykamary/localterm");
    const server = manifests.find((manifest) => manifest.name === "@monotykamary/localterm-server");
    expect(cli).toBeDefined();
    expect(server).toBeDefined();
    expect(cli?.dependencies?.["@monotykamary/localterm-server"]).toBe(server?.version);
  });
});
