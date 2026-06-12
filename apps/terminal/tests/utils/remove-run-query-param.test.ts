import { afterEach, describe, expect, it } from "vite-plus/test";
import { removeRunQueryParam } from "../../src/utils/remove-run-query-param";

describe("removeRunQueryParam", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("removes the run param and keeps the rest of the url", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp&run=abc-123");
    removeRunQueryParam();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("run")).toBeNull();
    expect(url.searchParams.get("cwd")).toBe("/tmp");
  });

  it("leaves the url untouched when no run param exists", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    const before = window.location.href;
    removeRunQueryParam();
    expect(window.location.href).toBe(before);
  });
});
