// Image classification shared by the server's file-serving route and the
// client's diff viewer (re-exported via protocol). Extension-based, matching
// the route's allowlist — the route refuses to serve anything not recognized
// here, so a non-image file with a spoofed request never reaches the disk.
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const imageExtensionOf = (filePath: string): string | null => {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const ext = filePath.slice(dotIndex + 1).toLowerCase();
  return ext in IMAGE_MIME_BY_EXTENSION ? ext : null;
};

export const isImagePath = (filePath: string): boolean => imageExtensionOf(filePath) !== null;

export const imageContentTypeFor = (filePath: string): string | null => {
  const ext = imageExtensionOf(filePath);
  return ext ? (IMAGE_MIME_BY_EXTENSION[ext] ?? null) : null;
};
