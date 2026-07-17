import { Terminal } from "/xterm/lib/xterm.mjs";
import { WebglAddon as PatchedWebglAddon } from "/addon/patched.mjs";
import { WebglAddon as UpstreamWebglAddon } from "/addon/upstream.mjs";
import { TERMINAL_THEMES } from "/themes.mjs";

const FONT_FAMILY = '"Geist Mono", ui-monospace, monospace';
const DEFAULT_FONT_SIZE_PX = 14;
const TERMINAL_COLUMNS = 72;
const TERMINAL_ROWS = 6;
const MINIMUM_CONTRAST_RATIO = 4.5;
const LOW_CONTRAST_RATIO = 3;
const RAW_CHANNEL_DIFFERENCE = 2;
const COVERAGE_DIFFERENCE = 0.05;
const LIGHT_THEME_IDS = ["github-light", "solarized-light", "catppuccin-latte"];
const DARK_BASELINE_THEME_ID = "vesper";
const ANSI_COLOR_ENTRIES = [
  ["default", "foreground"],
  ["black", "black"],
  ["red", "red"],
  ["green", "green"],
  ["yellow", "yellow"],
  ["blue", "blue"],
  ["magenta", "magenta"],
  ["cyan", "cyan"],
  ["white", "white"],
  ["bright black", "brightBlack"],
  ["bright red", "brightRed"],
  ["bright green", "brightGreen"],
  ["bright yellow", "brightYellow"],
  ["bright blue", "brightBlue"],
  ["bright magenta", "brightMagenta"],
  ["bright cyan", "brightCyan"],
  ["bright white", "brightWhite"],
];
const NORMAL_COLOR_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const PLAIN_SAMPLE = [
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "mmvmvmmvmvmmvmvmmv  MW@#%",
  "il1|!.,:;'`  0123456789",
].join("\r\n");
const createAnsiLine = (baseCode) =>
  NORMAL_COLOR_NAMES.map(
    (name, index) => `\u001b[${baseCode + index}m${index} ${name.slice(0, 4).padEnd(4)}`,
  ).join(" ") + "\u001b[0m";
const ANSI_SAMPLE = [
  "\u001b[?25l\u001b[0mDefault: The quick brown fox 0123456789",
  createAnsiLine(30),
  createAnsiLine(90),
  "\u001b[1mBold default and colored text\u001b[22m",
  "\u001b[2mDim default and colored text\u001b[22m",
  "Shapes: il1|!.,:;'`  MW@#%  mmvmv",
].join("\r\n");
const DISPLAY_MODES = [
  {
    id: "patched",
    label: "Current alpha-mask WebGL",
    Addon: PatchedWebglAddon,
  },
  {
    id: "upstream",
    label: "Pinned upstream WebGL",
    Addon: UpstreamWebglAddon,
  },
];

const runButton = document.getElementById("run");
const themeInput = document.getElementById("theme");
const fontSizeInput = document.getElementById("font-size");
const contrastFloorInput = document.getElementById("contrast-floor");
const statusElement = document.getElementById("status");
const summaryElement = document.getElementById("summary");
const themesElement = document.getElementById("themes");
const activeTerminals = [];
const searchParameters = new URL(window.location.href).searchParams;
const requestedThemeId = searchParameters.get("theme");
if (requestedThemeId && LIGHT_THEME_IDS.includes(requestedThemeId)) {
  themeInput.value = requestedThemeId;
}
const requestedContrastFloor = searchParameters.get("contrast");
if (requestedContrastFloor === "1" || requestedContrastFloor === "4.5") {
  contrastFloorInput.value = requestedContrastFloor;
}

const parseHex = (value) =>
  [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));

const relativeLuminance = (value) => {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrastRatio = (foreground, background) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const nextFrames = async () => {
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
};

const writeTerminal = (terminal, value) =>
  new Promise((resolveWrite) => terminal.write(value, resolveWrite));

const findWebglCanvas = (terminal) =>
  [...terminal.element.querySelectorAll(".xterm-screen canvas")].find((canvas) => {
    try {
      return Boolean(canvas.getContext("webgl2"));
    } catch {
      return false;
    }
  });

const createTerminal = async ({ Addon, theme, fontSize, minimumContrastRatio, sample, host }) => {
  host.style.background = theme.colors.background;
  host.style.fontWeight = "400";
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: TERMINAL_COLUMNS,
    rows: TERMINAL_ROWS,
    cursorBlink: false,
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight: "normal",
    fontWeightBold: "bold",
    lineHeight: 1,
    minimumContrastRatio,
    theme: theme.colors,
  });
  terminal.open(host);
  const webglAddon = new Addon({ preserveDrawingBuffer: true, muteEmojiColors: false });
  terminal.loadAddon(webglAddon);
  await writeTerminal(terminal, `\u001b[?25l${sample}`);
  terminal.refresh(0, terminal.rows - 1);
  await nextFrames();
  return { terminal, webglAddon, host };
};

const disposeTerminal = (entry) => {
  const canvas = findWebglCanvas(entry.terminal);
  const context = canvas?.getContext("webgl2");
  try {
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  try {
    entry.webglAddon.dispose();
  } catch {}
  try {
    entry.terminal.dispose();
  } catch {}
  entry.host.remove();
};

const readPixels = (terminal, theme) => {
  const canvas = findWebglCanvas(terminal);
  if (!canvas) throw new Error("WebGL canvas was not created");
  const context = canvas.getContext("webgl2");
  context.finish();
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  context.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  );
  return {
    width: canvas.width,
    height: canvas.height,
    pixels,
    foreground: parseHex(theme.colors.foreground),
    background: parseHex(theme.colors.background),
  };
};

const inferCoverage = (render) => {
  const values = new Float32Array(render.width * render.height);
  for (let pixelIndex = 0; pixelIndex < values.length; pixelIndex++) {
    let coverageSum = 0;
    let channelCount = 0;
    for (let channel = 0; channel < 3; channel++) {
      const colorDifference = render.foreground[channel] - render.background[channel];
      if (Math.abs(colorDifference) < 8) continue;
      coverageSum +=
        (render.pixels[pixelIndex * 4 + channel] - render.background[channel]) / colorDifference;
      channelCount += 1;
    }
    values[pixelIndex] = Math.max(
      0,
      Math.min(1, channelCount === 0 ? 0 : coverageSum / channelCount),
    );
  }
  return values;
};

const compareCoverage = (patchedRender, upstreamRender) => {
  if (
    patchedRender.width !== upstreamRender.width ||
    patchedRender.height !== upstreamRender.height
  ) {
    throw new Error("Renderer dimensions did not match");
  }
  const patchedCoverage = inferCoverage(patchedRender);
  const upstreamCoverage = inferCoverage(upstreamRender);
  let patchedInk = 0;
  let upstreamInk = 0;
  let absoluteDifference = 0;
  let pixelsAboveFivePercent = 0;
  let patchedHigherPixels = 0;
  let upstreamHigherPixels = 0;
  for (let index = 0; index < patchedCoverage.length; index++) {
    const difference = patchedCoverage[index] - upstreamCoverage[index];
    patchedInk += patchedCoverage[index];
    upstreamInk += upstreamCoverage[index];
    absoluteDifference += Math.abs(difference);
    if (Math.abs(difference) > COVERAGE_DIFFERENCE) pixelsAboveFivePercent += 1;
    if (difference > COVERAGE_DIFFERENCE) patchedHigherPixels += 1;
    if (difference < -COVERAGE_DIFFERENCE) upstreamHigherPixels += 1;
  }
  return {
    patchedInk,
    upstreamInk,
    inkDeltaPercent: upstreamInk === 0 ? 0 : ((patchedInk - upstreamInk) / upstreamInk) * 100,
    meanAbsoluteCoverageDifference: absoluteDifference / patchedCoverage.length,
    pixelsAboveFivePercent,
    patchedHigherPixels,
    upstreamHigherPixels,
    pixelCount: patchedCoverage.length,
  };
};

const compareRawPixels = (baselineRender, adjustedRender) => {
  if (
    baselineRender.width !== adjustedRender.width ||
    baselineRender.height !== adjustedRender.height
  ) {
    throw new Error("Contrast comparison dimensions did not match");
  }
  let changedPixels = 0;
  let channelDifferenceSum = 0;
  let maximumChannelDifference = 0;
  for (
    let pixelIndex = 0;
    pixelIndex < baselineRender.width * baselineRender.height;
    pixelIndex++
  ) {
    let didPixelChange = false;
    for (let channel = 0; channel < 3; channel++) {
      const offset = pixelIndex * 4 + channel;
      const difference = Math.abs(baselineRender.pixels[offset] - adjustedRender.pixels[offset]);
      channelDifferenceSum += difference;
      maximumChannelDifference = Math.max(maximumChannelDifference, difference);
      if (difference > RAW_CHANNEL_DIFFERENCE) didPixelChange = true;
    }
    if (didPixelChange) changedPixels += 1;
  }
  return {
    changedPixels,
    maximumChannelDifference,
    meanChannelDifference:
      channelDifferenceSum / (baselineRender.width * baselineRender.height * 3),
  };
};

const renderMeasurement = async (Addon, theme, fontSize, minimumContrastRatio, sample) => {
  const host = document.createElement("div");
  host.className = "measurement-host";
  document.body.append(host);
  const entry = await createTerminal({
    Addon,
    theme,
    fontSize,
    minimumContrastRatio,
    sample,
    host,
  });
  const render = readPixels(entry.terminal, theme);
  disposeTerminal(entry);
  await nextFrames();
  return render;
};

const measureRenderer = async (Addon, theme, fontSize) => ({
  plain: await renderMeasurement(Addon, theme, fontSize, 1, PLAIN_SAMPLE),
  contrastBaseline: await renderMeasurement(Addon, theme, fontSize, 1, ANSI_SAMPLE),
  contrastAdjusted: await renderMeasurement(
    Addon,
    theme,
    fontSize,
    MINIMUM_CONTRAST_RATIO,
    ANSI_SAMPLE,
  ),
});

const measureLiveThemeSwitch = async (theme, fontSize) => {
  const darkTheme = TERMINAL_THEMES.find(
    (terminalTheme) => terminalTheme.id === DARK_BASELINE_THEME_ID,
  );
  if (!darkTheme) throw new Error("The dark baseline theme was not found");
  const host = document.createElement("div");
  host.className = "measurement-host";
  document.body.append(host);
  const switchedEntry = await createTerminal({
    Addon: PatchedWebglAddon,
    theme: darkTheme,
    fontSize,
    minimumContrastRatio: 1,
    sample: ANSI_SAMPLE,
    host,
  });
  switchedEntry.terminal.options.minimumContrastRatio = MINIMUM_CONTRAST_RATIO;
  switchedEntry.terminal.options.theme = theme.colors;
  await nextFrames();
  const switchedRender = readPixels(switchedEntry.terminal, theme);
  disposeTerminal(switchedEntry);
  await nextFrames();
  const freshRender = await renderMeasurement(
    PatchedWebglAddon,
    theme,
    fontSize,
    MINIMUM_CONTRAST_RATIO,
    ANSI_SAMPLE,
  );
  return compareRawPixels(switchedRender, freshRender);
};

const measureTheme = async (theme, fontSize) => {
  const patched = await measureRenderer(PatchedWebglAddon, theme, fontSize);
  const upstream = await measureRenderer(UpstreamWebglAddon, theme, fontSize);
  const palette = ANSI_COLOR_ENTRIES.map(([label, colorKey]) => {
    const color = theme.colors[colorKey];
    return {
      label,
      color,
      ratio: contrastRatio(color, theme.colors.background),
    };
  });
  return {
    id: theme.id,
    name: theme.name,
    mask: compareCoverage(patched.plain, upstream.plain),
    patchedContrastAdjustment: compareRawPixels(patched.contrastBaseline, patched.contrastAdjusted),
    upstreamContrastAdjustment: compareRawPixels(
      upstream.contrastBaseline,
      upstream.contrastAdjusted,
    ),
    liveThemeSwitch: await measureLiveThemeSwitch(theme, fontSize),
    palette,
    colorsBelowThree: palette.filter((entry) => entry.ratio < LOW_CONTRAST_RATIO).length,
    colorsBelowFourPointFive: palette.filter((entry) => entry.ratio < MINIMUM_CONTRAST_RATIO)
      .length,
  };
};

const createContrastGrid = (measurement) => {
  const grid = document.createElement("div");
  grid.className = "contrast-grid";
  for (const entry of measurement.palette) {
    const swatch = document.createElement("div");
    swatch.className = "contrast-swatch";
    swatch.dataset.grade =
      entry.ratio >= MINIMUM_CONTRAST_RATIO
        ? "pass"
        : entry.ratio >= LOW_CONTRAST_RATIO
          ? "low"
          : "fail";
    const dot = document.createElement("span");
    dot.className = "contrast-dot";
    dot.style.background = entry.color;
    const label = document.createElement("span");
    label.textContent = entry.label;
    const ratio = document.createElement("span");
    ratio.className = "contrast-ratio";
    ratio.textContent = `${entry.ratio.toFixed(2)}:1`;
    swatch.append(dot, label, ratio);
    grid.append(swatch);
  }
  return grid;
};

const createRendererCard = async (mode, theme, fontSize, minimumContrastRatio) => {
  const card = document.createElement("div");
  card.className = "renderer-card";
  card.style.background = theme.colors.background;
  const bar = document.createElement("div");
  bar.className = "renderer-bar";
  const label = document.createElement("span");
  label.textContent = mode.label;
  const detail = document.createElement("span");
  detail.textContent = `minimumContrastRatio=${minimumContrastRatio}`;
  bar.append(label, detail);
  const host = document.createElement("div");
  host.className = "terminal-host";
  card.append(bar, host);
  const entry = await createTerminal({
    Addon: mode.Addon,
    theme,
    fontSize,
    minimumContrastRatio,
    sample: ANSI_SAMPLE,
    host,
  });
  activeTerminals.push(entry);
  return card;
};

const renderTheme = async (theme, measurement, fontSize, minimumContrastRatio) => {
  const section = document.createElement("section");
  section.className = "theme-section";
  const heading = document.createElement("div");
  heading.className = "theme-heading";
  const title = document.createElement("h2");
  title.textContent = theme.name;
  const source = document.createElement("span");
  source.textContent = `${theme.colors.foreground} on ${theme.colors.background}`;
  heading.append(title, source);

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.textContent = [
    `patch vs upstream glyph ink: ${measurement.mask.inkDeltaPercent >= 0 ? "+" : ""}${measurement.mask.inkDeltaPercent.toFixed(1)}%`,
    `edge pixels differing >5%: ${measurement.mask.pixelsAboveFivePercent.toLocaleString()}`,
    `palette colors below 4.5:1: ${measurement.colorsBelowFourPointFive}/17`,
    `below 3:1: ${measurement.colorsBelowThree}/17`,
    `live-switch pixel differences: ${measurement.liveThemeSwitch.changedPixels.toLocaleString()}`,
  ].join(" · ");

  const verdict = document.createElement("div");
  verdict.className = "verdict";
  const contrastBypassed =
    measurement.patchedContrastAdjustment.changedPixels === 0 &&
    measurement.upstreamContrastAdjustment.changedPixels > 0;
  verdict.textContent = [
    measurement.mask.inkDeltaPercent > 5
      ? `Renderer polarity effect detected: the current mask is ${measurement.mask.inkDeltaPercent.toFixed(1)}% more inked than upstream.`
      : "No material renderer polarity difference detected.",
    contrastBypassed
      ? `Contrast-floor bypass detected: patched output changed 0 pixels at 4.5:1; upstream changed ${measurement.upstreamContrastAdjustment.changedPixels.toLocaleString()}.`
      : `Contrast-floor pixel changes: patched ${measurement.patchedContrastAdjustment.changedPixels.toLocaleString()}, upstream ${measurement.upstreamContrastAdjustment.changedPixels.toLocaleString()}.`,
  ].join(" ");

  const rendererGrid = document.createElement("div");
  rendererGrid.className = "renderer-grid";
  section.append(heading, metrics, verdict, createContrastGrid(measurement), rendererGrid);
  themesElement.append(section);
  for (const mode of DISPLAY_MODES) {
    rendererGrid.append(await createRendererCard(mode, theme, fontSize, minimumContrastRatio));
  }
};

const disposeActiveTerminals = () => {
  for (const entry of activeTerminals) disposeTerminal(entry);
  activeTerminals.length = 0;
};

const summarize = (measurements) => {
  const polarityThemes = measurements.filter((measurement) => measurement.mask.inkDeltaPercent > 5);
  const contrastBypassThemes = measurements.filter(
    (measurement) =>
      measurement.patchedContrastAdjustment.changedPixels === 0 &&
      measurement.upstreamContrastAdjustment.changedPixels > 0,
  );
  const lowContrastColors = measurements.reduce(
    (total, measurement) => total + measurement.colorsBelowFourPointFive,
    0,
  );
  const mismatchedLiveSwitches = measurements.filter(
    (measurement) => measurement.liveThemeSwitch.changedPixels > 0,
  );
  summaryElement.textContent = [
    `${polarityThemes.length}/${measurements.length} light themes show a >5% alpha-mask versus upstream ink increase.`,
    `${lowContrastColors}/${measurements.length * ANSI_COLOR_ENTRIES.length} default/ANSI colors are below 4.5:1.`,
    `${contrastBypassThemes.length}/${measurements.length} themes show minimumContrastRatio affecting upstream but not the patched renderer.`,
    `${mismatchedLiveSwitches.length}/${measurements.length} live dark-to-light switches differ from a fresh light terminal.`,
    "Use the contrast-floor selector and the two renderer cards to distinguish soft/heavy glyph edges from colors that are simply too close to the background.",
  ].join("\n");
};

const runDiagnostic = async () => {
  runButton.disabled = true;
  window.__diagnosticReady = false;
  window.__diagnosticReport = undefined;
  disposeActiveTerminals();
  themesElement.replaceChildren();
  const parsedFontSize = Number.parseInt(fontSizeInput.value, 10);
  const fontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : DEFAULT_FONT_SIZE_PX;
  const parsedContrastFloor = Number.parseFloat(contrastFloorInput.value);
  const displayMinimumContrastRatio = Number.isFinite(parsedContrastFloor)
    ? parsedContrastFloor
    : 1;
  try {
    statusElement.textContent = "Loading Geist Mono…";
    await Promise.all([
      document.fonts.load(`400 ${fontSize}px ${FONT_FAMILY}`),
      document.fonts.load(`700 ${fontSize}px ${FONT_FAMILY}`),
    ]);
    await document.fonts.ready;
    const themes = LIGHT_THEME_IDS.map((themeId) =>
      TERMINAL_THEMES.find((theme) => theme.id === themeId),
    );
    if (themes.some((theme) => !theme)) throw new Error("A diagnostic theme was not found");
    const measurements = [];
    for (const theme of themes) {
      statusElement.textContent = `Measuring ${theme.name} at DPR ${devicePixelRatio}…`;
      measurements.push(await measureTheme(theme, fontSize));
    }
    const displayedThemeIndex = themes.findIndex((theme) => theme.id === themeInput.value);
    const resolvedThemeIndex = displayedThemeIndex === -1 ? 0 : displayedThemeIndex;
    const displayedTheme = themes[resolvedThemeIndex];
    statusElement.textContent = `Rendering ${displayedTheme.name} comparison…`;
    await renderTheme(
      displayedTheme,
      measurements[resolvedThemeIndex],
      fontSize,
      displayMinimumContrastRatio,
    );
    summarize(measurements);
    statusElement.textContent = `Complete · DPR ${devicePixelRatio} · font ${fontSize}px · contrast floor ${displayMinimumContrastRatio}`;
    window.__diagnosticReport = {
      devicePixelRatio,
      fontSize,
      displayMinimumContrastRatio,
      displayedThemeId: displayedTheme.id,
      measurements,
    };
    window.__diagnosticReady = true;
  } catch (error) {
    statusElement.textContent = `Diagnostic failed: ${error instanceof Error ? error.message : String(error)}`;
    window.__diagnosticError = String(error);
    throw error;
  } finally {
    runButton.disabled = false;
  }
};

runButton.addEventListener("click", () => void runDiagnostic());
void runDiagnostic();
