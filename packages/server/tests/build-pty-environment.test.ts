import { describe, expect, it } from "vite-plus/test";
import { buildPtyEnvironment } from "../src/build-pty-environment.js";
import { DEFAULT_MACOS_PTY_LOCALE } from "../src/constants.js";

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
});
