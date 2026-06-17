#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CDP_WS = process.env.CDP_WS || "ws://127.0.0.1:9222/devtools/browser/";
const STATIC_PORT = Number(process.env.STATIC_PORT) || 8765;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 8766;
const HEARTBEAT_MS = 30000;

const PYTHON_PIXEL_METRICS_SCRIPT = `
from io import BytesIO
import sys, base64, json, math
from PIL import Image
buf = sys.stdin.read().strip()
img = Image.open(BytesIO(base64.b64decode(buf))).convert("RGB")
w, h = img.size
n = w * h
data = list(img.getdata())
mr = sum(p[0] for p in data) / n
mg = sum(p[1] for p in data) / n
mb = sum(p[2] for p in data) / n
sr = math.sqrt(sum((p[0] - mr) ** 2 for p in data) / n)
sg = math.sqrt(sum((p[1] - mg) ** 2 for p in data) / n)
sb = math.sqrt(sum((p[2] - mb) ** 2 for p in data) / n)
unique = len(set(((p[0] >> 3, p[1] >> 3, p[2] >> 3) for p in data)))
px = img.load()
diff = 0
for y in range(h):
    for x in range(w):
        r1, g1, b1 = px[x, y]
        if x + 1 < w:
            r2, g2, b2 = px[x + 1, y]
            diff += abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
        if y + 1 < h:
            r2, g2, b2 = px[x, y + 1]
            diff += abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
edge = diff / (n * 3.0)
print(json.dumps({
    "mean": [round(mr, 2), round(mg, 2), round(mb, 2)],
    "std": [round(sr, 2), round(sg, 2), round(sb, 2)],
    "uniqueColors": unique,
    "edgeScore": round(edge, 2),
}))
`;

async function computePixelMetrics(base64Png) {
  return new Promise((resolve, reject) => {
    const binary = spawn("python3", ["-c", PYTHON_PIXEL_METRICS_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    binary.stdout.setEncoding("utf8");
    binary.stderr.setEncoding("utf8");
    binary.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    binary.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    binary.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pixel metrics failed: ${stderr || code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`pixel metrics parse failed: ${error.message}\n${stdout}`));
      }
    });
    binary.stdin.write(base64Png);
    binary.stdin.end();
  });
}

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function startStaticServer() {
  const server = createHttpServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url, "http://x").pathname;
      const filePath = resolve(
        REPO_ROOT,
        requestPath === "/" ? "harness/xterm-bench.html" : "." + requestPath,
      );
      if (!filePath.startsWith(REPO_ROOT)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const extension = extname(filePath).toLowerCase();
      const contentType = mimeTypes[extension] || "application/octet-stream";
      const data = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType });
      response.end(data);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(STATIC_PORT, (error) => {
      if (error) reject(error);
      else resolve(server);
    });
  });
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let cleaned = false;
    let idCounter = 0;
    const pending = new Map();
    const listeners = new Map();

    const client = {
      ws,
      request(method, params, sessionId) {
        const id = ++idCounter;
        const payload = { id, method, params: params ?? {} };
        if (sessionId) payload.sessionId = sessionId;
        return new Promise((resolver, rejector) => {
          pending.set(id, { resolve: resolver, reject: rejector });
          ws.send(JSON.stringify(payload));
        });
      },
      on(method, handler, sessionId) {
        const sessionKey = sessionId || "";
        const key = `${sessionKey}:${method}`;
        if (!listeners.has(key)) listeners.set(key, []);
        listeners.get(key).push(handler);
        return () => {
          const handlers = listeners.get(key);
          if (!handlers) return;
          const index = handlers.indexOf(handler);
          if (index !== -1) handlers.splice(index, 1);
        };
      },
      close() {
        cleaned = true;
        ws.close();
      },
    };

    ws.onopen = () => resolve(client);
    ws.onerror = (event) => {
      if (!cleaned) reject(new Error(`WebSocket error: ${event.message || ""}`));
    };
    ws.onclose = () => {
      cleaned = true;
      for (const { reject: rejector } of pending.values()) {
        rejector(new Error("CDP socket closed"));
      }
      pending.clear();
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: resolver, reject: rejector } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejector(new Error(message.error.message));
        else resolver(message.result);
      } else if (message.method) {
        const sessionId = message.sessionId || "";
        const key = `${sessionId}:${message.method}`;
        const handlers = listeners.get(key);
        if (handlers) handlers.forEach((handler) => handler(message.params));
      }
    };
  });
}

async function captureScreenshot(client, pageUrl, filePath) {
  const { targetId } = await client.request("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await client.request("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  try {
    await client.request("Runtime.enable", undefined, sessionId);
    await client.request("Page.enable", undefined, sessionId);

    client.request("Page.navigate", { url: pageUrl }, sessionId).catch(() => {});
    await new Promise((resolve) => {
      const dispose = client.on(
        "Page.loadEventFired",
        () => {
          dispose();
          resolve();
        },
        sessionId,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { data } = await client.request("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(filePath, Buffer.from(data, "base64"));
    return { path: filePath, url: pageUrl };
  } finally {
    await client.request("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function runBenchmark(client, renderer, query) {
  const { targetId } = await client.request("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await client.request("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  try {
    await client.request("Runtime.enable", undefined, sessionId);
    await client.request("Page.enable", undefined, sessionId);

    const benchmarkUrl = new URL("http://x/harness/xterm-bench.html");
    benchmarkUrl.searchParams.set("renderer", renderer);
    for (const [key, value] of query) {
      if (key !== "renderer") benchmarkUrl.searchParams.set(key, value);
    }
    const pageUrl = `http://127.0.0.1:${STATIC_PORT}/harness/xterm-bench.html${benchmarkUrl.search}`;

    try {
      const { windowId } = await client.request("Browser.getWindowForTarget", { targetId });
      await client.request("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "fullscreen" },
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      // Fullscreen request may fail in headless; the page still uses the full viewport.
    }

    client.request("Page.navigate", { url: pageUrl }, sessionId).catch(() => {});

    await new Promise((resolve) => {
      const dispose = client.on(
        "Page.loadEventFired",
        () => {
          dispose();
          resolve();
        },
        sessionId,
      );
    });

    // Give xterm a moment to fit to the full-screen viewport and initialize the renderer.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { result } = await client.request(
      "Runtime.evaluate",
      {
        expression: "(async () => await window.runXtermBenchmark())()",
        awaitPromise: true,
        returnByValue: true,
        timeout: 120000,
      },
      sessionId,
    );

    // Hide the status overlay so pixel metrics measure only terminal output.
    await client.request(
      "Runtime.evaluate",
      {
        expression: "document.getElementById('status').style.display='none'",
        returnByValue: true,
      },
      sessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { data } = await client.request("Page.captureScreenshot", { format: "png" }, sessionId);
    const pixelMetrics = await computePixelMetrics(data);

    return { ...result.value, pixelMetrics };
  } finally {
    await client.request("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function runSgrTest(client, query) {
  const { targetId } = await client.request("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await client.request("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  try {
    await client.request("Runtime.enable", undefined, sessionId);
    await client.request("Page.enable", undefined, sessionId);

    const testUrl = new URL("http://x/harness/xterm-sgr-test.html");
    const renderer = query.get("renderer") || "webgl";
    const fontFamily =
      query.get("fontFamily") ||
      '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    testUrl.searchParams.set("renderer", renderer);
    testUrl.searchParams.set("fontFamily", fontFamily);
    if (query.has("cols")) testUrl.searchParams.set("cols", query.get("cols"));
    if (query.has("rows")) testUrl.searchParams.set("rows", query.get("rows"));
    if (query.has("fontSize")) testUrl.searchParams.set("fontSize", query.get("fontSize"));
    if (query.has("lineHeight")) testUrl.searchParams.set("lineHeight", query.get("lineHeight"));
    const pageUrl = `http://127.0.0.1:${STATIC_PORT}/harness/xterm-sgr-test.html${testUrl.search}`;

    try {
      const { windowId } = await client.request("Browser.getWindowForTarget", { targetId });
      await client.request("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "fullscreen" },
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      // Fullscreen request may fail in headless; the page still uses the full viewport.
    }

    client.request("Page.navigate", { url: pageUrl }, sessionId).catch(() => {});

    await new Promise((resolve) => {
      const dispose = client.on(
        "Page.loadEventFired",
        () => {
          dispose();
          resolve();
        },
        sessionId,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    let sgrValue = null;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const pollResult = await client.request(
        "Runtime.evaluate",
        {
          expression:
            "(typeof window.sgrResult !== 'undefined' && window.sgrResult !== null) ? window.sgrResult : null",
          returnByValue: true,
        },
        sessionId,
      );
      sgrValue = pollResult.result.value;
      if (sgrValue !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      renderer,
      fontFamily,
      url: pageUrl,
      ...sgrValue,
    };
  } finally {
    await client.request("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function runRaceTest(client, query) {
  const { targetId } = await client.request("Target.createTarget", {
    url: "about:blank",
    background: true,
  });
  const { sessionId } = await client.request("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  try {
    await client.request("Runtime.enable", undefined, sessionId);
    await client.request("Page.enable", undefined, sessionId);
    await client.request("Network.enable", undefined, sessionId);
    await client.request("Log.enable", undefined, sessionId).catch(() => {});

    // Cold-load fonts on every run so the pre-ready write races the woff2 fetch
    // deterministically instead of relying on warm cache.
    if (query.get("cold") !== "0") {
      await client.request("Network.clearBrowserCache", undefined, sessionId).catch(() => {});
    }

    const consoleEntries = [];
    const disposeLog = client.on(
      "Log.entryAdded",
      (params) => {
        const entry = params.entry;
        consoleEntries.push({
          level: entry.level,
          text: entry.text,
          url: entry.url,
          lineNumber: entry.lineNumber,
        });
      },
      sessionId,
    );

    const testUrl = new URL("http://x/harness/xterm-font-race-test.html");
    testUrl.searchParams.set("scenario", query.get("scenario") || "appfaithful");
    if (query.has("mode")) testUrl.searchParams.set("mode", query.get("mode"));
    if (query.has("screenshot")) testUrl.searchParams.set("screenshot", query.get("screenshot"));
    if (query.has("weight")) testUrl.searchParams.set("weight", query.get("weight"));
    const pageUrl = `http://127.0.0.1:${STATIC_PORT}/harness/xterm-font-race-test.html${testUrl.search}`;

    client.request("Page.navigate", { url: pageUrl }, sessionId).catch(() => {});

    await new Promise((resolve) => {
      const dispose = client.on(
        "Page.loadEventFired",
        () => {
          dispose();
          resolve();
        },
        sessionId,
      );
      setTimeout(() => {
        dispose();
        resolve();
      }, 5000);
    });

    let raceValue = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const pollResult = await client.request(
        "Runtime.evaluate",
        {
          expression:
            "(typeof window.raceResult !== 'undefined' && window.raceResult !== null) ? window.raceResult : null",
          returnByValue: true,
        },
        sessionId,
      );
      raceValue = pollResult.result.value;
      if (raceValue !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (raceValue === null) {
      const { result } = await client.request(
        "Runtime.evaluate",
        {
          expression:
            "({ ready: typeof window.raceReady, hasTerminal: !!window.terminal, status: document.getElementById('status')?.textContent, body: document.body?.innerText?.slice(0, 200) })",
          returnByValue: true,
        },
        sessionId,
      );
      disposeLog();
      return {
        url: pageUrl,
        error: "raceResult never set within 30s",
        pageState: result.value,
        consoleEntries,
      };
    }

    disposeLog();

    if (query.get("screenshot") === "1") {
      await client.request(
        "Runtime.evaluate",
        {
          expression: "document.getElementById('status').style.display='none'",
          returnByValue: true,
        },
        sessionId,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const { data } = await client.request("Page.captureScreenshot", { format: "png" }, sessionId);
      const screenshotPath = `/tmp/appfaithful-${targetId}.png`;
      try {
        await writeFile(screenshotPath, Buffer.from(data, "base64"));
      } catch {}
      const pixelMetrics = await computePixelMetrics(data);
      return { url: pageUrl, screenshotPath, ...raceValue, consoleEntries, pixelMetrics };
    }

    return {
      url: pageUrl,
      ...raceValue,
      consoleEntries,
    };
  } finally {
    await client.request("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function main() {
  const staticServer = await startStaticServer();

  let client;
  let connected = false;
  let connectPromise = connectCdp(CDP_WS).then((c) => {
    client = c;
    connected = true;
    console.log(`CDP connected to ${CDP_WS}`);
    return c;
  });

  connectPromise.catch((error) => {
    console.error("CDP connection failed:", error.message);
  });

  let heartbeatTimer;
  async function heartbeat() {
    if (!connected || !client) return;
    try {
      await client.request("Browser.getVersion");
    } catch {
      connected = false;
      console.log("CDP heartbeat failed");
    }
  }
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);

  let running = false;
  let sgrRunning = false;
  let raceInFlight = 0;
  const RACE_CONCURRENCY = Number(process.env.RACE_CONCURRENCY || 8);
  const controlServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url, "http://x");
    const sendJson = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload, null, 2));
    };

    if (url.pathname === "/status") {
      sendJson(200, { connected, staticPort: STATIC_PORT, controlPort: CONTROL_PORT });
      return;
    }

    if (url.pathname === "/screenshot") {
      try {
        await connectPromise;
        if (!connected || !client) throw new Error("CDP not connected");
        const pageUrl =
          url.searchParams.get("url") || `http://127.0.0.1:${STATIC_PORT}/harness/xterm-bench.html`;
        const filePath = url.searchParams.get("path") || "/tmp/xterm-bench.png";
        const result = await captureScreenshot(client, pageUrl, filePath);
        sendJson(200, result);
      } catch (error) {
        sendJson(500, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/run-sgr") {
      if (sgrRunning) {
        sendJson(423, { error: "sgr test already running" });
        return;
      }
      sgrRunning = true;
      try {
        await connectPromise;
        if (!connected || !client) throw new Error("CDP not connected");
        const result = await runSgrTest(client, url.searchParams);
        sendJson(200, result);
      } catch (error) {
        sendJson(500, { error: error.message });
      } finally {
        sgrRunning = false;
      }
      return;
    }

    if (url.pathname === "/run-race") {
      if (raceInFlight >= RACE_CONCURRENCY) {
        sendJson(429, { error: "race concurrency limit reached", inFlight: raceInFlight });
        return;
      }
      raceInFlight += 1;
      try {
        await connectPromise;
        if (!connected || !client) throw new Error("CDP not connected");
        const result = await runRaceTest(client, url.searchParams);
        sendJson(200, result);
      } catch (error) {
        sendJson(500, { error: error.message });
      } finally {
        raceInFlight -= 1;
      }
      return;
    }

    if (url.pathname !== "/run") {
      sendJson(404, { error: "not found" });
      return;
    }

    if (running) {
      sendJson(423, { error: "benchmark already running" });
      return;
    }

    const renderer = url.searchParams.get("renderer") || "webgl";
    running = true;
    try {
      await connectPromise;
      if (!connected || !client) throw new Error("CDP not connected");
      const result = await runBenchmark(client, renderer, url.searchParams);
      sendJson(200, result);
    } catch (error) {
      sendJson(500, { error: error.message });
    } finally {
      running = false;
    }
  });

  await new Promise((resolve, reject) => {
    controlServer.listen(CONTROL_PORT, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  console.log(`Static server on http://127.0.0.1:${STATIC_PORT}`);
  console.log(`Control server on http://127.0.0.1:${CONTROL_PORT}`);

  function shutdown() {
    clearInterval(heartbeatTimer);
    try {
      client?.close();
    } catch {}
    staticServer.close();
    controlServer.close();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
