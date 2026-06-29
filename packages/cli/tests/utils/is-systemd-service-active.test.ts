import { describe, expect, it, vi } from "vite-plus/test";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
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

const { isSystemdUserServiceActive } = await import("../../src/utils/is-systemd-service-active.js");

const resetMocks = (): void => {
  execFileMock.mockReset();
};

describe("isSystemdUserServiceActive", () => {
  it("returns true when systemctl reports the unit active", async () => {
    resetMocks();
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
    expect(await isSystemdUserServiceActive()).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "is-active", "--quiet", "localterm.service"],
      expect.anything(),
    );
  });

  it("returns false when systemctl is missing (ENOENT)", async () => {
    resetMocks();
    execFileMock.mockRejectedValue(
      Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }),
    );
    expect(await isSystemdUserServiceActive()).toBe(false);
  });

  it("returns false when the unit is inactive (non-zero exit)", async () => {
    resetMocks();
    execFileMock.mockRejectedValue(Object.assign(new Error("inactive"), { code: 3 }));
    expect(await isSystemdUserServiceActive()).toBe(false);
  });
});
