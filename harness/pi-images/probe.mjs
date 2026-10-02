import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { frames } from "./frames.mjs";

const terminalRequire = createRequire(new URL("../../apps/terminal/package.json", import.meta.url));
const addonDir = dirname(terminalRequire.resolve("@xterm/addon-image/package.json"));
const xtermDir = dirname(terminalRequire.resolve("@xterm/xterm/package.json"));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/frames") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          await frames(
            Number(url.searchParams.get("width")),
            Number(url.searchParams.get("height")),
          ),
        ),
      );
      return;
    }
    const routes = {
      "/xterm.mjs": join(xtermDir, "lib/xterm.mjs"),
      "/xterm.css": join(xtermDir, "css/xterm.css"),
      "/addon-image.mjs":
        process.env.LOCALTERM_IMAGE_ADDON ?? join(addonDir, "lib/addon-image.mjs"),
      "/page.mjs": new URL("./page.mjs", import.meta.url),
    };
    if (routes[url.pathname]) {
      res.setHeader("content-type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      res.end(await readFile(routes[url.pathname]));
    } else if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><link rel="stylesheet" href="/xterm.css"><div id="terminal"></div><script type="module" src="/page.mjs"></script>',
      );
    } else {
      res.writeHead(404).end();
    }
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), "localterm-pi-images-"));
const chrome = spawn(
  process.env.LOCALTERM_CHROME_BIN ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--no-sandbox",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const chromeClosed = new Promise((resolve) => chrome.once("close", resolve));
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chrome startup timeout")), 15000);
    chrome.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    chrome.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(stderr));
    });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      callback?.(message);
    } else events.get(`${message.sessionId}:${message.method}`)?.(message.params);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(requestId, (message) => {
        clearTimeout(timer);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      });
      ws.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", background: false });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  for (const deviceScaleFactor of [1, 2]) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 900, height: 700, deviceScaleFactor, mobile: false },
      sessionId,
    );
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Page load timeout")), 15000);
      events.set(`${sessionId}:Page.loadEventFired`, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    await send("Page.navigate", { url }, sessionId);
    await loaded;
    const result = await send(
      "Runtime.evaluate",
      { expression: "globalThis.run()", awaitPromise: true, returnByValue: true },
      sessionId,
    ).catch(async (error) => {
      console.error(
        await send(
          "Runtime.evaluate",
          { expression: "globalThis.phase", returnByValue: true },
          sessionId,
        ),
      );
      throw error;
    });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    const report = result.result.value;
    console.log(JSON.stringify(report, null, 2));
    assert(
      report.receipts.some((receipt) => receipt.reuse > 0),
      "Pi did not exercise cached image placement",
    );
    assert(
      report.receipts.some((receipt) => receipt.cropped),
      "Pi did not exercise image cropping",
    );
    for (const receipt of report.receipts) {
      assert(receipt.samples > 0, `${receipt.name}: no expected image pixels`);
      assert.equal(receipt.missing.length, 0, `${receipt.name}: missing image rows`);
    }
  }
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  const forceKill = setTimeout(() => chrome.kill("SIGKILL"), 3000);
  await chromeClosed;
  clearTimeout(forceKill);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
