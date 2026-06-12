import { describe, expect, it } from "vite-plus/test";
import { formatRelativeTime } from "../../src/utils/format-relative-time";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

describe("formatRelativeTime", () => {
  it("formats future timestamps", () => {
    expect(formatRelativeTime(30_000, 0)).toBe("in <1m");
    expect(formatRelativeTime(5 * MS_PER_MINUTE, 0)).toBe("in 5m");
    expect(formatRelativeTime(3 * MS_PER_HOUR, 0)).toBe("in 3h");
    expect(formatRelativeTime(2 * MS_PER_DAY, 0)).toBe("in 2d");
  });

  it("formats past timestamps", () => {
    expect(formatRelativeTime(-30_000, 0)).toBe("<1m ago");
    expect(formatRelativeTime(0, 5 * MS_PER_MINUTE)).toBe("5m ago");
    expect(formatRelativeTime(0, 3 * MS_PER_HOUR)).toBe("3h ago");
    expect(formatRelativeTime(0, 2 * MS_PER_DAY)).toBe("2d ago");
  });

  it("treats the exact moment as a future <1m", () => {
    expect(formatRelativeTime(0, 0)).toBe("in <1m");
  });

  it("floors partial units", () => {
    expect(formatRelativeTime(MS_PER_HOUR + 59 * MS_PER_MINUTE, 0)).toBe("in 1h");
  });
});
