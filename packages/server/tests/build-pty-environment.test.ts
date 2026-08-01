import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { buildPtyEnvironment } from "../src/build-pty-environment.js";
import {
  DEFAULT_MACOS_PTY_LOCALE,
  DEFAULT_TERMINAL_BROWSER_DISPLAY_SCALE,
  DEFAULT_TERMINAL_BROWSER_FRAME_BUDGET_MBPS,
  LOCALTERM_STATE_DIRNAME,
  ZSH_HOOK_DIRNAME,
} from "../src/constants.js";

interface BuildTestEnvironmentOptions {
  inheritedEnvironment?: NodeJS.ProcessEnv;
  inputEnvironment?: Record<string, string>;
  platform?: NodeJS.Platform;
}

const buildTestEnvironment = ({
  inheritedEnvironment = {},
  inputEnvironment,
  platform = "darwin",
}: BuildTestEnvironmentOptions): Record<string, string> =>
  buildPtyEnvironment({
    inheritedEnvironment,
    input: inputEnvironment ? { env: inputEnvironment } : {},
    platform,
    sessionId: "test-session",
  });

describe("buildPtyEnvironment", () => {
  it("defaults macOS PTYs to UTF-8 when launchd provides no locale", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { HOME: "/Users/tester" },
    });

    expect(environment.LANG).toBe(DEFAULT_MACOS_PTY_LOCALE);
  });

  it("forces terminal-browser into the kitty file frame transport", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { HOME: "/Users/tester" },
    });

    expect(environment.TERMINAL_BROWSER_FRAMES).toBe("file");
  });

  it("treats empty locale variables as unconfigured", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { LANG: "", LC_ALL: "", LC_CTYPE: "" },
    });

    expect(environment.LANG).toBe(DEFAULT_MACOS_PTY_LOCALE);
  });

  it.each([
    { name: "LANG", value: "en_VN.UTF-8" },
    { name: "LC_CTYPE", value: "UTF-8" },
    { name: "LC_ALL", value: "C" },
  ])("preserves an explicit $name locale", ({ name, value }) => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { [name]: value },
    });

    expect(environment[name]).toBe(value);
    expect(environment.LANG).toBe(name === "LANG" ? value : undefined);
  });

  it("honors a locale supplied for an individual PTY", () => {
    const environment = buildTestEnvironment({
      inputEnvironment: { LANG: "vi_VN.UTF-8" },
    });

    expect(environment.LANG).toBe("vi_VN.UTF-8");
  });

  it("does not assume C.UTF-8 exists outside macOS", () => {
    const environment = buildTestEnvironment({ platform: "linux" });

    expect(environment.LANG).toBeUndefined();
  });

  it("configures terminal-browser for LocalTerm's pixel and throughput model", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: {
        TERMINAL_BROWSER_DISPLAY_SCALE: "",
        TERMINAL_BROWSER_FRAME_BUDGET_MBPS: "",
      },
    });

    expect(environment.TERMINAL_BROWSER_DISPLAY_SCALE).toBe(
      String(DEFAULT_TERMINAL_BROWSER_DISPLAY_SCALE),
    );
    expect(environment.TERMINAL_BROWSER_FRAME_BUDGET_MBPS).toBe(
      String(DEFAULT_TERMINAL_BROWSER_FRAME_BUDGET_MBPS),
    );
  });

  it("preserves explicit terminal-browser rendering overrides", () => {
    const displayScale = "1.5";
    const frameBudgetMbps = "4";
    const environment = buildTestEnvironment({
      inputEnvironment: {
        TERMINAL_BROWSER_DISPLAY_SCALE: displayScale,
        TERMINAL_BROWSER_FRAME_BUDGET_MBPS: frameBudgetMbps,
      },
    });

    expect(environment.TERMINAL_BROWSER_DISPLAY_SCALE).toBe(displayScale);
    expect(environment.TERMINAL_BROWSER_FRAME_BUDGET_MBPS).toBe(frameBudgetMbps);
  });
});

describe("stale localterm hook dirs in inherited ZDOTDIR", () => {
  const localtermZshHookDir = path.join(os.homedir(), LOCALTERM_STATE_DIRNAME, ZSH_HOOK_DIRNAME);

  it("recovers the user's real zdotdir over an inherited stable-hook ZDOTDIR", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: {
        ZDOTDIR: localtermZshHookDir,
        __LOCALTERM_ORIG_ZDOTDIR: "/real/zdot",
      },
    });

    expect(environment.__LOCALTERM_ORIG_ZDOTDIR).toBe("/real/zdot");
    expect(environment.ZDOTDIR).toBeUndefined();
  });

  it("drops an inherited stable-hook ZDOTDIR when no original is recorded", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { ZDOTDIR: localtermZshHookDir },
    });

    expect(environment.__LOCALTERM_ORIG_ZDOTDIR).toBeUndefined();
    expect(environment.ZDOTDIR).toBeUndefined();
  });

  it("still recognizes legacy per-session temp hook dirs", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: {
        ZDOTDIR: "/var/folders/xx/T/localterm-zdot-123-456",
        __LOCALTERM_ORIG_ZDOTDIR: "/real/zdot",
      },
    });

    expect(environment.__LOCALTERM_ORIG_ZDOTDIR).toBe("/real/zdot");
  });

  it("passes a legitimate user ZDOTDIR through as the original", () => {
    const environment = buildTestEnvironment({
      inheritedEnvironment: { ZDOTDIR: "/custom/dots" },
    });

    expect(environment.__LOCALTERM_ORIG_ZDOTDIR).toBe("/custom/dots");
  });
});
