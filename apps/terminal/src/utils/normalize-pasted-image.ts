import {
  extensionForImageContentType,
  pastedImageContentTypeForPath,
} from "@monotykamary/localterm-server/protocol";

export interface NormalizedPastedImage {
  blob: Blob;
  name: string;
}

const GENERIC_BINARY_CONTENT_TYPE = "application/octet-stream";
const SVG_CONTENT_TYPE = "image/svg+xml";

export const normalizePastedImage = (
  blob: Blob,
  filename: string,
): NormalizedPastedImage | null => {
  const name = filename.trim() || "image";
  const declaredContentType = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (extensionForImageContentType(declaredContentType)) return { blob, name };
  if (declaredContentType === SVG_CONTENT_TYPE) return null;

  const inferredContentType = pastedImageContentTypeForPath(name);
  if (!inferredContentType) return null;
  if (
    declaredContentType &&
    declaredContentType !== GENERIC_BINARY_CONTENT_TYPE &&
    !declaredContentType.startsWith("image/")
  ) {
    return null;
  }
  return { blob: blob.slice(0, blob.size, inferredContentType), name };
};
