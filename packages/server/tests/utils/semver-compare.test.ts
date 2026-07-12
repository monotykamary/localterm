import { describe, expect, it } from "vite-plus/test";
import { compareSemver } from "../../src/utils/semver-compare.js";

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.2", "1.0.1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("strips a leading v from either operand", () => {
    expect(compareSemver("v2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("v1.0.0", "v1.0.0")).toBe(0);
  });

  it("ignores pre-release / build metadata when comparing the core triple", () => {
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBe(0);
    expect(compareSemver("2.0.0+build.1", "2.0.0")).toBe(0);
  });

  it("returns 0 (treated as not newer) when either version is unparseable", () => {
    expect(compareSemver("not-a-version", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "")).toBe(0);
    expect(compareSemver("latest", "1.2.3")).toBe(0);
  });
});
