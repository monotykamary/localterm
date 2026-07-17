#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cdpPort = Number.parseInt(process.env.CDP_PORT ?? "9562", 10);
const harnessUrl = new URL(process.env.HARNESS_URL ?? "http://127.0.0.1:4819/");
const requestedThemeId = process.env.THEME;
if (requestedThemeId) harnessUrl.searchParams.set("theme", requestedThemeId);
const requestedContrastFloor = process.env.CONTRAST_FLOOR;
if (requestedContrastFloor) harnessUrl.searchParams.set("contrast", requestedContrastFloor);
const devicePixelRatio = Number.parseFloat(process.env.DPR ?? "2");
const screenshotPath = process.env.SCREENSHOT_PATH ?? "/tmp/localterm-light-theme-rendering.png";
const isHeadless = process.env.HEADLESS !== "0";
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const getJson = async (pathname) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}${pathname}`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`Chrome CDP did not start on port ${cdpPort}`);
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

const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--force-device-scale-factor=${devicePixelRatio}`,
    "--window-size=1800,1200",
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,DialMediaRouteProvider",
    "about:blank",
  ].filter((argument) => isHeadless || argument !== "--headless=new"),
  { stdio: "ignore" },
);

let socket;
try {
  const targets = await getJson("/json/list");
  const target = targets.find((candidate) => candidate.type === "page");
  if (!target) throw new Error("Chrome page target was not found");
  socket = await connectWebSocket(target.webSocketDebuggerUrl);
  const client = createCdpClient(socket);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Page.navigate", { url: harnessUrl.href });
  const evaluation = await client.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        const startedAt = performance.now();
        const check = () => {
          if (window.__diagnosticReady) {
            resolve({ report: window.__diagnosticReport, status: document.getElementById('status')?.textContent });
            return;
          }
          if (window.__diagnosticError || performance.now() - startedAt > 90000) {
            resolve({ error: window.__diagnosticError ?? 'diagnostic timed out', status: document.getElementById('status')?.textContent });
            return;
          }
          setTimeout(check, 100);
        };
        check();
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = evaluation.result.value;
  if (value.error) throw new Error(`${value.error} (${value.status ?? "no status"})`);
  await sleep(300);
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(`${value.status}\n`);
  for (const measurement of value.report.measurements) {
    console.log(
      `${measurement.name}: ink ${measurement.mask.inkDeltaPercent >= 0 ? "+" : ""}${measurement.mask.inkDeltaPercent.toFixed(1)}% | low contrast ${measurement.colorsBelowFourPointFive}/17 | 4.5-floor changed pixels patched=${measurement.patchedContrastAdjustment.changedPixels}, upstream=${measurement.upstreamContrastAdjustment.changedPixels} | live-switch differences=${measurement.liveThemeSwitch.changedPixels}`,
    );
  }
  console.log(`\nScreenshot: ${screenshotPath}`);
  console.log(`\n${JSON.stringify(value.report, null, 2)}`);
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
}
