interface PastedImageFormat {
  contentType: string;
  outputExtension: string;
  pathExtensions: readonly string[];
}

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
  const extension = filePath.slice(dotIndex + 1).toLowerCase();
  return extension in IMAGE_MIME_BY_EXTENSION ? extension : null;
};

export const isImagePath = (filePath: string): boolean => imageExtensionOf(filePath) !== null;

export const imageContentTypeFor = (filePath: string): string | null => {
  const extension = imageExtensionOf(filePath);
  return extension ? (IMAGE_MIME_BY_EXTENSION[extension] ?? null) : null;
};

// Inverse of the above for the paste/share upload path. A pasted or shared
// image arrives as a Blob whose declared content type can be absent or generic;
// the upload route maps a normalized MIME type to a file extension so it lands
// on disk as a real raster image. SVG is intentionally excluded — it is a text
// format and script-injection vector. HEIC/HEIF remain useful artifacts for an
// agent to transcode even though the existing serve allowlist cannot render them.
const PASTED_IMAGE_FORMATS: readonly PastedImageFormat[] = [
  { contentType: "image/png", outputExtension: "png", pathExtensions: ["png"] },
  {
    contentType: "image/jpeg",
    outputExtension: "jpg",
    pathExtensions: ["jpg", "jpeg"],
  },
  { contentType: "image/gif", outputExtension: "gif", pathExtensions: ["gif"] },
  { contentType: "image/webp", outputExtension: "webp", pathExtensions: ["webp"] },
  { contentType: "image/avif", outputExtension: "avif", pathExtensions: ["avif"] },
  { contentType: "image/bmp", outputExtension: "bmp", pathExtensions: ["bmp"] },
  { contentType: "image/heic", outputExtension: "heic", pathExtensions: ["heic"] },
  { contentType: "image/heif", outputExtension: "heif", pathExtensions: ["heif"] },
];

export const pastedImageContentTypeForPath = (filePath: string): string | null => {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const extension = filePath.slice(dotIndex + 1).toLowerCase();
  return (
    PASTED_IMAGE_FORMATS.find((format) => format.pathExtensions.includes(extension))?.contentType ??
    null
  );
};

export const extensionForImageContentType = (contentType: string): string | null => {
  const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase();
  if (!normalizedContentType) return null;
  return (
    PASTED_IMAGE_FORMATS.find((format) => format.contentType === normalizedContentType)
      ?.outputExtension ?? null
  );
};
