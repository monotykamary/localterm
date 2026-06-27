import { describe, expect, it } from "vite-plus/test";
import { extractSessionIdFromQr } from "../../src/utils/extract-session-id-from-qr";

describe("extractSessionIdFromQr", () => {
  it("reads the sid from a full share url", () => {
    expect(extractSessionIdFromQr("https://localterm.localhost/?sid=abc123")).toBe("abc123");
  });

  it("reads only the sid when other query params are present", () => {
    expect(extractSessionIdFromQr("http://localhost/?cwd=%2Ftmp&sid=abc")).toBe("abc");
  });

  it("decodes an url-encoded sid from the query string", () => {
    expect(extractSessionIdFromQr("https://x/?sid=2024-06-01T10%3A00")).toBe("2024-06-01T10:00");
  });

  it("reads the sid from a bare sid= fragment", () => {
    expect(extractSessionIdFromQr("sid=abc123")).toBe("abc123");
  });

  it("reads a sid that appears in free text after a separator", () => {
    expect(extractSessionIdFromQr("session sid=abc done")).toBe("abc");
  });

  it("returns null when there is no sid", () => {
    expect(extractSessionIdFromQr("https://x/?foo=bar")).toBeNull();
  });

  it("returns null for empty or non-sid text", () => {
    expect(extractSessionIdFromQr("")).toBeNull();
    expect(extractSessionIdFromQr("not a url at all")).toBeNull();
  });

  it("does not match a sid embedded in another param name", () => {
    expect(extractSessionIdFromQr("mysid=abc")).toBeNull();
  });
});
