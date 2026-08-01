import { describe, expect, it } from "vite-plus/test";
import { extractImageFromDataTransfer } from "../../src/utils/extract-image-from-data-transfer";

interface DataTransferFixtureOptions {
  itemFiles?: File[];
  fallbackFiles?: File[];
  hasItems?: boolean;
}

const createDataTransfer = ({
  itemFiles = [],
  fallbackFiles = itemFiles,
  hasItems = true,
}: DataTransferFixtureOptions): DataTransfer => {
  const items = itemFiles.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    items: hasItems ? items : undefined,
    files: fallbackFiles,
  } as unknown as DataTransfer;
};

describe("extractImageFromDataTransfer", () => {
  it("extracts an image whose drag item has no MIME type", () => {
    const file = new File(["png"], "Screenshot.PNG");
    const image = extractImageFromDataTransfer(createDataTransfer({ itemFiles: [file] }));

    expect(image?.name).toBe("Screenshot.PNG");
    expect(image?.blob.type).toBe("image/png");
  });

  it("falls back to dataTransfer.files when items are unavailable", () => {
    const file = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });
    const image = extractImageFromDataTransfer(
      createDataTransfer({ fallbackFiles: [file], hasItems: false }),
    );

    expect(image?.name).toBe("photo.jpg");
  });

  it("skips unsupported files and returns the first supported image", () => {
    const text = new File(["text"], "notes.txt", { type: "text/plain" });
    const imageFile = new File(["image"], "photo.webp", { type: "image/webp" });
    const image = extractImageFromDataTransfer(
      createDataTransfer({ itemFiles: [text, imageFile] }),
    );

    expect(image?.name).toBe("photo.webp");
  });

  it("returns null for URL-only and unsupported file transfers", () => {
    expect(extractImageFromDataTransfer(createDataTransfer({}))).toBeNull();
    const svg = new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" });
    expect(extractImageFromDataTransfer(createDataTransfer({ itemFiles: [svg] }))).toBeNull();
  });
});
