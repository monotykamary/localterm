import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const execFileMock = vi.fn();
const isPortlessProxyLiveMock = vi.fn();

vi.mock("node:child_process", () => ({
  // promisify(execFile) calls execFile(...args, callback); adopt that shape so
  // the promisified wrapper resolves.
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: unknown, result: unknown) => void;
    try {
      const result = execFileMock(...args.slice(0, -1));
      if (result instanceof Promise) {
        result.then(
          (value) => callback(null, value),
          (error) => callback(error, undefined),
        );
      } else {
        callback(null, result);
      }
    } catch (error) {
      callback(error, undefined);
    }
  },
}));

vi.mock("../../src/utils/portless.js", async () => {
  const actual = await import("../../src/utils/portless.js");
  return { ...actual, isPortlessProxyLive: isPortlessProxyLiveMock };
});

const { setupPortlessProxy } = await import("../../src/commands/install.js");

const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });

const portlessCall = (subcommand: string): unknown =>
  execFileMock.mock.calls.find(
    ([binary, args]) => binary === "portless" && (args as string[])?.[0] === subcommand,
  );

const silenceConsole = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return vi.spyOn(console, "warn").mockImplementation(() => {});
};

const reset = () => {
  execFileMock.mockReset();
  isPortlessProxyLiveMock.mockReset();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setupPortlessProxy", () => {
  it("skips `portless service install` and only re-trusts when the proxy is already live", async () => {
    reset();
    isPortlessProxyLiveMock.mockResolvedValue(true);
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
    silenceConsole();

    await setupPortlessProxy();

    expect(isPortlessProxyLiveMock).toHaveBeenCalled();
    expect(portlessCall("service")).toBeUndefined();
    expect(portlessCall("trust")).toBeDefined();
  });

  it("installs the service when the proxy is down", async () => {
    reset();
    isPortlessProxyLiveMock.mockResolvedValue(false);
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
    silenceConsole();

    await setupPortlessProxy();

    expect(portlessCall("service")).toBeDefined();
    expect(portlessCall("trust")).toBeDefined();
  });

  it("silences a spurious `service install` failure when the proxy is live afterwards", async () => {
    reset();
    isPortlessProxyLiveMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    execFileMock.mockImplementation((_binary: string, args: string[]) =>
      args?.[0] === "service"
        ? Promise.reject(new Error("install: usage"))
        : Promise.resolve({ stdout: "", stderr: "" }),
    );
    const warnSpy = silenceConsole();

    await setupPortlessProxy();

    expect(portlessCall("service")).toBeDefined();
    expect(warnSpy.mock.calls.some((call) => /proxy not running/.test(String(call[0])))).toBe(
      false,
    );
  });

  it("warns when the proxy stays down after a failed install", async () => {
    reset();
    isPortlessProxyLiveMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    execFileMock.mockImplementation((_binary: string, args: string[]) =>
      args?.[0] === "service"
        ? Promise.reject(new Error("install: usage"))
        : Promise.resolve({ stdout: "", stderr: "" }),
    );
    const warnSpy = silenceConsole();

    await setupPortlessProxy();

    expect(warnSpy.mock.calls.some((call) => /proxy not running/.test(String(call[0])))).toBe(true);
  });

  it("bails before `trust` when portless is not installed", async () => {
    reset();
    isPortlessProxyLiveMock.mockResolvedValue(false);
    execFileMock.mockRejectedValue(enoent());
    silenceConsole();

    await setupPortlessProxy();

    expect(portlessCall("service")).toBeDefined();
    expect(portlessCall("trust")).toBeUndefined();
  });
});
