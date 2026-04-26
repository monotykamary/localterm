import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

export interface StaticAsset {
  body: Buffer;
  contentType: string;
  status: number;
}

const isContained = (root: string, resolved: string): boolean => {
  const relative = path.relative(root, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const readFile = (target: string): StaticAsset | null => {
  if (!existsSync(target)) return null;
  if (!statSync(target).isFile()) return null;
  const ext = path.extname(target).toLowerCase();
  return {
    body: readFileSync(target),
    contentType: MIME[ext] ?? "application/octet-stream",
    status: 200,
  };
};

export const resolveStaticAsset = (root: string, urlPath: string): StaticAsset | null => {
  const normalizedRoot = path.resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?", 1)[0] ?? "/");
  } catch {
    return null;
  }
  const trimmed = decoded.replace(/^[/\\]+/, "");
  const resolvedExact = path.resolve(normalizedRoot, trimmed);
  if (isContained(normalizedRoot, resolvedExact)) {
    const direct = readFile(resolvedExact);
    if (direct) return direct;
    const indexed = readFile(path.join(resolvedExact, "index.html"));
    if (indexed) return indexed;
  }
  const hasFileExtension = /\.[a-z0-9]+$/i.test(trimmed);
  if (hasFileExtension) return null;
  const fallback = readFile(path.join(normalizedRoot, "index.html"));
  if (!fallback) return null;
  return { ...fallback, status: 200 };
};
