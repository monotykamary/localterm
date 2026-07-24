import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reverseUnifiedPatch } from "./reverse-unified-patch.mjs";

const harnessDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessDirectory, "..", "..", "..");
const terminalRequire = createRequire(join(repositoryRoot, "apps/terminal/package.json"));
const packageDirectory = (specifier) =>
  dirname(terminalRequire.resolve(`${specifier}/package.json`));
const xtermDirectory = packageDirectory("@xterm/xterm");
const addonDirectory = packageDirectory("@xterm/addon-webgl");
const fontDirectory = join(packageDirectory("@fontsource/geist-mono"), "files");
const installedPatchedAddonPath = join(addonDirectory, "lib/addon-webgl.mjs");
const patchedAddonPath = process.env.PATCHED_ADDON_PATH
  ? resolve(process.env.PATCHED_ADDON_PATH)
  : installedPatchedAddonPath;
const patchPath = join(repositoryRoot, "patches/@xterm__addon-webgl@0.20.0-beta.290.patch");
const [installedPatchedAddonSource, patchSource] = await Promise.all([
  readFile(installedPatchedAddonPath, "utf8"),
  readFile(patchPath, "utf8"),
]);
const upstreamAddonSource = reverseUnifiedPatch(
  installedPatchedAddonSource,
  patchSource,
  "lib/addon-webgl.mjs",
);
const port = Number.parseInt(process.env.PORT ?? "4819", 10);

const routes = new Map([
  ["/", [join(harnessDirectory, "index.html"), "text/html"]],
  ["/harness/main.mjs", [join(harnessDirectory, "main.mjs"), "text/javascript"]],
  ["/xterm/css/xterm.css", [join(xtermDirectory, "css/xterm.css"), "text/css"]],
  ["/xterm/lib/xterm.mjs", [join(xtermDirectory, "lib/xterm.mjs"), "text/javascript"]],
  ["/addon/patched.mjs", [patchedAddonPath, "text/javascript"]],
  [
    "/themes.mjs",
    [join(repositoryRoot, "packages/server/dist/terminal-themes.js"), "text/javascript"],
  ],
  [
    "/fonts/geist-mono-latin-400-normal.woff2",
    [join(fontDirectory, "geist-mono-latin-400-normal.woff2"), "font/woff2"],
  ],
  [
    "/fonts/geist-mono-latin-700-normal.woff2",
    [join(fontDirectory, "geist-mono-latin-700-normal.woff2"), "font/woff2"],
  ],
]);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === "/addon/upstream.mjs") {
    response.writeHead(200, {
      "content-type": "text/javascript",
      "cache-control": "no-store",
    });
    response.end(upstreamAddonSource);
    return;
  }
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`not found: ${pathname}`);
    return;
  }
  try {
    const [absolutePath, contentType] = route;
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`light-theme rendering harness: http://127.0.0.1:${port}/`);
});
