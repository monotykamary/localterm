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

// Inverse of the above for the paste/share upload path. A pasted or shared
// image arrives as a Blob with a declared content type; the upload route maps
// that to a file extension so it lands on disk as a real raster image. SVG is
// intentionally excluded — it is a text format (a script-injection vector when
// later served) and not what "paste an image" means on a phone (screenshots and
// photos are rasters). HEIC/HEIF are included because iOS shares photos in
// those containers even though the existing serve allowlist doesn't render
// them; the file is still a useful artifact for an agent to transcode.
const PASTE_IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const extensionForImageContentType = (contentType: string): string | null => {
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  if (!base) return null;
  return PASTE_IMAGE_EXTENSION_BY_MIME[base] ?? null;
};
