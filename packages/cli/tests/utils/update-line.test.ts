import { describe, expect, it } from "vite-plus/test";
import type { UpdateStatus } from "@monotykamary/localterm-server";
import { formatUpdateLine } from "../../src/utils/print-update-line.js";
import { resolveApiHost } from "../../src/utils/read-update-status.js";

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "1.0.0",
  latest: null,
  updateAvailable: false,
  checkedAt: null,
  ...overrides,
});

describe("formatUpdateLine", () => {
  it("formats a line naming the latest version when an update is available", () => {
    const line = formatUpdateLine(
      status({ latest: "1.2.0", updateAvailable: true, checkedAt: 123 }),
    );
    expect(line).toContain("1.2.0");
    expect(line).toContain("localterm update");
  });

  it("returns null when no update is available", () => {
    expect(formatUpdateLine(status({ latest: "1.0.0", updateAvailable: false }))).toBeNull();
  });

  it("returns null when the fetch failed (a missing line is always safe)", () => {
    expect(formatUpdateLine(null)).toBeNull();
  });

  it("returns null when an update is flagged but the latest version is missing", () => {
    expect(formatUpdateLine(status({ latest: null, updateAvailable: false }))).toBeNull();
  });
});

describe("resolveApiHost", () => {
  it("passes a concrete host through", () => {
    expect(resolveApiHost("127.0.0.1")).toBe("127.0.0.1");
    expect(resolveApiHost("0.0.0.0")).toBe("127.0.0.1");
  });

  it("normalizes wildcard + empty binds to loopback for self-HTTP", () => {
    expect(resolveApiHost("::")).toBe("127.0.0.1");
    expect(resolveApiHost("")).toBe("127.0.0.1");
  });
});
