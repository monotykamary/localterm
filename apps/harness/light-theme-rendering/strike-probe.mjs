#!/usr/bin/env node
// Regression probe for the WebGL atlas cache-key poisoning bug: the glyph atlas key only
// covered bold/italic, so whichever of plain/strikethrough (or overline/invisible) rasterized a
// character first poisoned every later occurrence of the other variant.
//
// The probe renders struck-then-plain and plain-then-struck pairs of the same word into one
// WebGL terminal, screenshots the page over CDP, and asserts pixel coverage of the mid-glyph
// band: struck spans must contain a full-width line, plain spans must not.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import pngjs from "pngjs";

const { PNG } = pngjs;

const harnessDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessDirectory, "..", "..", "..");
const terminalRequire = createRequire(join(repositoryRoot, "apps/terminal/package.json"));
const packageDirectory = (specifier) =>
  dirname(terminalRequire.resolve(`${specifier}/package.json`));

const CHROME_PATH =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP_PORT = Number.parseInt(process.env.PROBE_HTTP_PORT ?? "9571", 10);
const CDP_PORT = Number.parseInt(process.env.PROBE_CDP_PORT ?? "9563", 10);
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH ?? "/tmp/localterm-strike-cache-probe.png";
const READY_TIMEOUT_MS = 15_000;
const VIEWPORT_WIDTH = 900;
const VIEWPORT_HEIGHT = 420;
const FONT_SIZE_PX = 20;
const LINE_HEIGHT = 1.4;
const EXPECTED_BAND_COUNT = 3;
const INK_THRESHOLD = 100;
const STRIPE_HEIGHT_PX = 2;
const STRIKE_COVERAGE_THRESHOLD = 0.95;

// Row 0 poisons in the struck-then-plain direction, row 1 in the plain-then-struck direction,
// row 2 is an always-plain control. Word columns below assume exactly this content.
const PROBE_LINES = [
  "\u001b[9mPOISONED\u001b[29m POISONED",
  "STRUCKL8 \u001b[9mSTRUCKL8\u001b[29m",
  "CONTROL CONTROL",
];
const WORD_WINDOWS = [
  { row: 0, firstColumn: 0, label: "row0 struck POISONED", expectStrike: true },
  { row: 0, firstColumn: 9, label: "row0 plain POISONED after struck", expectStrike: false },
  { row: 1, firstColumn: 0, label: "row1 plain STRUCKL8 before struck", expectStrike: false },
  { row: 1, firstColumn: 9, label: "row1 struck STRUCKL8", expectStrike: true },
  { row: 2, firstColumn: 0, label: "row2 control CONTROL", expectStrike: false },
  { row: 2, firstColumn: 8, label: "row2 control CONTROL 2", expectStrike: false },
];
const WORD_LENGTH = 8;
const CONTROL_TWO_OFFSET_COLUMNS = 8;

const pageHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/xterm.css" />
    <style>
      body { margin: 0; background: #000; }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script type="module">
      import { Terminal } from "/xterm.mjs";
      import { WebglAddon } from "/addon-webgl.mjs";
      const measureContext = document.createElement("canvas").getContext("2d");
      measureContext.font = "${FONT_SIZE_PX}px monospace";
      const cellWidth = measureContext.measureText("M").width;
      const terminal = new Terminal({
        cols: 40,
        rows: ${EXPECTED_BAND_COUNT},
        fontSize: ${FONT_SIZE_PX},
        lineHeight: ${LINE_HEIGHT},
        fontFamily: "monospace",
        allowTransparency: false,
        theme: { background: "#000000", foreground: "#ffffff" },
      });
      terminal.open(document.getElementById("terminal"));
      terminal.loadAddon(new WebglAddon());
      terminal.write(${JSON.stringify(PROBE_LINES.join("\r\n"))}, () => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            document.title = JSON.stringify({ ready: true, cellWidth });
          }),
        );
      });
    <\/script>
  </body>
</html>
`;

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const getJson = async (pathname) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}${pathname}`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`Chrome CDP did not start on port ${CDP_PORT}`);
};

const connectWebSocket = (url) =>
  new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", () => rejectSocket(new Error("CDP WebSocket failed")));
  });

const createCdpClient = (socket) => {
  let nextId = 1;
  const pendingOperations = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    const pendingOperation = pendingOperations.get(message.id);
    if (!pendingOperation) return;
    pendingOperations.delete(message.id);
    if (message.error) pendingOperation.reject(new Error(message.error.message));
    else pendingOperation.resolve(message.result);
  });
  const send = (method, params) =>
    new Promise((resolveOperation, rejectOperation) => {
      const id = nextId++;
      pendingOperations.set(id, {
        resolve: resolveOperation,
        reject: rejectOperation,
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send };
};

const staticFiles = new Map([
  ["/xterm.css", join(packageDirectory("@xterm/xterm"), "css/xterm.css")],
  ["/xterm.mjs", join(packageDirectory("@xterm/xterm"), "lib/xterm.mjs")],
  ["/addon-webgl.mjs", join(packageDirectory("@xterm/addon-webgl"), "lib/addon-webgl.mjs")],
]);

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://127.0.0.1:${HTTP_PORT}`);
  if (pathname === "/") {
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(pageHtml);
    return;
  }
  const filePath = staticFiles.get(pathname);
  if (!filePath) {
    response.writeHead(404);
    response.end();
    return;
  }
  const contentType = pathname.endsWith(".css") ? "text/css" : "text/javascript";
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  response.end(await readFile(filePath));
});

const pixelInk = (image, x, y) => image.data[(y * image.width + x) * 4] > INK_THRESHOLD;

const analyzeScreenshot = (buffer, cellWidth) => {
  const image = PNG.sync.read(buffer);
  const inkRows = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!pixelInk(image, x, y)) continue;
      inkRows.push(y);
      break;
    }
  }
  const bands = [];
  for (const y of inkRows) {
    const lastBand = bands[bands.length - 1];
    if (lastBand && y <= lastBand.end + 1) lastBand.end = y;
    else bands.push({ start: y, end: y });
  }
  if (bands.length !== EXPECTED_BAND_COUNT)
    throw new Error(
      `expected ${EXPECTED_BAND_COUNT} text bands, found ${bands.length}: ${JSON.stringify(bands)}`,
    );
  let originX = 0;
  outer: for (let y = bands[0].start; y <= bands[0].end; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!pixelInk(image, x, y)) continue;
      originX = x;
      break outer;
    }
  }
  return WORD_WINDOWS.map(({ row, firstColumn, label, expectStrike }) => {
    const windowStart = Math.floor(originX + firstColumn * cellWidth);
    const windowEnd = Math.ceil(originX + (firstColumn + WORD_LENGTH) * cellWidth);
    let maxCoverage = 0;
    for (let y = bands[row].start; y + STRIPE_HEIGHT_PX <= bands[row].end; y++) {
      let coveredColumns = 0;
      for (let x = windowStart; x < windowEnd; x++) {
        let covered = false;
        for (let dy = 0; dy < STRIPE_HEIGHT_PX; dy++)
          covered ||= pixelInk(image, Math.min(x, image.width - 1), y + dy);
        if (covered) coveredColumns += 1;
      }
      maxCoverage = Math.max(maxCoverage, coveredColumns / (windowEnd - windowStart));
    }
    const pass = expectStrike
      ? maxCoverage >= STRIKE_COVERAGE_THRESHOLD
      : maxCoverage < STRIKE_COVERAGE_THRESHOLD;
    return { label, expectStrike, maxCoverage, pass };
  });
};

await new Promise((resolveListen) => server.listen(HTTP_PORT, resolveListen));
const chrome = spawn(
  CHROME_PATH,
  [
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    "--force-device-scale-factor=1",
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,DialMediaRouteProvider",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let exitCode = 1;
try {
  const targets = await getJson("/json/list");
  const target = targets.find((candidate) => candidate.type === "page");
  if (!target) throw new Error("Chrome page target was not found");
  const socket = await connectWebSocket(target.webSocketDebuggerUrl);
  const client = createCdpClient(socket);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/` });
  let cellWidth;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const evaluation = await client.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const title = evaluation.result?.value ?? "";
    if (title.startsWith("{")) {
      const status = JSON.parse(title);
      if (status.ready) {
        cellWidth = status.cellWidth;
        break;
      }
    }
    if (Date.now() > deadline) throw new Error("probe page never became ready");
    await sleep(100);
  }
  const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
  const screenshotBuffer = Buffer.from(screenshot.data, "base64");
  await writeFile(SCREENSHOT_PATH, screenshotBuffer);
  const results = analyzeScreenshot(screenshotBuffer, cellWidth);
  let allPassed = true;
  for (const { label, expectStrike, maxCoverage, pass } of results) {
    allPassed &&= pass;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${label}: max column coverage ${(maxCoverage * 100).toFixed(1)}% (${expectStrike ? "strike required" : "plain required"})`,
    );
  }
  exitCode = allPassed ? 0 : 1;
} finally {
  chrome.kill("SIGTERM");
  server.close();
}
process.exit(exitCode);
