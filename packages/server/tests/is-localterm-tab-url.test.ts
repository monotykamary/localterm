import { describe, expect, it } from "vite-plus/test";
import { isLocaltermTabUrl } from "../src/utils/is-localterm-tab-url.js";

describe("isLocaltermTabUrl", () => {
  describe("loopback surface (no publicUrl)", () => {
    it("matches the bound loopback origin", () => {
      expect(isLocaltermTabUrl("http://127.0.0.1:3417/?run=x", 3417, "127.0.0.1")).toBe(true);
    });

    it("matches the friendly hostname on the bound port", () => {
      expect(isLocaltermTabUrl("http://localterm.localhost:3417/?run=x", 3417, "127.0.0.1")).toBe(
        true,
      );
    });

    it("matches any loopback variant on the bound port", () => {
      expect(isLocaltermTabUrl("http://localhost:3417/", 3417, "127.0.0.1")).toBe(true);
      expect(isLocaltermTabUrl("http://[::1]:3417/", 3417, "127.0.0.1")).toBe(true);
    });

    it("rejects a different port", () => {
      expect(isLocaltermTabUrl("http://localterm.localhost:9999/", 3417, "127.0.0.1")).toBe(false);
    });

    it("rejects an off-origin host", () => {
      expect(isLocaltermTabUrl("http://evil.com:3417/", 3417, "127.0.0.1")).toBe(false);
    });

    it("rejects everything while the port is unresolved (0)", () => {
      expect(isLocaltermTabUrl("http://localterm.localhost:3417/", 0, "127.0.0.1")).toBe(false);
    });

    it("rejects a malformed URL", () => {
      expect(isLocaltermTabUrl("not a url", 3417, "127.0.0.1")).toBe(false);
    });
  });

  describe("announced publicUrl surface", () => {
    it("matches a portless tab (no port) against a portless publicUrl", () => {
      expect(
        isLocaltermTabUrl(
          "https://localterm.localhost/?run=x",
          3417,
          "127.0.0.1",
          "https://localterm.localhost",
        ),
      ).toBe(true);
    });

    it("normalises the https default port (:443) to the bare origin", () => {
      expect(
        isLocaltermTabUrl(
          "https://localterm.localhost:443/?run=x",
          3417,
          "127.0.0.1",
          "https://localterm.localhost",
        ),
      ).toBe(true);
    });

    it("matches a tailnet tab against a tailnet publicUrl", () => {
      expect(
        isLocaltermTabUrl(
          "https://myhost.ts.net/?run=x",
          3417,
          "127.0.0.1",
          "https://myhost.ts.net",
        ),
      ).toBe(true);
    });

    it("still matches the loopback form alongside a portless publicUrl", () => {
      expect(
        isLocaltermTabUrl(
          "http://localterm.localhost:3417/?run=x",
          3417,
          "127.0.0.1",
          "https://localterm.localhost",
        ),
      ).toBe(true);
    });

    it("rejects an unrelated origin even with a publicUrl set", () => {
      expect(
        isLocaltermTabUrl(
          "https://evil.com/?run=x",
          3417,
          "127.0.0.1",
          "https://localterm.localhost",
        ),
      ).toBe(false);
    });

    it("falls back to the loopback check when publicUrl is malformed", () => {
      expect(
        isLocaltermTabUrl(
          "http://localterm.localhost:3417/?run=x",
          3417,
          "127.0.0.1",
          "ht!tp://:::",
        ),
      ).toBe(true);
    });
  });
});
