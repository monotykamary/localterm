import { describe, expect, it } from "vite-plus/test";
import { buildSessionShareUrl } from "../../src/utils/build-session-share-url";
import { SESSION_ID_QUERY_PARAM } from "../../src/utils/sync-session-id-query-param";

describe("buildSessionShareUrl", () => {
  it("builds a url on the current origin carrying only the sid", () => {
    const sid = "550e8400-e29b-41d4-a716-446655440000";
    const url = new URL(buildSessionShareUrl(sid));
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get(SESSION_ID_QUERY_PARAM)).toBe(sid);
  });

  it("drops cwd/run params so the target attaches to the shared session only", () => {
    window.history.replaceState(null, "", "/?cwd=%2Ftmp&run=42");
    const url = new URL(buildSessionShareUrl("abc"));
    expect(Array.from(url.searchParams.keys())).toEqual([SESSION_ID_QUERY_PARAM]);
    window.history.replaceState(null, "", "/");
  });
});
