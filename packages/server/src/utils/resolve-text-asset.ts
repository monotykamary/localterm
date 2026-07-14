import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isContained } from "../static-resolver.js";
import { FILE_PREVIEW_BINARY_SAMPLE_BYTES, FILE_PREVIEW_MAX_BYTES } from "../constants.js";

export type TextAssetResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: "too_large" | "binary" };

// Reads a repo-relative text file for the agent-log preview. The containment
// check is defense-in-depth (the route already rejects absolute and ".."
// paths); the byte cap bounds the response; the NUL-byte sample (git's binary
// window) refuses binaries so the preview never renders mojibake for an image
// or compiled artifact. Returns null when the path escapes cwd, the file is
// missing, or it is a directory; otherwise a discriminated result the route
// maps to a precise status code for the preview's empty/error states.
export const resolveTextAsset = (cwd: string, requestedPath: string): TextAssetResult | null => {
  const absolutePath = path.resolve(cwd, requestedPath);
  if (!isContained(cwd, absolutePath)) return null;
  if (!existsSync(absolutePath)) return null;
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  if (stats.size > FILE_PREVIEW_MAX_BYTES) return { ok: false, reason: "too_large" };
  const body = readFileSync(absolutePath);
  const sample = body.subarray(0, Math.min(body.length, FILE_PREVIEW_BINARY_SAMPLE_BYTES));
  if (sample.includes(0)) return { ok: false, reason: "binary" };
  return { ok: true, content: body.toString("utf8") };
};
