import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  detectCaffeinateSupported,
  keepAwakeSpawnTarget,
  mouseJiggleSpawnTarget,
} from "../src/caffeinate-platform.js";
import {
  CAFFEINATE_ARGS,
  CAFFEINATE_BINARY,
  OSASCRIPT_BINARY,
  SYSTEMD_INHIBIT_ARGS,
  SYSTEMD_INHIBIT_BINARY,
  XDOTOOL_BINARY,
} from "../src/constants.js";

describe("keepAwakeSpawnTarget", () => {
  it("targets caffeinate on macOS without detaching (single process)", () => {
    expect(keepAwakeSpawnTarget("darwin")).toEqual({
      binary: CAFFEINATE_BINARY,
      args: CAFFEINATE_ARGS,
      detached: false,
    });
  });

  it("targets systemd-inhibit on Linux detached (group kill reaps the child)", () => {
    expect(keepAwakeSpawnTarget("linux")).toEqual({
      binary: SYSTEMD_INHIBIT_BINARY,
      args: SYSTEMD_INHIBIT_ARGS,
      detached: true,
    });
  });

  it("has no keep-awake implementation off macOS/Linux", () => {
    expect(keepAwakeSpawnTarget("win32")).toBeNull();
    expect(keepAwakeSpawnTarget("freebsd")).toBeNull();
  });
});

describe("mouseJiggleSpawnTarget", () => {
  it("targets an osascript JXA one-liner on macOS", () => {
    const target = mouseJiggleSpawnTarget("darwin");
    expect(target?.binary).toBe(OSASCRIPT_BINARY);
    expect(target?.args[0]).toBe("-l");
    expect(target?.args[1]).toBe("JavaScript");
    expect(target?.args[2]).toBe("-e");
    expect(target?.args[3]).toContain("CGEventPost");
  });

  it("targets paired relative xdotool moves on Linux (net zero cursor drift)", () => {
    const target = mouseJiggleSpawnTarget("linux");
    expect(target?.binary).toBe(XDOTOOL_BINARY);
    expect(target?.args.filter((arg) => arg === "mousemove_relative")).toHaveLength(2);
    expect(target?.args).toContain("-1");
    expect(target?.args).toContain("1");
  });

  it("has no jiggle implementation off macOS/Linux", () => {
    expect(mouseJiggleSpawnTarget("win32")).toBeNull();
    expect(mouseJiggleSpawnTarget("freebsd")).toBeNull();
  });
});

describe("detectCaffeinateSupported", () => {
  // A throwaway PATH holding a fake `systemd-inhibit` so the Linux detection
  // branch resolves without a real systemd host.
  const makeInhibitDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caffeinate-platform-"));
    fs.writeFileSync(path.join(dir, SYSTEMD_INHIBIT_BINARY), "", { mode: 0o755 });
    return dir;
  };

  let dir: string;
  beforeEach(() => {
    dir = makeInhibitDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is always supported on macOS (caffeinate ships with the OS)", () => {
    expect(detectCaffeinateSupported("darwin", "any")).toBe(true);
  });

  it("is supported on Linux only when systemd-inhibit is on PATH", () => {
    expect(detectCaffeinateSupported("linux", dir)).toBe(true);
    expect(detectCaffeinateSupported("linux", "/nonexistent-void")).toBe(false);
  });

  it("is unsupported off macOS/Linux", () => {
    expect(detectCaffeinateSupported("win32", dir)).toBe(false);
  });
});
