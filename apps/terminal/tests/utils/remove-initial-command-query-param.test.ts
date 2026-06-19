import { afterEach, describe, expect, it } from "vite-plus/test";
import { removeInitialCommandQueryParam } from "../../src/utils/remove-initial-command-query-param";

describe("removeInitialCommandQueryParam", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("removes the cmd param and keeps the rest of the url", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp&cmd=pnpm%20install");
    removeInitialCommandQueryParam();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("cmd")).toBeNull();
    expect(url.searchParams.get("cwd")).toBe("/tmp");
  });

  it("leaves the url untouched when no cmd param exists", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    const before = window.location.href;
    removeInitialCommandQueryParam();
    expect(window.location.href).toBe(before);
  });
});
