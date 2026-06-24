import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isContained } from "../static-resolver.js";
import { imageContentTypeFor } from "./image-extensions.js";

export interface ImageAsset {
  body: Buffer;
  contentType: string;
  isSvg: boolean;
}

// Reads a repo-relative image from the working tree for inline preview / open
// in a new tab. Gated to image content types so the route can never serve an
// arbitrary text/HTML file from the same origin (which would XSS the terminal
// app). `requestedPath` is already sanitized by the caller (no absolute, no
// `..`), and the containment check is a defense-in-depth invariant in case this
// is ever called without that guard.
export const resolveImageAsset = (cwd: string, requestedPath: string): ImageAsset | null => {
  const contentType = imageContentTypeFor(requestedPath);
  if (!contentType) return null;
  const absolutePath = path.resolve(cwd, requestedPath);
  if (!isContained(cwd, absolutePath)) return null;
  if (!existsSync(absolutePath)) return null;
  try {
    if (!statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return {
    body: readFileSync(absolutePath),
    contentType,
    isSvg: contentType === "image/svg+xml",
  };
};
