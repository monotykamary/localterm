import { describe, expect, it } from "vite-plus/test";
import {
  extensionForImageContentType,
  imageContentTypeFor,
  pastedImageContentTypeForPath,
} from "../src/utils/image-extensions.js";

describe("image extensions", () => {
  it("maps supported pasted image paths to MIME types", () => {
    expect(pastedImageContentTypeForPath("Screenshot.PNG")).toBe("image/png");
    expect(pastedImageContentTypeForPath("photo.jpeg")).toBe("image/jpeg");
    expect(pastedImageContentTypeForPath("photo.HEIC")).toBe("image/heic");
  });

  it("keeps SVG and unknown paths out of pasted image uploads", () => {
    expect(pastedImageContentTypeForPath("icon.svg")).toBeNull();
    expect(pastedImageContentTypeForPath("notes.txt")).toBeNull();
    expect(pastedImageContentTypeForPath("image")).toBeNull();
  });

  it("normalizes supported upload MIME types to extensions", () => {
    expect(extensionForImageContentType("IMAGE/PNG")).toBe("png");
    expect(extensionForImageContentType("image/jpeg; charset=binary")).toBe("jpg");
    expect(extensionForImageContentType("image/svg+xml")).toBeNull();
  });

  it("retains SVG support for the guarded file preview route", () => {
    expect(imageContentTypeFor("icon.svg")).toBe("image/svg+xml");
  });
});
