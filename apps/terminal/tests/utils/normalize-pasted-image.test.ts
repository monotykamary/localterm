import { describe, expect, it } from "vite-plus/test";
import { normalizePastedImage } from "../../src/utils/normalize-pasted-image";

describe("normalizePastedImage", () => {
  it("infers a missing MIME type from an allowlisted filename", async () => {
    const source = new Blob([new Uint8Array([1, 2, 3])]);
    const image = normalizePastedImage(source, "Screenshot.PNG");

    expect(image).not.toBeNull();
    if (!image) throw new Error("missing normalized image");
    expect(image.name).toBe("Screenshot.PNG");
    expect(image.blob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await image.blob.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("infers nonstandard and generic image MIME types", () => {
    expect(
      normalizePastedImage(new Blob(["x"], { type: "image/x-png" }), "image.png")?.blob.type,
    ).toBe("image/png");
    expect(
      normalizePastedImage(new Blob(["x"], { type: "application/octet-stream" }), "photo.heic")
        ?.blob.type,
    ).toBe("image/heic");
  });

  it("preserves an already supported MIME type without requiring an extension", () => {
    const source = new Blob(["x"], { type: "image/webp" });
    expect(normalizePastedImage(source, "image")).toEqual({ blob: source, name: "image" });
  });

  it("rejects explicit non-images, SVG, and unknown untyped files", () => {
    expect(normalizePastedImage(new Blob(["x"], { type: "text/plain" }), "spoofed.png")).toBeNull();
    expect(
      normalizePastedImage(new Blob(["<svg/>"], { type: "image/svg+xml" }), "spoofed.png"),
    ).toBeNull();
    expect(normalizePastedImage(new Blob(["x"]), "unknown.data")).toBeNull();
  });
});
