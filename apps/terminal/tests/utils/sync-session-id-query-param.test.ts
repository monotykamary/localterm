import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  SESSION_ID_QUERY_PARAM,
  syncSessionIdQueryParam,
} from "../../src/utils/sync-session-id-query-param";

const TEST_SID = "550e8400-e29b-41d4-a716-446655440000";

describe("syncSessionIdQueryParam", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("writes the sid param and preserves the rest of the url", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    syncSessionIdQueryParam(TEST_SID);
    const url = new URL(window.location.href);
    expect(url.searchParams.get(SESSION_ID_QUERY_PARAM)).toBe(TEST_SID);
    expect(url.searchParams.get("cwd")).toBe("/tmp");
  });

  it("removes the sid param when cleared and preserves the rest of the url", () => {
    window.history.replaceState(null, "", `/?cwd=%2Ftmp&sid=${TEST_SID}`);
    syncSessionIdQueryParam(null);
    const url = new URL(window.location.href);
    expect(url.searchParams.get(SESSION_ID_QUERY_PARAM)).toBeNull();
    expect(url.searchParams.get("cwd")).toBe("/tmp");
  });

  it("leaves the url untouched when setting the sid it already has", () => {
    window.history.replaceState(null, "", `/?sid=${TEST_SID}`);
    const before = window.location.href;
    syncSessionIdQueryParam(TEST_SID);
    expect(window.location.href).toBe(before);
  });

  it("leaves the url untouched when clearing an absent sid", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    const before = window.location.href;
    syncSessionIdQueryParam(null);
    expect(window.location.href).toBe(before);
  });
});
