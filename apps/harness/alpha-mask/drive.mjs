#!/usr/bin/env node
// Drives the alpha-mask harness in headless Chrome over CDP, runs the trigger
// matrix via the page's autoScan(), and prints the ink-ratio verdict. Acts as
// a deterministic reproducer for the intermittent boldening so fixes can be
// checked on this side without a manual reload.
import http from "node:http";
import { spawn } from "node:child_process";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number.parseInt(process.env.CDP_PORT ?? "9555", 10);
const HARNESS_URL = process.env.HARNESS_URL ?? "http://127.0.0.1:4817/";
const HEADLESS = process.env.HEADLESS !== "0";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const httpGet = async (pathName) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const request = http.get(`http://127.0.0.1:${PORT}${pathName}`, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve({ status: response.statusCode, body }));
        });
        request.on("error", reject);
        request.setTimeout(4000, () => request.destroy(new Error("timeout")));
      });
      if (result.status === 200) return result;
    } catch {}
    await sleep(200);
  }
  throw new Error(`CDP never came up on ${PORT}`);
};

const launchChrome = () =>
  new Promise((resolve, reject) => {
    const args = [
      `--remote-debugging-port=${PORT}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,DialMediaRouteProvider",
      "--use-fake-ui-for-media-stream",
      ...(HEADLESS ? ["--headless=new", "--hide-scrollbars"] : []),
      "about:blank",
    ];
    const child = spawn(CHROME, args, { stdio: "ignore" });
    child.on("error", reject);
    resolve(child);
  });

const wsForTarget = async () => {
  const listing = await httpGet("/json/list");
  const targets = JSON.parse(listing.body);
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page target found");
  return page.webSocketDebuggerUrl;
};

const connectWebSocket = async (url) => {
  const Socket = globalThis.WebSocket;
  if (!Socket) throw new Error("no global WebSocket available");
  return new Promise((resolve, reject) => {
    const socket = new Socket(url);
    socket.binaryType = "nodebuffer";
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => reject(new Error("ws error")));
  });
};

const makeCdpClient = (socket) => {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePending, reject: rejectPending } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rejectPending(new Error(message.error.message));
      else resolvePending(message.result);
    } else if (message.method) {
      const handlers = listeners.get(message.method);
      if (handlers) for (const handler of handlers) handler(message.params);
    }
  });
  const send = (method, params = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, handler) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
  };
  return { send, on };
};

const run = async () => {
  const chrome = await launchChrome();
  let socket;
  try {
    const version = JSON.parse((await httpGet("/json/version")).body);
    console.log(`connected: ${version.Browser ?? "?"}`);
    const targetUrl = await wsForTarget();
    socket = await connectWebSocket(targetUrl);
    const cdp = makeCdpClient(socket);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: HARNESS_URL });
    await sleep(1500);

    const expression = `
      (async () => {
        const logEl = document.getElementById('log');
        const done = new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (logEl.textContent.includes('AUTOSCAN DONE')) resolve();
          });
          observer.observe(logEl, { childList: true, characterData: true, subtree: true });
          setTimeout(() => resolve(), 90000);
        });
        document.getElementById('autoscan').click();
        await done;
        const entries = [...logEl.querySelectorAll('span')].map((span) => span.textContent);
        return { log: entries.join('\\n'), report: window.__scanReport ?? [] };
      })()
    `;
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result?.result?.value ?? {};
    console.log("\n===== HARNESS LOG =====");
    console.log(value.log ?? "(no log)");
    console.log("\n===== SCAN REPORT =====");
    for (const entry of value.report ?? []) console.log(JSON.stringify(entry));
    const boldTabs = (value.log ?? "").match(/\bBOLD\b/g)?.length ?? 0;
    console.log(
      `\nVERDICT: ${boldTabs > 0 ? "BOLDENING REPRODUCED" : "no boldening detected"} (${boldTabs} bold tab-measurements)`,
    );
  } catch (error) {
    console.error("driver error:", error.message ?? error);
    process.exitCode = 2;
  } finally {
    try {
      socket?.close?.();
    } catch {}
    chrome.kill("SIGTERM");
  }
};

run();
