import { describe, expect, it } from "vite-plus/test";
import { DAEMON_PROCESS_TITLE } from "../../src/constants.js";
import { classifyPid } from "../../src/utils/verify-pid-is-localterm.js";

describe("classifyPid", () => {
  it("returns 'not-ours' for non-positive or non-integer pids regardless of comm", () => {
    expect(classifyPid(0, "node")).toBe("not-ours");
    expect(classifyPid(-1, "node")).toBe("not-ours");
    expect(classifyPid(Number.NaN, "node")).toBe("not-ours");
    expect(classifyPid(1.5, "node")).toBe("not-ours");
  });

  it("returns 'unknown' when the pid's comm cannot be read", () => {
    expect(classifyPid(12345, null)).toBe("unknown");
  });

  it("returns 'not-ours' for a live process whose comm is not the daemon title", () => {
    expect(classifyPid(process.pid, "node")).toBe("not-ours");
    expect(classifyPid(process.pid, "bash")).toBe("not-ours");
  });

  it("returns 'ours' for a live process whose comm matches the daemon title", () => {
    expect(classifyPid(process.pid, DAEMON_PROCESS_TITLE)).toBe("ours");
  });
});
