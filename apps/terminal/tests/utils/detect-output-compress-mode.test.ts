import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { detectOutputCompressMode } from "../../src/utils/detect-output-compress-mode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectOutputCompressMode", () => {
  it.each(["localhost", "localterm.localhost", "dev.localhost", "127.0.0.1", "[::1]", "::1"])(
    "keeps the loopback surface raw for %s",
    (hostname) => {
      let constructionCount = 0;
      class FakeDecompressionStream {
        constructor() {
          constructionCount += 1;
        }
      }
      vi.stubGlobal("DecompressionStream", FakeDecompressionStream);

      expect(detectOutputCompressMode(hostname)).toBeNull();
      expect(constructionCount).toBe(0);
    },
  );

  it("prefers persistent Brotli on remote surfaces", () => {
    const constructedFormats: string[] = [];
    class FakeDecompressionStream {
      constructor(format: string) {
        constructedFormats.push(format);
      }
    }
    vi.stubGlobal("DecompressionStream", FakeDecompressionStream);

    expect(detectOutputCompressMode("terminal.example.com")).toBe("br-ctx");
    expect(constructedFormats).toEqual(["br"]);
  });

  it("falls back to gzip when Brotli is unavailable", () => {
    class FakeDecompressionStream {
      constructor(format: string) {
        if (format === "br") throw new Error("unsupported");
      }
    }
    vi.stubGlobal("DecompressionStream", FakeDecompressionStream);

    expect(detectOutputCompressMode("terminal.example.com")).toBe("gzip");
  });

  it("keeps remote output raw when no decompressor is available", () => {
    class FakeDecompressionStream {
      constructor() {
        throw new Error("unsupported");
      }
    }
    vi.stubGlobal("DecompressionStream", FakeDecompressionStream);

    expect(detectOutputCompressMode("terminal.example.com")).toBeNull();
  });
});
