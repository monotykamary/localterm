import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const harnessDir = join(repoRoot, "apps/harness/alpha-mask");

// Resolve through the terminal app's dep graph so pnpm's patched-package symlinks
// are followed; hardcoding .pnpm_hashes or the .pnpm_patches staging dir breaks
// whenever the addon patch changes.
const terminalRequire = createRequire(join(repoRoot, "apps/terminal/package.json"));
const packageDir = (specifier) => dirname(terminalRequire.resolve(`${specifier}/package.json`));

const xtermDir = packageDir("@xterm/xterm");
const addonDir = join(packageDir("@xterm/addon-webgl"), "lib");
const fontDir = join(packageDir("@fontsource/geist-mono"), "files");

const routes = [
  ["/xterm/css/xterm.css", join(xtermDir, "css/xterm.css"), "text/css"],
  ["/xterm/lib/xterm.mjs", join(xtermDir, "lib/xterm.mjs"), "text/javascript"],
  ["/addon/lib/addon-webgl.mjs", join(addonDir, "addon-webgl.mjs"), "text/javascript"],
  ["/fonts/geist-mono-latin-400-normal.woff2", join(fontDir, "geist-mono-latin-400-normal.woff2"), "font/woff2"],
  ["/fonts/geist-mono-latin-700-normal.woff2", join(fontDir, "geist-mono-latin-700-normal.woff2"), "font/woff2"],
  ["/harness/index.html", join(harnessDir, "index.html"), "text/html"],
  ["/harness/main.mjs", join(harnessDir, "main.mjs"), "text/javascript"],
  ["/", join(harnessDir, "index.html"), "text/html"],
];

const mimeForPath = (absolutePath) => {
  if (absolutePath.endsWith(".mjs")) return "text/javascript";
  if (absolutePath.endsWith(".css")) return "text/css";
  if (absolutePath.endsWith(".woff2")) return "font/woff2";
  if (absolutePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
};

const port = Number.parseInt(process.env.PORT ?? "4817", 10);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  let route = routes.find(([prefix]) => url.pathname === prefix);
  if (!route) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`not found: ${url.pathname}`);
    return;
  }
  const [, absolutePath, mime] = route;
  try {
    const buffer = await readFile(absolutePath);
    response.writeHead(200, { "content-type": mime ?? mimeForPath(absolutePath), "cache-control": "no-store" });
    response.end(buffer);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`alpha-mask harness: http://127.0.0.1:${port}/`);
});
