import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { findBinaryOnPath } from "../src/utils/find-binary-on-path.js";

// Build a throwaway PATH with one executable binary in a temp dir so the test
// never depends on the host's real PATH layout.
const makeBinDir = (): { dir: string; path: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-binary-"));
  const binaryPath = path.join(dir, "fake-bin");
  fs.writeFileSync(binaryPath, "#!/bin/sh\n", { mode: 0o755 });
  return { dir, path: binaryPath };
};

describe("findBinaryOnPath", () => {
  let dir: string;
  let binaryPath: string;

  beforeEach(() => {
    ({ dir, path: binaryPath } = makeBinDir());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves an executable binary present on PATH", () => {
    expect(findBinaryOnPath("fake-bin", dir)).toBe(binaryPath);
  });

  it("returns null when the binary is absent from every PATH dir", () => {
    expect(findBinaryOnPath("no-such-binary-anywhere", dir)).toBeNull();
  });

  it("skips a matching name that isn't executable", () => {
    const nonExec = path.join(dir, "readonly-bin");
    fs.writeFileSync(nonExec, "", { mode: 0o644 });
    expect(findBinaryOnPath("readonly-bin", dir)).toBeNull();
  });

  it("returns the first executable match across multiple PATH dirs", () => {
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "find-binary-2"));
    fs.writeFileSync(path.join(secondDir, "fake-bin"), "", { mode: 0o755 });
    try {
      const multiPath = `${dir}${path.delimiter}${secondDir}`;
      expect(findBinaryOnPath("fake-bin", multiPath)).toBe(binaryPath);
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("skips empty PATH segments", () => {
    // A leading/trailing/duplicated delimiter yields empty segments that must
    // not be treated as the cwd (`join("", name)` would resolve to cwd).
    const multiPath = `${path.delimiter}${dir}${path.delimiter}`;
    expect(findBinaryOnPath("fake-bin", multiPath)).toBe(binaryPath);
  });
});
