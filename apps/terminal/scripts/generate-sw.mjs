/**
 * Build-time script: injects the precache list and a content-hashed shell
 * version into scripts/sw-template.js, writing dist/sw.js. Run from
 * apps/terminal with `pnpm generate:sw` (also runs as the last `build` step).
 * A new build changes the hashed asset URLs and content, so the version
 * changes and the service worker reinstalls + purges stale caches.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHELL_VERSION_LENGTH = 12;
const FONT_EXTENSIONS = [".woff", ".woff2", ".ttf", ".otf"];
const ICON_EXTENSIONS = [".svg", ".png", ".ico"];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(moduleDir, "..", "dist");
const templatePath = path.resolve(moduleDir, "sw-template.js");
const outputPath = path.join(distDir, "sw.js");

const toUrl = (distPath) => {
  const relative = path.relative(distDir, distPath).split(path.sep).join("/");
  return relative === "index.html" ? "/" : `/${relative}`;
};

const extractShellUrls = () => {
  const html = readFileSync(path.join(distDir, "index.html"), "utf8");
  const urls = new Set();
  const attributePattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let match = attributePattern.exec(html);
  while (match !== null) {
    const value = match[1];
    // Skip data: URIs, cross-origin https:// preconnects/fonts, and relatives.
    if (value.startsWith("/")) urls.add(value);
    match = attributePattern.exec(html);
  }
  return urls;
};

const collectAssetUrlsByExtension = (extensions) => {
  const urls = new Set();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions.includes(path.extname(entry.name).toLowerCase())) {
        urls.add(toUrl(full));
      }
    }
  };
  walk(distDir);
  return urls;
};

const isPrecacheable = (url) => !url.endsWith(".map") && url !== "/sw.js";

const contentHashOf = (url) => {
  const distPath = url === "/" ? path.join(distDir, "index.html") : path.join(distDir, url);
  if (!existsSync(distPath)) return null;
  return createHash("sha1").update(readFileSync(distPath)).digest("hex");
};

const buildVersion = (urls) => {
  const hasher = createHash("sha1");
  for (const url of urls) {
    const hash = contentHashOf(url);
    if (hash) hasher.update(`${url}:${hash}\n`);
  }
  return hasher.digest("hex").slice(0, SHELL_VERSION_LENGTH);
};

const main = () => {
  if (!existsSync(distDir)) {
    throw new Error(`dist not found at ${distDir} — run "vp build" before generate-sw`);
  }
  if (!existsSync(templatePath)) {
    throw new Error(`service worker template not found at ${templatePath}`);
  }

  const shellUrls = extractShellUrls();
  const fontUrls = collectAssetUrlsByExtension(FONT_EXTENSIONS);
  const iconUrls = collectAssetUrlsByExtension(ICON_EXTENSIONS);
  const precacheUrls = ["/", ...shellUrls, ...fontUrls, ...iconUrls].filter(isPrecacheable);
  const sorted = [...new Set(precacheUrls)].sort();

  const version = buildVersion(sorted);
  const template = readFileSync(templatePath, "utf8");
  const urlsLiteral = JSON.stringify(JSON.stringify(sorted));
  const serviceWorker = template
    .replace(/"__SW_VERSION__"/g, JSON.stringify(version))
    .replace(/__PRECACHE_URLS_JSON__/g, urlsLiteral);

  writeFileSync(outputPath, serviceWorker);
  console.log(
    `generated ${path.relative(moduleDir, outputPath)} (v${version}, ${sorted.length} precache entries)`,
  );
};

main();
