import { Terminal } from "/xterm/lib/xterm.mjs";
import { WebglAddon } from "/addon/lib/addon-webgl.mjs";

const GEIST_LATIN_400 = "/fonts/geist-mono-latin-400-normal.woff2";
const GEIST_LATIN_700 = "/fonts/geist-mono-latin-700-normal.woff2";
const FONT_FAMILY = `"Geist Mono", ui-monospace, monospace`;
const FONT_SIZE = 14;
const COLS = 28;
const ROWS = 3;
const SAMPLE_ROW = "MMMMMMMMMMMMMMMMMMMMMMMMMMMM";
const PROMPT_ROW = "\u001b[32m$\u001b[0m mmvmvmmvmvmmvmvmmv";
const INK_RATIO_BOLD_THRESHOLD = 1.1; // Geist 700 is ~1.16x ink of 400
const WEIGHT_MATCH_TOLERANCE = 0.04; // |ink-ref|/ref within 4% => classified
const SPAWN_GAP_MS = 25;
const ATLAS_CAPACITY_PAGE_LIMIT = 4;
const ATLAS_CAPACITY_TEXTURE_SIZE_PX = 512;
const ATLAS_CAPACITY_CHUNKS = 8;
const ATLAS_CAPACITY_GLYPHS_PER_CHUNK = 919;
const ATLAS_CAPACITY_COLUMNS = 80;
const ATLAS_CAPACITY_ROWS = 24;
const ATLAS_CAPACITY_HOLDER_WIDTH_PX = 800;
const ATLAS_CAPACITY_HOLDER_HEIGHT_PX = 480;
const WIDE_GLYPH_CELL_COLUMNS = 2;
const RGBA_CHANNEL_COUNT = 4;
const CJK_BASE_CODEPOINT = 0x4e00;
const CJK_CODEPOINT_RANGE = 0x9fff - CJK_BASE_CODEPOINT;
const ATLAS_PIXEL_CHANNEL_TOLERANCE = 2;
const ATLAS_SENTINEL_TEXT =
  "!#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz";

const deckEl = document.getElementById("deck");
const logEl = document.getElementById("log");

let baselineInkRatio = null;
let referenceBaseline = null;
let weightReference = { w400: null, w700: null };
const terminals = [];

const fmt = (n) => (n == null ? "  -  " : n.toFixed(3));

const appendLog = (text, cls = "") => {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  logEl.appendChild(span);
  logEl.appendChild(document.createTextNode("\n"));
  logEl.scrollTop = logEl.scrollHeight;
};

const clearLog = () => {
  logEl.textContent = "";
};

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

// Calibrate the ink ratio for Geist Mono 400 vs 700 using a plain 2D canvas in
// the same process/font context. Classifying a rendered terminal row against
// these two anchors answers "is the renderer drawing bold?" far more reliably
// than a bare ratio threshold (Geist 700 is only ~16% heavier than 400).
const calibrateWeights = async () => {
  await preloadGeist();
  await document.fonts.ready;
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = 240;
  probeCanvas.height = 48;
  const context = probeCanvas.getContext("2d");
  const measure = (weight) => {
    context.clearRect(0, 0, probeCanvas.width, probeCanvas.height);
    context.font = `normal ${weight} 28px ${FONT_FAMILY}`;
    context.textBaseline = "alphabetic";
    context.fillStyle = "#ffffff";
    context.fillText(SAMPLE_ROW.slice(0, 10), 4, 34);
    const data = context.getImageData(0, 0, probeCanvas.width, probeCanvas.height).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] > 48 || data[index + 1] > 48 || data[index + 2] > 48) ink += 1;
    }
    return ink;
  };
  weightReference = { w400: measure(400), w700: measure(700) };
  return weightReference;
};

const classifyWeight = (inkRatio) => {
  if (inkRatio == null) return null;
  // The terminal renders at FONT_SIZE (14px) while the probe uses 28px; the
  // *ratio* of a bold tab to its 400 reference is what matters, so compare
  // ratios against the calibrated 700/400 ratio.
  const reference = referenceBaseline ?? baselineInkRatio;
  if (reference == null) return null;
  const terminalBoldRatio = inkRatio / reference;
  const calibratedBoldRatio = weightReference.w700 / weightReference.w400;
  const delta = Math.abs(terminalBoldRatio - calibratedBoldRatio);
  if (delta < WEIGHT_MATCH_TOLERANCE + 0.06) return "~700 (bold)";
  if (Math.abs(terminalBoldRatio - 1) < WEIGHT_MATCH_TOLERANCE) return "~400 (normal)";
  if (terminalBoldRatio > 1.06) return `heavier (~${Math.round(terminalBoldRatio * 100)}%)`;
  if (terminalBoldRatio < 0.94) return `lighter (~${Math.round(terminalBoldRatio * 100)}%)`;
  return `~${Math.round(terminalBoldRatio * 100)}%`;
};

// Inspects the CharSizeService measurement and the inherited font-weight on
// the terminal root + measure element. xterm's measure element sets fontFamily
// and fontSize but NOT fontWeight, so it inherits the page's weight — a known
// cause of cell-width/glyph overflow that reads as "bold". Surfacing this in
// the real (Dia) environment settles whether that path is the culprit.
// Inspects the WebGL atlas canvas to detect the "colored glyph" collapse.
// The alpha-mask fragment shader uses dot(texel.rgb, luma) as alpha, which is
// only correct when the atlas stores WHITE glyphs (rgb==alpha for every
// covered pixel). If a glyph is ever drawn in its foreground color (e.g. green
// for the zsh prompt), green's luma weight (0.587) makes covered pixels render
// lighter/flattened instead of at full coverage. A resize/font swap rebuilds
// the atlas white and "fixes" it. This probe classifies covered pixels.
const getRenderer = (terminal) =>
  terminal._core?._renderService?._renderer?.value ?? terminal._core?._renderService?._renderer;

const inspectAtlas = (terminal) => {
  const renderer = getRenderer(terminal);
  if (!renderer) return { hasRenderer: false };
  const atlasCanvas =
    renderer.textureAtlas ??
    renderer._charAtlas?.pages?.[0]?.canvas ??
    renderer._glyphRenderer?.value?._atlas?.pages?.[0]?.canvas;
  if (!atlasCanvas) return { hasRenderer: true, atlas: false };
  const width = Math.min(atlasCanvas.width, 256);
  const height = Math.min(atlasCanvas.height, 64);
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = width;
  probeCanvas.height = height;
  const context = probeCanvas.getContext("2d");
  context.drawImage(atlasCanvas, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  let covered = 0;
  let whiteGlyph = 0; // rgb == alpha (correct alpha-mask invariant)
  let flatWhite = 0; // rgb == 255, alpha < 255 (luma-collapse source)
  let colored = 0; // rgb channels differ (glyph drawn in fg color)
  let maxColorDelta = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    covered += 1;
    const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
    maxColorDelta = Math.max(maxColorDelta, channelSpread);
    if (channelSpread > 8) colored += 1;
    else if (red === 255 && alpha < 255) flatWhite += 1;
    else if (red === alpha && green === alpha && blue === alpha) whiteGlyph += 1;
  }
  return {
    hasRenderer: true,
    atlas: true,
    atlasW: atlasCanvas.width,
    covered,
    whiteGlyph,
    flatWhite,
    colored,
    maxColorDelta,
    coloredRatio: covered ? colored / covered : 0,
  };
};

const inspectDimensions = (terminal) => {
  const core = terminal._core;
  const charSize = core?._charSizeService;
  const xtermRoot = terminal.element; // terminal.element is the `.xterm` root
  const measureEl =
    xtermRoot?.querySelector(".xterm-xmeasure") ?? xtermRoot?.querySelector(".xterm-rows");
  const computed = measureEl ? globalThis.getComputedStyle(measureEl) : null;
  const rootComputed = xtermRoot ? globalThis.getComputedStyle(xtermRoot) : null;
  return {
    charWidth: charSize?.width ?? null,
    charHeight: charSize?.height ?? null,
    dpr: globalThis.devicePixelRatio,
    measureElClass: measureEl?.className ?? null,
    measureFontWeight: computed?.fontWeight ?? null,
    measureFontFamily: computed?.fontFamily ?? null,
    rootFontWeight: rootComputed?.fontWeight ?? null,
    cols: terminal.cols,
    rows: terminal.rows,
  };
};

const loadGeistFace = async (weight, url) => {
  const face = new FontFace("Geist Mono", `url(${url})`, {
    weight: `${weight}`,
    style: "normal",
  });
  document.fonts.add(face);
  await face.load();
};

const preloadGeist = async () => {
  await Promise.all([loadGeistFace("400", GEIST_LATIN_400), loadGeistFace("700", GEIST_LATIN_700)]);
  appendLog(
    `preload: Geist Mono 400/700 faces loaded (document.fonts.status=${document.fonts.status})`,
    "muted",
  );
};

const measureInkRatio = (terminal) => {
  const screenEl = terminal.element?.querySelector(".xterm-screen");
  const canvases = [...(screenEl?.querySelectorAll("canvas") ?? [])];
  // The glyph renderer canvas is the one with a WebGL2 context (no class).
  // The link/selection layers are 2D canvases and must be skipped.
  const canvas = canvases.find((candidate) => {
    try {
      return candidate.getContext("webgl2") || candidate.getContext("webgl");
    } catch {
      return false;
    }
  });
  if (!canvas) return null;
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return inkRatio2d(ctx, canvas);
  }
  const width = canvas.width;
  const height = canvas.height;
  const pixels = new Uint8Array(width * height * 4);
  // Preserve framebuffer so readPixels sees the rendered frame.
  const prevPreserve = gl.getContextAttributes()?.preserveDrawingBuffer;
  try {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } catch (error) {
    return null;
  }
  if (prevPreserve === false) {
    // without preserveDrawingBuffer the buffer is cleared after composite;
    // reading right after a render frame still yields valid pixels.
  }
  return inkRatioFromRgba(pixels, width, height, COLS, ROWS);
};

const inkRatioFromRgba = (pixels, width, height, cols, rows) => {
  // Background is near-black in this harness. A pixel counts as "ink" if its
  // max channel exceeds a small threshold above 0 (foreground is light).
  const inkValue = 48;
  // Approximate the text band as the whole canvas (small ROWS), excluding a
  // 2px border to skip cell padding.
  const marginLeft = 6;
  const marginTop = 4;
  const usableWidth = width - marginLeft * 2;
  const usableHeight = height - marginTop * 2;
  let ink = 0;
  let total = 0;
  for (let y = marginTop; y < marginTop + usableHeight; y++) {
    for (let x = marginLeft; x < marginLeft + usableWidth; x++) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      total += 1;
      if (red > inkValue || green > inkValue || blue > inkValue) ink += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
};

const inkRatio2d = (ctx, canvas) => {
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  return inkRatioFromRgba(image.data, width, height, COLS, ROWS);
};

const writeSample = (terminal) => {
  // Plain text, no SGR bold attributes, so any boldening must come from the
  // renderer/atlas side. Row 1 mimics a real zsh prompt (incl. the `$` glyph);
  // rows 2-3 are dense for ink-coverage measurement.
  terminal.reset();
  terminal.writeln(PROMPT_ROW);
  terminal.writeln(SAMPLE_ROW);
  terminal.write(SAMPLE_ROW);
};

const updateBar = (card, inkRatio, isBold, weightLabel) => {
  const inkSpan = card.querySelector(".bar .ink");
  inkSpan.textContent = `ink ${fmt(inkRatio)} | ${weightLabel ?? "?"}`;
  inkSpan.classList.toggle("bold", isBold === true || (weightLabel ?? "").includes("700"));
};

const spawnTerminal = async (index, forceBold = false) => {
  const card = document.createElement("div");
  card.className = "term-card";
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML = `<span>tab #${index}</span><span class="ink">ink  -  </span>`;
  const holder = document.createElement("div");
  card.appendChild(bar);
  card.appendChild(holder);
  deckEl.appendChild(card);

  const terminal = new Terminal({
    cols: COLS,
    rows: ROWS,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    fontWeight: forceBold ? "bold" : "normal",
    fontWeightBold: "bold",
    allowTransparency: false,
  });
  terminal.open(holder);
  // Force the explicit font-family onto the measure element's ancestor chain
  // so CharSizeService cannot inherit a heavier page weight.
  holder.style.fontWeight = "400";
  holder.dataset.forceBold = forceBold ? "1" : "0";
  const webgl = new WebglAddon({ preserveDrawingBuffer: true });
  webgl.onContextLoss(() => webgl.dispose());
  terminal.loadAddon(webgl);

  writeSample(terminal);

  // Wait two animation frames so the WebGL renderer composites before reading.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const inkRatio = measureInkRatio(terminal);
  const compareAgainst = referenceBaseline ?? baselineInkRatio;
  const isBold =
    inkRatio == null
      ? null
      : compareAgainst == null
        ? null
        : inkRatio > compareAgainst * INK_RATIO_BOLD_THRESHOLD;
  const weightLabel = classifyWeight(inkRatio);
  const dimensions = inspectDimensions(terminal);
  const atlasProbe = inspectAtlas(terminal);
  updateBar(card, inkRatio, isBold, weightLabel);

  terminals.push({ terminal, webgl, card, inkRatio, isBold, weightLabel, dimensions, atlasProbe });
  return { inkRatio, isBold, weightLabel, dimensions, atlasProbe };
};

const disposeAll = () => {
  for (const entry of terminals) {
    try {
      entry.webgl.dispose();
    } catch {}
    try {
      entry.terminal.dispose();
    } catch {}
    entry.card.remove();
  }
  terminals.length = 0;
};

const spawnBatch = async () => {
  const count = Number.parseInt(document.getElementById("count").value, 10) || 6;
  const awaitFonts = document.getElementById("awaitFonts").checked;
  const prewarm = document.getElementById("prewarmFont").checked;
  appendLog(
    `spawn: ${count} tabs | awaitFonts=${awaitFonts} | prewarm=${prewarm} | ref=${fmt(referenceBaseline)}`,
    "muted",
  );

  if (prewarm) {
    await preloadGeist();
  }
  if (awaitFonts) {
    await document.fonts.ready;
  }
  // Per-batch baseline is only used as a fallback when no reference has been
  // captured yet. The reference (from the safe config) is the authoritative
  // "correct weight" value the auto-scan compares against.
  if (referenceBaseline == null) baselineInkRatio = null;

  let boldCount = 0;
  for (let index = 0; index < count; index++) {
    const { inkRatio, isBold, weightLabel, dimensions, atlasProbe } = await spawnTerminal(index);
    if (index === 0)
      appendLog(
        `dims: ${JSON.stringify(dimensions)} | atlas: ${JSON.stringify(atlasProbe)}`,
        "muted",
      );
    appendLog(
      `tab #${index}: inkRatio=${fmt(inkRatio)} weight=${weightLabel ?? "?"} ${isBold == null ? "(baseline)" : isBold ? "BOLD" : "ok"}`,
      isBold === true ? "bad" : isBold === false ? "good" : "muted",
    );
    if (inkRatio != null && baselineInkRatio == null) baselineInkRatio = inkRatio;
    if (isBold === true) boldCount += 1;
    await sleep(SPAWN_GAP_MS);
  }
  appendLog(
    `done: ${boldCount}/${count} tabs rendered bold (batch baseline ink=${fmt(baselineInkRatio)})`,
    boldCount > 0 ? "bad" : "good",
  );
  appendLog(
    `shared atlas cache: ${getRenderer(terminals[0]?.terminal)?._charAtlas ? "yes" : "?"}`,
    "muted",
  );
};

const clearAtlasOnAll = () => {
  for (const entry of terminals) {
    try {
      entry.terminal.clearTextureAtlas?.();
      // xterm core path used by the app:
      getRenderer(entry.terminal)?.clearTextureAtlas?.();
    } catch (error) {
      appendLog(`clearAtlas error: ${error.message}`, "bad");
    }
  }
  appendLog("clearTextureAtlas() called on all tabs -> re-measuring", "muted");
  void reMeasure();
};

const resizeNudge = () => {
  for (const entry of terminals) {
    // Trigger the same handleResize -> _refreshCharAtlas path a real CSS resize
    // would, without changing the atlas config key.
    try {
      getRenderer(entry.terminal)?.handleResize?.(COLS, ROWS);
    } catch (error) {
      appendLog(`resize error: ${error.message}`, "bad");
    }
  }
  appendLog("handleResize() nudged on all tabs -> re-measuring", "muted");
  void reMeasure();
};

const reMeasure = async () => {
  let boldCount = 0;
  for (const entry of terminals) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const inkRatio = measureInkRatio(entry.terminal);
    const compareAgainst = referenceBaseline ?? baselineInkRatio;
    const isBold =
      inkRatio == null || compareAgainst == null
        ? null
        : inkRatio > compareAgainst * INK_RATIO_BOLD_THRESHOLD;
    const weightLabel = classifyWeight(inkRatio);
    entry.inkRatio = inkRatio;
    entry.isBold = isBold;
    entry.weightLabel = weightLabel;
    updateBar(entry.card, inkRatio, isBold, weightLabel);
    if (isBold === true) boldCount += 1;
  }
  appendLog(
    `re-measured: ${boldCount}/${terminals.length} bold (ref=${fmt(referenceBaseline)})`,
    boldCount > 0 ? "bad" : "good",
  );
};

// Auto-scan sweeps the most likely triggers so a single click exercises the
// matrix the real app hits when spam-refreshing tabs. A "safe" probe (fonts
// preloaded + awaited, single fresh terminal) captures the reference ink
// ratio; every other config is compared against it so a racy/poisoned atlas
// shows up as BOLD regardless of the fallback font the browser picks.
const autoScan = async () => {
  if (typeof window !== "undefined") window.__scanReport = [];
  clearLog();
  referenceBaseline = null;
  baselineInkRatio = null;

  appendLog("## calibrating Geist 400 vs 700 weight anchors...", "muted");
  await calibrateWeights();
  appendLog(
    `## calibrated: w400=${weightReference.w400} w700=${weightReference.w700} (bold ratio=${(weightReference.w700 / weightReference.w400).toFixed(3)})`,
    "muted",
  );

  const safeConfig = { prewarm: true, awaitFonts: true };
  document.getElementById("prewarmFont").checked = safeConfig.prewarm;
  document.getElementById("awaitFonts").checked = safeConfig.awaitFonts;
  document.getElementById("count").value = String(1);
  appendLog("## reference: fresh single terminal, fonts ready", "muted");
  disposeAll();
  await sleep(120);
  await spawnBatch();
  referenceBaseline = terminals[0]?.inkRatio ?? null;
  appendLog(
    `## reference ink=${fmt(referenceBaseline)} (terminal weight=${terminals[0]?.weightLabel ?? "?"}; all other configs compared to this)\n`,
    "muted",
  );
  if (typeof window !== "undefined")
    window.__scanReport.push({
      config: "reference",
      ink: referenceBaseline,
      weight: terminals[0]?.weightLabel,
      bold: 0,
      total: terminals.length,
    });

  // Positive control: a terminal whose xterm fontWeight option is forced to
  // "bold" must rasterize 700. If the classifier doesn't flag it, the detector
  // is broken and results are meaningless.
  document.getElementById("count").value = String(1);
  appendLog("## positive control: force xterm fontWeight=bold", "muted");
  disposeAll();
  await sleep(120);
  const positiveCardForce = true;
  await spawnTerminal(0, positiveCardForce);
  appendLog(
    `## positive control weight=${terminals[0]?.weightLabel} (must be ~700)\n`,
    terminals[0]?.weightLabel?.includes("700") ? "bad" : "muted",
  );
  if (typeof window !== "undefined")
    window.__scanReport.push({
      config: "positive-control:fontWeight=bold",
      ink: terminals[0]?.inkRatio,
      weight: terminals[0]?.weightLabel,
      bold: terminals[0]?.weightLabel?.includes("700") ? 1 : 0,
      total: 1,
    });

  document.getElementById("count").value = String(6);
  const configs = [
    {
      prewarm: false,
      awaitFonts: false,
      label: "cold: no preload + no await  (racy startup, e.g. refreshed tab mid-load)",
    },
    {
      prewarm: true,
      awaitFonts: false,
      label: "warm: preload only  (faces added, fonts.ready not awaited)",
    },
    {
      prewarm: true,
      awaitFonts: true,
      label: "safe-repeat: preload + await (shared atlas after clear)",
    },
  ];
  for (const config of configs) {
    document.getElementById("prewarmFont").checked = config.prewarm;
    document.getElementById("awaitFonts").checked = config.awaitFonts;
    appendLog(`## ${config.label}`, "muted");
    disposeAll();
    await sleep(120);
    await spawnBatch();
    const boldTabs = terminals.filter((entry) => entry.isBold === true).length;
    if (typeof window !== "undefined")
      window.__scanReport.push({
        config: config.label,
        ink: terminals.map((entry) => entry.inkRatio),
        bold: boldTabs,
        total: terminals.length,
      });
    await sleep(120);
  }

  // Heal path: prove the atlas-cache-poisoning theory by clearing the atlas on
  // a bold batch and showing it returns to the reference ink ratio.
  document.getElementById("prewarmFont").checked = false;
  document.getElementById("awaitFonts").checked = false;
  appendLog("\n## heal: cold batch then clearTextureAtlas() on all", "muted");
  disposeAll();
  await sleep(120);
  await spawnBatch();
  const boldBeforeHeal = terminals.filter((entry) => entry.isBold === true).length;
  clearAtlasOnAll();
  await sleep(300);
  await reMeasure();
  const boldAfterHeal = terminals.filter((entry) => entry.isBold === true).length;
  appendLog(
    `heal: ${boldBeforeHeal}/${terminals.length} bold before clearTextureAtlas -> ${boldAfterHeal}/${terminals.length} after`,
    boldAfterHeal > 0 ? "bad" : "good",
  );
  if (typeof window !== "undefined")
    window.__scanReport.push({
      config: "heal:cold+clearTextureAtlas",
      boldBefore: boldBeforeHeal,
      boldAfter: boldAfterHeal,
      total: terminals.length,
    });

  appendLog("\nAUTOSCAN DONE", "muted");
};

const runAtlasCapacityProbe = async () => {
  disposeAll();
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:0;top:0;width:${ATLAS_CAPACITY_HOLDER_WIDTH_PX}px;height:${ATLAS_CAPACITY_HOLDER_HEIGHT_PX}px;opacity:0;pointer-events:none`;
  document.body.appendChild(holder);
  const waitForFrames = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const createTerminal = () => {
    const terminal = new Terminal({
      cols: ATLAS_CAPACITY_COLUMNS,
      rows: ATLAS_CAPACITY_ROWS,
      scrollback: 0,
      cursorBlink: false,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
    });
    terminal.open(holder);
    const webgl = new WebglAddon({ preserveDrawingBuffer: true });
    terminal.loadAddon(webgl);
    return { terminal, webgl };
  };
  const probe = createTerminal();
  await waitForFrames();
  const probeAtlas = getRenderer(probe.terminal)?._charAtlas;
  if (!probeAtlas) throw new Error("WebGL atlas unavailable");
  const atlasConstructor = probeAtlas.constructor;
  const originalPageLimit = atlasConstructor.maxAtlasPages;
  const originalTextureSize = atlasConstructor.maxTextureSize;
  probe.terminal.dispose();
  holder.replaceChildren();
  atlasConstructor.maxAtlasPages = ATLAS_CAPACITY_PAGE_LIMIT;
  atlasConstructor.maxTextureSize = ATLAS_CAPACITY_TEXTURE_SIZE_PX;

  const errors = [];
  const handleError = (event) =>
    errors.push(event.error?.message ?? event.message ?? String(event));
  window.addEventListener("error", handleError);
  let active;
  let removalDisposable;
  let maximumPages = 0;
  let removals = 0;
  let textureCapacity = 0;
  let changedPixels = null;
  let maximumPixelDifference = null;
  try {
    active = createTerminal();
    removalDisposable = active.webgl.onRemoveTextureAtlasCanvas(() => {
      removals += 1;
    });
    await waitForFrames();
    const renderer = getRenderer(active.terminal);
    const atlas = renderer?._charAtlas;
    const atlasTextures = renderer?._glyphRenderer?.value?._atlasTextures;
    if (!atlas || !atlasTextures) throw new Error("WebGL renderer internals unavailable");
    textureCapacity = atlasTextures.length;
    const canvas = [...holder.querySelectorAll(".xterm-screen canvas")].find((candidate) => {
      try {
        return Boolean(candidate.getContext("webgl2"));
      } catch {
        return false;
      }
    });
    const webglContext = canvas?.getContext("webgl2");
    if (!canvas || !webglContext) throw new Error("WebGL canvas unavailable");
    const capturePixels = () => {
      webglContext.finish();
      const pixels = new Uint8Array(canvas.width * canvas.height * RGBA_CHANNEL_COUNT);
      webglContext.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        webglContext.RGBA,
        webglContext.UNSIGNED_BYTE,
        pixels,
      );
      return pixels;
    };
    const renderSentinel = async () => {
      let output = "\x1b[?25l\x1b[H\x1b[2J\x1b[0m";
      for (let rowIndex = 0; rowIndex < ATLAS_CAPACITY_ROWS; rowIndex += 1) {
        output += `\x1b[${rowIndex + 1};1H${ATLAS_SENTINEL_TEXT}`;
      }
      await new Promise((resolve) => active.terminal.write(output, resolve));
      active.terminal.refresh(0, active.terminal.rows - 1);
      await waitForFrames();
      return capturePixels();
    };
    const sentinelBeforeFlood = await renderSentinel();
    let codepointOffset = 0;
    for (let chunkIndex = 0; chunkIndex < ATLAS_CAPACITY_CHUNKS; chunkIndex += 1) {
      let output = "\x1b[H\x1b[2J";
      for (let glyphIndex = 0; glyphIndex < ATLAS_CAPACITY_GLYPHS_PER_CHUNK; glyphIndex += 1) {
        output += String.fromCodePoint(
          CJK_BASE_CODEPOINT + ((codepointOffset + glyphIndex) % CJK_CODEPOINT_RANGE),
        );
        if ((glyphIndex + 1) % (ATLAS_CAPACITY_COLUMNS / WIDE_GLYPH_CELL_COLUMNS) === 0)
          output += "\r\n";
      }
      codepointOffset += ATLAS_CAPACITY_GLYPHS_PER_CHUNK;
      await new Promise((resolve) => active.terminal.write(output, resolve));
      await waitForFrames();
      maximumPages = Math.max(maximumPages, atlas.pages.length);
      if (errors.length > 0 || maximumPages > textureCapacity) break;
    }
    if (errors.length === 0 && maximumPages <= textureCapacity) {
      const sentinelAfterFlood = await renderSentinel();
      changedPixels = 0;
      maximumPixelDifference = 0;
      for (
        let pixelIndex = 0;
        pixelIndex < sentinelBeforeFlood.length;
        pixelIndex += RGBA_CHANNEL_COUNT
      ) {
        let didPixelChange = false;
        for (let channelIndex = 0; channelIndex < RGBA_CHANNEL_COUNT; channelIndex += 1) {
          const channelDifference = Math.abs(
            sentinelBeforeFlood[pixelIndex + channelIndex] -
              sentinelAfterFlood[pixelIndex + channelIndex],
          );
          maximumPixelDifference = Math.max(maximumPixelDifference, channelDifference);
          if (channelDifference > ATLAS_PIXEL_CHANNEL_TOLERANCE) didPixelChange = true;
        }
        if (didPixelChange) changedPixels += 1;
      }
    }
  } finally {
    removalDisposable?.dispose();
    active?.terminal.dispose();
    atlasConstructor.maxAtlasPages = originalPageLimit;
    atlasConstructor.maxTextureSize = originalTextureSize;
    window.removeEventListener("error", handleError);
    holder.remove();
  }
  return {
    passed:
      errors.length === 0 && maximumPages <= textureCapacity && removals > 0 && changedPixels === 0,
    errors,
    maximumPages,
    textureCapacity,
    removals,
    changedPixels,
    maximumPixelDifference,
  };
};

window.__runAtlasCapacityProbe = runAtlasCapacityProbe;

document.getElementById("spawn").addEventListener("click", () => void spawnBatch());
document.getElementById("dispose").addEventListener("click", () => {
  disposeAll();
  appendLog("disposed all tabs.", "muted");
});
document.getElementById("clearAtlas").addEventListener("click", clearAtlasOnAll);
document.getElementById("resize").addEventListener("click", resizeNudge);
document.getElementById("autoscan").addEventListener("click", () => void autoScan());

appendLog("ready. click `auto-scan` to run the trigger matrix.", "muted");
