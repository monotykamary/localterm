#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import pngjs from "pngjs";

const { PNG } = pngjs;

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cdpPort = Number.parseInt(process.env.CDP_PORT ?? "9562", 10);
const harnessUrl = new URL(process.env.HARNESS_URL ?? "http://127.0.0.1:4819/");
const requestedFontId = process.env.FONT;
if (requestedFontId) harnessUrl.searchParams.set("font", requestedFontId);
const requestedThemeId = process.env.THEME;
if (requestedThemeId) harnessUrl.searchParams.set("theme", requestedThemeId);
const requestedContrastFloor = process.env.CONTRAST_FLOOR;
if (requestedContrastFloor) harnessUrl.searchParams.set("contrast", requestedContrastFloor);
const devicePixelRatio = Number.parseFloat(process.env.DPR ?? "2");
const screenshotPath = process.env.SCREENSHOT_PATH ?? "/tmp/localterm-light-theme-rendering.png";
const detailScreenshotPath =
  process.env.DETAIL_SCREENSHOT_PATH ?? "/tmp/localterm-light-theme-rendering-detail.png";
const MAX_NATIVE_CANVAS_INK_DELTA_PERCENT = 5;
const MAX_NATIVE_CANVAS_VISIBLE_PIXEL_DELTA_PERCENT = 5;
const MAX_NATIVE_CANVAS_DISTRIBUTION_DELTA_PERCENT = 5;
const MAX_NATIVE_CANVAS_MEAN_CHANNEL_DIFFERENCE = 3;
const MAX_NATIVE_CANVAS_CHANGED_PIXEL_PERCENT = 12;
const rendererScreenshotPath = (rendererId) =>
  screenshotPath.toLowerCase().endsWith(".png")
    ? `${screenshotPath.slice(0, -4)}-${rendererId}.png`
    : `${screenshotPath}-${rendererId}.png`;

const parseHexChannels = (value) =>
  [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));

const compareRendererPngs = (
  candidateBuffer,
  referenceBuffer,
  background,
  rowStart = 0,
  rowEnd,
) => {
  const candidate = PNG.sync.read(candidateBuffer);
  const reference = PNG.sync.read(referenceBuffer);
  if (candidate.width !== reference.width || candidate.height !== reference.height) {
    return {
      dimensionsMatch: false,
      candidate: `${candidate.width}x${candidate.height}`,
      reference: `${reference.width}x${reference.height}`,
    };
  }
  const end = rowEnd === undefined ? candidate.height : Math.min(candidate.height, rowEnd);
  let unionPixels = 0;
  let changedPixels = 0;
  let excessPixels = 0;
  let deficitPixels = 0;
  let absoluteChannelDifference = 0;
  let candidateInk = 0;
  let referenceInk = 0;
  for (let y = rowStart; y < end; y++) {
    for (let x = 0; x < candidate.width; x++) {
      const offset = (y * candidate.width + x) * 4;
      let candidatePixelInk = 0;
      let referencePixelInk = 0;
      let maximumDifference = 0;
      for (let channel = 0; channel < 3; channel++) {
        candidatePixelInk = Math.max(
          candidatePixelInk,
          Math.abs(candidate.data[offset + channel] - background[channel]),
        );
        referencePixelInk = Math.max(
          referencePixelInk,
          Math.abs(reference.data[offset + channel] - background[channel]),
        );
        const difference = Math.abs(
          candidate.data[offset + channel] - reference.data[offset + channel],
        );
        absoluteChannelDifference += difference;
        maximumDifference = Math.max(maximumDifference, difference);
      }
      if (Math.max(candidatePixelInk, referencePixelInk) <= 3) continue;
      unionPixels += 1;
      candidateInk += candidatePixelInk;
      referenceInk += referencePixelInk;
      if (maximumDifference > 8) changedPixels += 1;
      if (candidatePixelInk - referencePixelInk > 8) excessPixels += 1;
      if (referencePixelInk - candidatePixelInk > 8) deficitPixels += 1;
    }
  }
  return {
    dimensionsMatch: true,
    width: candidate.width,
    rowStart,
    rowEnd: end,
    inkDeltaPercent: referenceInk === 0 ? 0 : ((candidateInk - referenceInk) / referenceInk) * 100,
    meanAbsoluteChannelDifference:
      unionPixels === 0 ? 0 : absoluteChannelDifference / (unionPixels * 3),
    changedPixelPercent: unionPixels === 0 ? 0 : (changedPixels / unionPixels) * 100,
    excessPixelPercent: unionPixels === 0 ? 0 : (excessPixels / unionPixels) * 100,
    deficitPixelPercent: unionPixels === 0 ? 0 : (deficitPixels / unionPixels) * 100,
    unionPixels,
  };
};

const summarizeRendererCoverage = (
  buffer,
  foreground,
  background,
  startRow,
  rowCount,
  totalRows,
) => {
  const image = PNG.sync.read(buffer);
  const startY = Math.round((image.height * startRow) / totalRows);
  const endY = Math.round((image.height * (startRow + rowCount)) / totalRows);
  let resolvedForeground = foreground;
  let maximumForegroundDistance = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      const distance = Math.max(
        Math.abs(image.data[offset] - background[0]),
        Math.abs(image.data[offset + 1] - background[1]),
        Math.abs(image.data[offset + 2] - background[2]),
      );
      if (distance <= maximumForegroundDistance) continue;
      maximumForegroundDistance = distance;
      resolvedForeground = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    }
  }
  let ink = 0;
  let visiblePixels = 0;
  let visibleInk = 0;
  let hardPixels = 0;
  let fuzzyPixels = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      let coverageSum = 0;
      let channelCount = 0;
      for (let channel = 0; channel < 3; channel++) {
        const colorDifference = resolvedForeground[channel] - background[channel];
        if (Math.abs(colorDifference) < 8) continue;
        coverageSum += (image.data[offset + channel] - background[channel]) / colorDifference;
        channelCount += 1;
      }
      const coverage = Math.max(
        0,
        Math.min(1, channelCount === 0 ? 0 : coverageSum / channelCount),
      );
      ink += coverage;
      if (coverage <= 0.15) continue;
      visiblePixels += 1;
      visibleInk += coverage;
      if (coverage >= 0.8) hardPixels += 1;
      if (coverage < 0.5) fuzzyPixels += 1;
    }
  }
  return {
    width: image.width,
    foreground: resolvedForeground,
    startY,
    endY,
    ink,
    visiblePixels,
    hardPixelPercent: visiblePixels === 0 ? 0 : (hardPixels / visiblePixels) * 100,
    fuzzyPixelPercent: visiblePixels === 0 ? 0 : (fuzzyPixels / visiblePixels) * 100,
    meanVisibleCoverage: visiblePixels === 0 ? 0 : visibleInk / visiblePixels,
  };
};

const compareRendererCoverage = (candidate, reference) => ({
  candidateWidth: candidate.width,
  referenceWidth: reference.width,
  inkDeltaPercent:
    reference.ink === 0 ? 0 : ((candidate.ink - reference.ink) / reference.ink) * 100,
  visiblePixelDeltaPercent:
    reference.visiblePixels === 0
      ? 0
      : ((candidate.visiblePixels - reference.visiblePixels) / reference.visiblePixels) * 100,
  hardPixelDeltaPercent: candidate.hardPixelPercent - reference.hardPixelPercent,
  fuzzyPixelDeltaPercent: candidate.fuzzyPixelPercent - reference.fuzzyPixelPercent,
  meanVisibleCoverageDeltaPercent:
    (candidate.meanVisibleCoverage - reference.meanVisibleCoverage) * 100,
});

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
  await client.send("Runtime.evaluate", {
    expression: "window.__refreshDiagnosticRenderers()",
    awaitPromise: true,
    returnByValue: true,
  });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  const detailEvaluation = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const grid = document.querySelector(".renderer-grid");
      if (!grid) return undefined;
      const bounds = grid.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    })()`,
    returnByValue: true,
  });
  const detailBounds = detailEvaluation.result.value;
  if (!detailBounds) throw new Error("Renderer detail bounds were not found");
  const detailScreenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { ...detailBounds, scale: 1 },
  });
  await writeFile(detailScreenshotPath, Buffer.from(detailScreenshot.data, "base64"));
  const rendererBoundsEvaluation = await client.send("Runtime.evaluate", {
    expression: `Array.from(document.querySelectorAll(".terminal-host[data-renderer-id]"), (host) => {
      const screen = host.querySelector(".xterm-screen");
      if (!screen) return undefined;
      const bounds = screen.getBoundingClientRect();
      return {
        id: host.dataset.rendererId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }).filter(Boolean)`,
    returnByValue: true,
  });
  const rendererBuffers = new Map();
  const rendererScreenshotPaths = {};
  for (const bounds of rendererBoundsEvaluation.result.value) {
    const rendererScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scale: 1,
      },
    });
    const buffer = Buffer.from(rendererScreenshot.data, "base64");
    const path = rendererScreenshotPath(bounds.id);
    rendererBuffers.set(bounds.id, buffer);
    rendererScreenshotPaths[bounds.id] = path;
    await writeFile(path, buffer);
  }
  const candidateBuffer = rendererBuffers.get("patched");
  if (!candidateBuffer) throw new Error("Patched renderer screenshot was not captured");
  const background = parseHexChannels(value.report.displayedThemeColors.background);
  const foreground = parseHexChannels(value.report.displayedThemeColors.foreground);
  const candidatePng = PNG.sync.read(candidateBuffer);
  const normalStartY = Math.round(
    (candidatePng.height * value.report.normalReferenceStartRow) / value.report.rendererRows,
  );
  const normalEndY = Math.round(
    (candidatePng.height *
      (value.report.normalReferenceStartRow + value.report.normalReferenceRowCount)) /
      value.report.rendererRows,
  );
  const candidateCoverage = summarizeRendererCoverage(
    candidateBuffer,
    foreground,
    background,
    value.report.normalReferenceStartRow,
    value.report.normalReferenceRowCount,
    value.report.rendererRows,
  );
  value.report.rendererComparisons = {};
  for (const rendererId of ["canvas", "dom"]) {
    const referenceBuffer = rendererBuffers.get(rendererId);
    if (!referenceBuffer) throw new Error(`${rendererId} renderer screenshot was not captured`);
    const referenceCoverage = summarizeRendererCoverage(
      referenceBuffer,
      foreground,
      background,
      value.report.normalReferenceStartRow,
      value.report.normalReferenceRowCount,
      value.report.rendererRows,
    );
    value.report.rendererComparisons[rendererId] = {
      normalCoverage: compareRendererCoverage(candidateCoverage, referenceCoverage),
      normalNativePixels: compareRendererPngs(
        candidateBuffer,
        referenceBuffer,
        background,
        normalStartY,
        normalEndY,
      ),
      fullCorpusNativePixels: compareRendererPngs(candidateBuffer, referenceBuffer, background),
    };
  }
  value.report.rendererScreenshotPaths = rendererScreenshotPaths;
  const driverFailures = [];
  for (const [category, themeIds] of Object.entries(value.report.validationFailures)) {
    if (themeIds.length > 0) driverFailures.push(`${category}: ${themeIds.join(", ")}`);
  }
  const canvasComparison = value.report.rendererComparisons.canvas;
  const nativeCoverage = canvasComparison.normalCoverage;
  const nativePixels = canvasComparison.normalNativePixels;
  if (!nativePixels.dimensionsMatch) {
    driverFailures.push("Canvas screenshot dimensions differ");
  } else {
    if (Math.abs(nativeCoverage.inkDeltaPercent) > MAX_NATIVE_CANVAS_INK_DELTA_PERCENT) {
      driverFailures.push(
        `Canvas screenshot ink delta ${nativeCoverage.inkDeltaPercent.toFixed(1)}%`,
      );
    }
    if (
      Math.abs(nativeCoverage.visiblePixelDeltaPercent) >
      MAX_NATIVE_CANVAS_VISIBLE_PIXEL_DELTA_PERCENT
    ) {
      driverFailures.push(
        `Canvas screenshot visible delta ${nativeCoverage.visiblePixelDeltaPercent.toFixed(1)}%`,
      );
    }
    for (const [label, delta] of [
      ["hard", nativeCoverage.hardPixelDeltaPercent],
      ["fuzzy", nativeCoverage.fuzzyPixelDeltaPercent],
      ["mean", nativeCoverage.meanVisibleCoverageDeltaPercent],
    ]) {
      if (Math.abs(delta) > MAX_NATIVE_CANVAS_DISTRIBUTION_DELTA_PERCENT) {
        driverFailures.push(`Canvas screenshot ${label} delta ${delta.toFixed(1)}%`);
      }
    }
    if (nativePixels.meanAbsoluteChannelDifference > MAX_NATIVE_CANVAS_MEAN_CHANNEL_DIFFERENCE) {
      driverFailures.push(
        `Canvas screenshot mean channel difference ${nativePixels.meanAbsoluteChannelDifference.toFixed(1)}`,
      );
    }
    if (nativePixels.changedPixelPercent > MAX_NATIVE_CANVAS_CHANGED_PIXEL_PERCENT) {
      driverFailures.push(
        `Canvas screenshot changed pixels ${nativePixels.changedPixelPercent.toFixed(1)}%`,
      );
    }
  }
  value.report.driverFailures = driverFailures;
  console.log(`${value.status}\n`);
  for (const measurement of value.report.measurements) {
    const hardPixelDelta =
      measurement.canvasMask.patchedDistribution.hardPixelPercent -
      measurement.canvasMask.upstreamDistribution.hardPixelPercent;
    const fuzzyPixelDelta =
      measurement.canvasMask.patchedDistribution.fuzzyPixelPercent -
      measurement.canvasMask.upstreamDistribution.fuzzyPixelPercent;
    const meanCoverageDelta =
      (measurement.canvasMask.patchedDistribution.meanVisibleCoverage -
        measurement.canvasMask.upstreamDistribution.meanVisibleCoverage) *
      100;
    console.log(
      `${measurement.name}: Canvas ink=${measurement.canvasMask.inkDeltaPercent >= 0 ? "+" : ""}${measurement.canvasMask.inkDeltaPercent.toFixed(1)}% visible=${measurement.canvasMask.visiblePixelDeltaPercent >= 0 ? "+" : ""}${measurement.canvasMask.visiblePixelDeltaPercent.toFixed(1)}% hard=${hardPixelDelta >= 0 ? "+" : ""}${hardPixelDelta.toFixed(1)}pp fuzzy=${fuzzyPixelDelta >= 0 ? "+" : ""}${fuzzyPixelDelta.toFixed(1)}pp mean=${meanCoverageDelta >= 0 ? "+" : ""}${meanCoverageDelta.toFixed(1)}pp error=${(measurement.canvasMask.visibleMeanAbsoluteCoverageDifference * 100).toFixed(1)}% half=${measurement.canvasMask.halfCoverageMaskChangedPercent.toFixed(1)}%/${measurement.canvasMask.halfCoveragePixelDeltaPercent >= 0 ? "+" : ""}${measurement.canvasMask.halfCoveragePixelDeltaPercent.toFixed(1)}% | framebuffer alpha=${measurement.translucentPixels} | faint ink=${measurement.faintMask.inkDeltaPercent >= 0 ? "+" : ""}${measurement.faintMask.inkDeltaPercent.toFixed(1)}% contrast=${measurement.faintContrastRatio.toFixed(2)} | inverse Canvas=${measurement.inverseMask.inkDeltaPercent >= 0 ? "+" : ""}${measurement.inverseMask.inkDeltaPercent.toFixed(1)}% | upstream footprint=${measurement.shapeMask.visiblePixelDeltaPercent >= 0 ? "+" : ""}${measurement.shapeMask.visiblePixelDeltaPercent.toFixed(1)}% | 4.5-floor pixels patched=${measurement.patchedContrastAdjustment.changedPixels}, upstream=${measurement.upstreamContrastAdjustment.changedPixels} | live-switch=${measurement.liveThemeSwitch.changedPixels}`,
    );
  }
  console.log(`\nScreenshot: ${screenshotPath}`);
  console.log(`Detail screenshot: ${detailScreenshotPath}`);
  for (const [rendererId, path] of Object.entries(rendererScreenshotPaths)) {
    console.log(`${rendererId} screenshot: ${path}`);
  }
  console.log(`\n${JSON.stringify(value.report, null, 2)}`);
  if (driverFailures.length > 0) {
    throw new Error(`Diagnostic validation failed: ${driverFailures.join("; ")}`);
  }
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
}
