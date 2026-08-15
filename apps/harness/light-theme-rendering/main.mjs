import { Terminal } from "/xterm/lib/xterm.mjs";
import { WebglAddon as PatchedWebglAddon } from "/addon/patched.mjs";
import { WebglAddon as UpstreamWebglAddon } from "/addon/upstream.mjs";
import { CanvasAddon } from "@xterm/addon-canvas";
import { TERMINAL_THEMES } from "/themes.mjs";
import { DIAGNOSTIC_FONTS } from "/harness/fonts.mjs";

const DEFAULT_DIAGNOSTIC_FONT_ID = DIAGNOSTIC_FONTS[0].id;
const DEFAULT_FONT_SIZE_PX = 13;
const DEFAULT_LINE_HEIGHT = 1.2;
const TERMINAL_COLUMNS = 104;
const TERMINAL_ROWS = 20;
const DIM_ANSI_SAMPLE_INDEX = 6;
const NORMAL_REFERENCE_START_ROW = 8;
const NORMAL_REFERENCE_ROW_COUNT = 2;
const MINIMUM_CONTRAST_RATIO = 4.5;
const LOW_CONTRAST_RATIO = 3;
const RAW_CHANNEL_DIFFERENCE = 2;
const COVERAGE_DIFFERENCE = 0.05;
const VISIBLE_COVERAGE = 0.15;
const FUZZY_COVERAGE = 0.5;
const HARD_COVERAGE = 0.8;
const MAX_CANVAS_INK_DELTA_PERCENT = 3;
const MAX_CANVAS_VISIBLE_PIXEL_DELTA_PERCENT = 1.5;
const MAX_CANVAS_HARD_PIXEL_DELTA_PERCENT = 2.5;
const MAX_CANVAS_FUZZY_PIXEL_DELTA_PERCENT = 4;
const MAX_CANVAS_MEAN_COVERAGE_DELTA_PERCENT = 2;
const MAX_CANVAS_VISIBLE_COVERAGE_ERROR = 0.035;
const MAX_CANVAS_HALF_COVERAGE_MASK_CHANGED_PERCENT = 7;
const MAX_CANVAS_HALF_COVERAGE_PIXEL_DELTA_PERCENT = 4;
const MIN_FAINT_INK_GAIN_PERCENT = 45;
const MIN_FAINT_CONTRAST_RATIO = 4.5;
const MIN_FAINT_MEAN_VISIBLE_COVERAGE = 0.57;
const MAX_INVERSE_INK_DELTA_PERCENT = 6;
const MAX_CONTRAST_ADJUSTMENT_PIXEL_DELTA_PERCENT = 7;
const LIGHT_THEME_IDS = ["tokyo-night-day", "github-light", "solarized-light", "catppuccin-latte"];
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
const PLAIN_SAMPLE_LINES = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ  abcdefghijklmnopqrstuvwxyz",
  "0123456789  !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  "Thin il1|!.,:;'`  Dense MW@#%  Curves 0689CGOQ  Diagonals AVWXYZkvxy",
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.",
  "Sphinx of black quartz, judge my vow.  => != === -> <- :: ffi ffl",
  "Box light: ┌──┬──┐ │  │  │ ├──┼──┤ └──┴──┘  rounded ╭─╮ ╰─╯",
  "Box heavy/double: ┏━┳━┓ ┃ ┣━╋━┫ ┗━┻━┛  ╔═╦═╗ ║ ╠═╬═╣ ╚═╩═╝",
  "Blocks: █ ▉ ▊ ▋ ▌ ▍ ▎ ▏  ▀ ▄  Shades: ░▒▓  Quadrants: ▖▗▘▙▚▛▜▝▞▟",
  "Braille: ⠀⠁⠃⠇⠏⠟⠿⡿⣿  Powerline:           ",
  "Arrows: ←↑→↓ ↔↕ ⇐⇑⇒⇓ ⇔  Math: ±×÷≠≤≥≈∞√∑∏∫∆∇∂  Currency: $¢£¥€₹₽₿",
  "Latin extended: café naïve façade Ångström smörgåsbord ČŽŠ Łódź e\u0301 a\u0308 n\u0303",
  "Greek: ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ  αβγδεζηθικλμνξοπρστυφχψω",
  "Cyrillic: АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩ  абвгдежзийклмнопрстуфхцчшщ",
  "Vietnamese: Trường Đại học, tiếng Việt, Nguyễn, cộng hòa, Đắk Lắk",
  "Wide fallback: 漢字 日本語 中文  한글 조합  العربية  עברית  देवनागरी  ไทย",
];
const PLAIN_SAMPLE = PLAIN_SAMPLE_LINES.join("\r\n");
const DIM_PLAIN_SAMPLE = `\u001b[2m${PLAIN_SAMPLE}\u001b[22m`;
const INVERSE_PLAIN_SAMPLE = PLAIN_SAMPLE_LINES.map(
  (line) => `\u001b[7m${line.padEnd(TERMINAL_COLUMNS)}\u001b[27m`,
).join("\r\n");
const createAnsiLine = (baseCode) =>
  NORMAL_COLOR_NAMES.map(
    (name, index) => `\u001b[${baseCode + index}m${index} ${name.slice(0, 4).padEnd(4)}`,
  ).join(" ") + "\u001b[0m";
const ANSI_SAMPLE_LINES = [
  "\u001b[38;2;84;104;58m$\u001b[38;2;65;95;185m pnpm run start\u001b[0m 0123456789",
  createAnsiLine(30),
  createAnsiLine(90),
  "\u001b[1mBold default and colored text: MW@#% il1| 0689\u001b[22m",
  "\u001b[3mItalic text and diagonals: AVWXYZ kvxy ffi -> =>\u001b[23m",
  "\u001b[4mUnderline\u001b[24m  \u001b[9mstrikethrough\u001b[29m  \u001b[7minverse cells\u001b[27m",
  "\u001b[2;38;2;65;95;185m$ node packages/cli/bin/localterm.mjs restart\u001b[0m",
  "\u001b[38;2;102;102;102mMuted #666: Pi startup/help and long prose rendering\u001b[39m",
  "ASCII: ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789",
  "Punctuation: !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~  thin il1|!.,:;'`",
  "Box light: ┌──┬──┐ │  │  │ ├──┼──┤ └──┴──┘  ╭─╮ ╰─╯",
  "Box heavy/double: ┏━┳━┓ ┃ ┣━╋━┫ ┗━┻━┛  ╔═╦═╗ ║ ╠═╬═╣ ╚═╩═╝",
  "Blocks/shades: █▉▊▋▌▍▎▏ ▀▄ ░▒▓ ▖▗▘▙▚▛▜▝▞▟  Braille: ⠁⠃⠇⠏⠟⠿⡿⣿",
  "Powerline/custom:           ",
  "Arrows/math: ←↑→↓ ↔↕ ⇐⇑⇒⇓ ⇔ ±×÷≠≤≥≈∞√∑∏∫∆∇∂",
  "Latin: café naïve façade Ångström ČŽŠ Łódź e\u0301 a\u0308 n\u0303",
  "Greek/Cyrillic: Ελληνικά αβγδεζ  Кириллица абвгдеж",
  "Wide fallback: 漢字 日本語 中文  한글 조합  العربية  עברית  देवनागरी  ไทย",
  "Emoji: 😀 😃 🥹 🚀 🌈 ❤️ 👍🏽 👩‍💻 🧑🏾‍🚀 👨‍👩‍👧‍👦 🇺🇸 1️⃣ ©️ ™️",
  "\u001b[38;2;84;104;58m$\u001b[38;2;65;95;185m ls -la\u001b[0m · final baseline MW@#% mmvmv il1|!.,:;'`",
];
const ANSI_SAMPLE = ANSI_SAMPLE_LINES.join("\r\n");
const CONTRAST_SAMPLE = ANSI_SAMPLE_LINES.filter(
  (_, index) => index !== DIM_ANSI_SAMPLE_INDEX,
).join("\r\n");
const DISPLAY_MODES = [
  {
    id: "patched",
    label: "Current alpha-mask WebGL",
    Addon: PatchedWebglAddon,
  },
  {
    id: "canvas",
    label: "xterm Canvas reference",
    Addon: CanvasAddon,
  },
  {
    id: "dom",
    label: "xterm DOM reference",
  },
];

const fontFamilyFor = (font) => `"${font.name}", ui-monospace, monospace`;
const defaultFont = DIAGNOSTIC_FONTS.find((font) => font.id === DEFAULT_DIAGNOSTIC_FONT_ID);
if (!defaultFont) throw new Error("The default diagnostic font was not found");
let activeFontFamily = fontFamilyFor(defaultFont);

const runButton = document.getElementById("run");
const fontInput = document.getElementById("font");
const themeInput = document.getElementById("theme");
const fontSizeInput = document.getElementById("font-size");
const contrastFloorInput = document.getElementById("contrast-floor");
const statusElement = document.getElementById("status");
const summaryElement = document.getElementById("summary");
const themesElement = document.getElementById("themes");
const activeTerminals = [];
for (const font of DIAGNOSTIC_FONTS) fontInput.add(new Option(font.name, font.id));

const searchParameters = new URL(window.location.href).searchParams;
const requestedFontId = searchParameters.get("font");
const requestedFont = DIAGNOSTIC_FONTS.find((font) => font.id === requestedFontId) ?? defaultFont;
fontInput.value = requestedFont.id;
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

const relativeLuminanceChannels = (channels) => {
  const linearChannels = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linearChannels[0] * 0.2126 + linearChannels[1] * 0.7152 + linearChannels[2] * 0.0722;
};

const relativeLuminance = (value) => relativeLuminanceChannels(parseHex(value));

const contrastRatioChannels = (foreground, background) => {
  const foregroundLuminance = relativeLuminanceChannels(foreground);
  const backgroundLuminance = relativeLuminanceChannels(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
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

window.__refreshDiagnosticRenderers = async () => {
  for (const entry of activeTerminals) {
    entry.terminal.refresh(0, entry.terminal.rows - 1);
  }
  await nextFrames();
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

const createTerminal = async ({
  Addon,
  theme,
  fontSize,
  minimumContrastRatio,
  sample,
  host,
  rows = TERMINAL_ROWS,
}) => {
  host.style.background = theme.colors.background;
  host.style.fontWeight = "400";
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: TERMINAL_COLUMNS,
    rows,
    cursorBlink: false,
    fontFamily: activeFontFamily,
    fontSize,
    fontWeight: "normal",
    fontWeightBold: "bold",
    lineHeight: DEFAULT_LINE_HEIGHT,
    minimumContrastRatio,
    theme: theme.colors,
  });
  terminal.open(host);
  const rendererAddon =
    Addon === CanvasAddon
      ? new Addon()
      : Addon
        ? new Addon({ preserveDrawingBuffer: true, muteEmojiColors: false })
        : undefined;
  if (rendererAddon) terminal.loadAddon(rendererAddon);
  await writeTerminal(terminal, `\u001b[?25l${sample}`);
  terminal.refresh(0, terminal.rows - 1);
  await nextFrames();
  return { terminal, rendererAddon, host };
};

const disposeTerminal = (entry) => {
  const canvas = findWebglCanvas(entry.terminal);
  const context = canvas?.getContext("webgl2");
  try {
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  try {
    entry.rendererAddon?.dispose();
  } catch {}
  try {
    entry.terminal.dispose();
  } catch {}
  entry.host.remove();
};

const findCanvasTextLayer = (terminal) =>
  terminal.element.querySelector(".xterm-screen .xterm-text-layer");

const readCanvasPixels = (terminal, theme, inverse = false) => {
  const canvas = findCanvasTextLayer(terminal);
  if (!canvas) throw new Error("Canvas text layer was not created");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas text layer context was not available");
  const source = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = new Uint8Array(source.length);
  const rowBytes = canvas.width * 4;
  for (let row = 0; row < canvas.height; row++) {
    const sourceOffset = row * rowBytes;
    const targetOffset = (canvas.height - row - 1) * rowBytes;
    pixels.set(source.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset);
  }
  return {
    width: canvas.width,
    height: canvas.height,
    pixels,
    foreground: parseHex(inverse ? theme.colors.background : theme.colors.foreground),
    background: parseHex(inverse ? theme.colors.foreground : theme.colors.background),
  };
};

const readPixels = (terminal, theme, inverse = false) => {
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
    foreground: parseHex(inverse ? theme.colors.background : theme.colors.foreground),
    background: parseHex(inverse ? theme.colors.foreground : theme.colors.background),
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

const summarizeCoverage = (coverage) => {
  let visiblePixels = 0;
  let visibleInk = 0;
  let fuzzyPixels = 0;
  let hardPixels = 0;
  for (const value of coverage) {
    if (value <= VISIBLE_COVERAGE) continue;
    visiblePixels += 1;
    visibleInk += value;
    if (value < FUZZY_COVERAGE) fuzzyPixels += 1;
    if (value >= HARD_COVERAGE) hardPixels += 1;
  }
  return {
    visiblePixels,
    meanVisibleCoverage: visiblePixels === 0 ? 0 : visibleInk / visiblePixels,
    fuzzyPixelPercent: visiblePixels === 0 ? 0 : (fuzzyPixels / visiblePixels) * 100,
    hardPixelPercent: visiblePixels === 0 ? 0 : (hardPixels / visiblePixels) * 100,
  };
};

const compareCoverage = (patchedRender, upstreamRender) => {
  if (
    patchedRender.width !== upstreamRender.width ||
    patchedRender.height !== upstreamRender.height
  ) {
    throw new Error(
      `Renderer dimensions did not match: ${patchedRender.width}x${patchedRender.height} vs ${upstreamRender.width}x${upstreamRender.height}`,
    );
  }
  const patchedCoverage = inferCoverage(patchedRender);
  const upstreamCoverage = inferCoverage(upstreamRender);
  let patchedInk = 0;
  let upstreamInk = 0;
  let absoluteDifference = 0;
  let pixelsAboveFivePercent = 0;
  let patchedHigherPixels = 0;
  let upstreamHigherPixels = 0;
  let visibleUnionPixels = 0;
  let visibleAbsoluteDifference = 0;
  let visiblyDifferentPixels = 0;
  let patchedHalfCoveragePixels = 0;
  let upstreamHalfCoveragePixels = 0;
  let halfCoverageMaskChangedPixels = 0;
  for (let index = 0; index < patchedCoverage.length; index++) {
    const difference = patchedCoverage[index] - upstreamCoverage[index];
    patchedInk += patchedCoverage[index];
    upstreamInk += upstreamCoverage[index];
    absoluteDifference += Math.abs(difference);
    if (Math.abs(difference) > COVERAGE_DIFFERENCE) pixelsAboveFivePercent += 1;
    if (difference > COVERAGE_DIFFERENCE) patchedHigherPixels += 1;
    if (difference < -COVERAGE_DIFFERENCE) upstreamHigherPixels += 1;
    if (Math.max(patchedCoverage[index], upstreamCoverage[index]) > VISIBLE_COVERAGE) {
      visibleUnionPixels += 1;
      visibleAbsoluteDifference += Math.abs(difference);
      if (Math.abs(difference) > COVERAGE_DIFFERENCE) visiblyDifferentPixels += 1;
    }
    const patchedHasHalfCoverage = patchedCoverage[index] >= FUZZY_COVERAGE;
    const upstreamHasHalfCoverage = upstreamCoverage[index] >= FUZZY_COVERAGE;
    if (patchedHasHalfCoverage) patchedHalfCoveragePixels += 1;
    if (upstreamHasHalfCoverage) upstreamHalfCoveragePixels += 1;
    if (patchedHasHalfCoverage !== upstreamHasHalfCoverage) {
      halfCoverageMaskChangedPixels += 1;
    }
  }
  const patchedDistribution = summarizeCoverage(patchedCoverage);
  const upstreamDistribution = summarizeCoverage(upstreamCoverage);
  return {
    patchedInk,
    upstreamInk,
    inkDeltaPercent: upstreamInk === 0 ? 0 : ((patchedInk - upstreamInk) / upstreamInk) * 100,
    meanAbsoluteCoverageDifference: absoluteDifference / patchedCoverage.length,
    pixelsAboveFivePercent,
    patchedHigherPixels,
    upstreamHigherPixels,
    patchedDistribution,
    upstreamDistribution,
    visibleMeanAbsoluteCoverageDifference:
      visibleUnionPixels === 0 ? 0 : visibleAbsoluteDifference / visibleUnionPixels,
    visiblyDifferentPixelPercent:
      visibleUnionPixels === 0 ? 0 : (visiblyDifferentPixels / visibleUnionPixels) * 100,
    halfCoverageMaskChangedPixels,
    halfCoverageMaskChangedPercent:
      Math.max(patchedHalfCoveragePixels, upstreamHalfCoveragePixels) === 0
        ? 0
        : (halfCoverageMaskChangedPixels /
            Math.max(patchedHalfCoveragePixels, upstreamHalfCoveragePixels)) *
          100,
    halfCoveragePixelDeltaPercent:
      upstreamHalfCoveragePixels === 0
        ? 0
        : ((patchedHalfCoveragePixels - upstreamHalfCoveragePixels) / upstreamHalfCoveragePixels) *
          100,
    visiblePixelDeltaPercent:
      upstreamDistribution.visiblePixels === 0
        ? 0
        : ((patchedDistribution.visiblePixels - upstreamDistribution.visiblePixels) /
            upstreamDistribution.visiblePixels) *
          100,
    pixelCount: patchedCoverage.length,
  };
};

const countTranslucentPixels = (render) => {
  let translucentPixels = 0;
  for (let offset = 3; offset < render.pixels.length; offset += 4) {
    if (render.pixels[offset] !== 255) translucentPixels += 1;
  }
  return translucentPixels;
};

const maximumPixelContrastRatio = (render) => {
  let maximumRatio = 1;
  for (let pixelIndex = 0; pixelIndex < render.width * render.height; pixelIndex++) {
    const offset = pixelIndex * 4;
    maximumRatio = Math.max(
      maximumRatio,
      contrastRatioChannels(
        [render.pixels[offset], render.pixels[offset + 1], render.pixels[offset + 2]],
        render.background,
      ),
    );
  }
  return maximumRatio;
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

const renderMeasurement = async (
  Addon,
  theme,
  fontSize,
  minimumContrastRatio,
  sample,
  inverse = false,
  rows = TERMINAL_ROWS,
) => {
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
    rows,
  });
  const render = readPixels(entry.terminal, theme, inverse);
  disposeTerminal(entry);
  await nextFrames();
  return render;
};

const renderCanvasMeasurement = async (theme, fontSize, sample = PLAIN_SAMPLE, inverse = false) => {
  const host = document.createElement("div");
  host.className = "measurement-host";
  document.body.append(host);
  const entry = await createTerminal({
    Addon: CanvasAddon,
    theme,
    fontSize,
    minimumContrastRatio: 1,
    sample,
    host,
    rows: TERMINAL_ROWS,
  });
  const render = readCanvasPixels(entry.terminal, theme, inverse);
  disposeTerminal(entry);
  await nextFrames();
  return render;
};

const measureRenderer = async (Addon, theme, fontSize) => ({
  plain: await renderMeasurement(Addon, theme, fontSize, 1, PLAIN_SAMPLE, false, TERMINAL_ROWS),
  dimPlain: await renderMeasurement(
    Addon,
    theme,
    fontSize,
    MINIMUM_CONTRAST_RATIO,
    DIM_PLAIN_SAMPLE,
    false,
    TERMINAL_ROWS,
  ),
  inversePlain: await renderMeasurement(
    Addon,
    theme,
    fontSize,
    1,
    INVERSE_PLAIN_SAMPLE,
    true,
    TERMINAL_ROWS,
  ),
  contrastBaseline: await renderMeasurement(Addon, theme, fontSize, 1, CONTRAST_SAMPLE),
  contrastAdjusted: await renderMeasurement(
    Addon,
    theme,
    fontSize,
    MINIMUM_CONTRAST_RATIO,
    CONTRAST_SAMPLE,
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
  const canvasPlain = await renderCanvasMeasurement(theme, fontSize);
  const canvasInverse = await renderCanvasMeasurement(theme, fontSize, INVERSE_PLAIN_SAMPLE, true);
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
    canvasMask: compareCoverage(patched.plain, canvasPlain),
    translucentPixels: countTranslucentPixels(patched.plain),
    faintMask: compareCoverage(patched.dimPlain, upstream.dimPlain),
    faintContrastRatio: maximumPixelContrastRatio(patched.dimPlain),
    inverseMask: compareCoverage(patched.inversePlain, canvasInverse),
    shapeMask: compareCoverage(patched.plain, upstream.plain),
    shapePixels: compareRawPixels(patched.plain, upstream.plain),
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
  card.dataset.rendererId = mode.id;
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
  host.dataset.rendererId = mode.id;
  card.append(bar, host);
  const entry = await createTerminal({
    Addon: mode.Addon,
    theme,
    fontSize,
    minimumContrastRatio,
    sample: ANSI_SAMPLE,
    host,
    rows: ANSI_SAMPLE_LINES.length,
  });
  activeTerminals.push(entry);
  return card;
};

const signedPercent = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const canvasCoverageDeltas = (measurement) => ({
  hard:
    measurement.canvasMask.patchedDistribution.hardPixelPercent -
    measurement.canvasMask.upstreamDistribution.hardPixelPercent,
  fuzzy:
    measurement.canvasMask.patchedDistribution.fuzzyPixelPercent -
    measurement.canvasMask.upstreamDistribution.fuzzyPixelPercent,
  mean:
    (measurement.canvasMask.patchedDistribution.meanVisibleCoverage -
      measurement.canvasMask.upstreamDistribution.meanVisibleCoverage) *
    100,
});

const canvasMatchIsInRange = (measurement) => {
  const deltas = canvasCoverageDeltas(measurement);
  return (
    Math.abs(measurement.canvasMask.inkDeltaPercent) <= MAX_CANVAS_INK_DELTA_PERCENT &&
    Math.abs(measurement.canvasMask.visiblePixelDeltaPercent) <=
      MAX_CANVAS_VISIBLE_PIXEL_DELTA_PERCENT &&
    Math.abs(deltas.hard) <= MAX_CANVAS_HARD_PIXEL_DELTA_PERCENT &&
    Math.abs(deltas.fuzzy) <= MAX_CANVAS_FUZZY_PIXEL_DELTA_PERCENT &&
    Math.abs(deltas.mean) <= MAX_CANVAS_MEAN_COVERAGE_DELTA_PERCENT &&
    measurement.canvasMask.visibleMeanAbsoluteCoverageDifference <=
      MAX_CANVAS_VISIBLE_COVERAGE_ERROR &&
    measurement.canvasMask.halfCoverageMaskChangedPercent <=
      MAX_CANVAS_HALF_COVERAGE_MASK_CHANGED_PERCENT &&
    Math.abs(measurement.canvasMask.halfCoveragePixelDeltaPercent) <=
      MAX_CANVAS_HALF_COVERAGE_PIXEL_DELTA_PERCENT &&
    measurement.translucentPixels === 0
  );
};

const faintCoverageIsReadable = (measurement) =>
  measurement.faintContrastRatio >= MIN_FAINT_CONTRAST_RATIO &&
  measurement.faintMask.inkDeltaPercent >= MIN_FAINT_INK_GAIN_PERCENT &&
  measurement.faintMask.patchedDistribution.meanVisibleCoverage >= MIN_FAINT_MEAN_VISIBLE_COVERAGE;

const inverseMatchesCanvas = (measurement) =>
  Math.abs(measurement.inverseMask.inkDeltaPercent) <= MAX_INVERSE_INK_DELTA_PERCENT;

const contrastAdjustmentMatchesUpstream = (measurement) => {
  const upstreamChangedPixels = measurement.upstreamContrastAdjustment.changedPixels;
  if (upstreamChangedPixels === 0) {
    return measurement.patchedContrastAdjustment.changedPixels === 0;
  }
  return (
    (Math.abs(measurement.patchedContrastAdjustment.changedPixels - upstreamChangedPixels) /
      upstreamChangedPixels) *
      100 <=
    MAX_CONTRAST_ADJUSTMENT_PIXEL_DELTA_PERCENT
  );
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

  const deltas = canvasCoverageDeltas(measurement);
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.textContent = [
    `Canvas ink delta: ${signedPercent(measurement.canvasMask.inkDeltaPercent)}`,
    `Canvas visible footprint: ${signedPercent(measurement.canvasMask.visiblePixelDeltaPercent)}`,
    `Canvas hard/fuzzy/mean deltas: ${signedPercent(deltas.hard)}/${signedPercent(deltas.fuzzy)}/${signedPercent(deltas.mean)}`,
    `Canvas visible coverage error: ${(measurement.canvasMask.visibleMeanAbsoluteCoverageDifference * 100).toFixed(2)}%`,
    `Canvas half mask changed: ${measurement.canvasMask.halfCoverageMaskChangedPercent.toFixed(2)}% (${signedPercent(measurement.canvasMask.halfCoveragePixelDeltaPercent)} area)`,
    `translucent framebuffer pixels: ${measurement.translucentPixels.toLocaleString()}`,
    `faint ink gain vs upstream: ${signedPercent(measurement.faintMask.inkDeltaPercent)}`,
    `faint core contrast: ${measurement.faintContrastRatio.toFixed(2)}:1`,
    `inverse ink delta vs Canvas: ${signedPercent(measurement.inverseMask.inkDeltaPercent)}`,
    `visible footprint vs upstream: ${signedPercent(measurement.shapeMask.visiblePixelDeltaPercent)}`,
    `raw pixels differing vs upstream: ${measurement.shapePixels.changedPixels.toLocaleString()}`,
    `palette colors below 4.5:1: ${measurement.colorsBelowFourPointFive}/17`,
    `below 3:1: ${measurement.colorsBelowThree}/17`,
    `live-switch pixel differences: ${measurement.liveThemeSwitch.changedPixels.toLocaleString()}`,
  ].join(" · ");

  const contrastAdjustmentMatches = contrastAdjustmentMatchesUpstream(measurement);
  const verdict = document.createElement("div");
  verdict.className = "verdict";
  verdict.textContent = [
    canvasMatchIsInRange(measurement)
      ? "Normal WebGL text matches the xterm Canvas raster within bounded coverage and geometry tolerances."
      : "Normal WebGL text diverges from the xterm Canvas raster or leaves a translucent framebuffer.",
    faintCoverageIsReadable(measurement)
      ? "SGR faint cores retain the light-theme contrast floor."
      : "SGR faint text is still too transparent or low contrast.",
    inverseMatchesCanvas(measurement)
      ? "Inverse light-on-dark text remains close to Canvas."
      : `Inverse ink delta ${measurement.inverseMask.inkDeltaPercent.toFixed(1)}% exceeds ${MAX_INVERSE_INK_DELTA_PERCENT}%.`,
    contrastAdjustmentMatches
      ? `Contrast-floor pixel changes remain close to upstream: patched ${measurement.patchedContrastAdjustment.changedPixels.toLocaleString()}, upstream ${measurement.upstreamContrastAdjustment.changedPixels.toLocaleString()}.`
      : `Contrast-floor pixel changes diverge: patched ${measurement.patchedContrastAdjustment.changedPixels.toLocaleString()}, upstream ${measurement.upstreamContrastAdjustment.changedPixels.toLocaleString()}.`,
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
  const canvasMisses = measurements.filter((measurement) => !canvasMatchIsInRange(measurement));
  const faintCoverageMisses = measurements.filter(
    (measurement) => !faintCoverageIsReadable(measurement),
  );
  const inverseDeltaMisses = measurements.filter(
    (measurement) => !inverseMatchesCanvas(measurement),
  );
  const contrastAdjustmentMisses = measurements.filter(
    (measurement) => !contrastAdjustmentMatchesUpstream(measurement),
  );
  const lowContrastColors = measurements.reduce(
    (total, measurement) => total + measurement.colorsBelowFourPointFive,
    0,
  );
  const mismatchedLiveSwitches = measurements.filter(
    (measurement) => measurement.liveThemeSwitch.changedPixels > 0,
  );
  summaryElement.textContent = [
    `${canvasMisses.length}/${measurements.length} normal samples miss the xterm Canvas coverage/geometry target.`,
    `${faintCoverageMisses.length}/${measurements.length} faint samples miss the contrast/readability targets.`,
    `${inverseDeltaMisses.length}/${measurements.length} inverse samples differ from Canvas by more than ${MAX_INVERSE_INK_DELTA_PERCENT}%.`,
    `${lowContrastColors}/${measurements.length * ANSI_COLOR_ENTRIES.length} default/ANSI colors are below 4.5:1.`,
    `${contrastAdjustmentMisses.length}/${measurements.length} themes diverge from upstream minimumContrastRatio adjustment by more than ${MAX_CONTRAST_ADJUSTMENT_PIXEL_DELTA_PERCENT}% of changed pixels.`,
    `${mismatchedLiveSwitches.length}/${measurements.length} live dark-to-light switches differ from a fresh light terminal.`,
    "Opaque Canvas raster reconstruction plus standard framebuffer alpha blending should match Canvas/DOM font fullness without bright edge halos.",
  ].join("\n");
  return {
    canvas: canvasMisses.map((measurement) => measurement.id),
    faint: faintCoverageMisses.map((measurement) => measurement.id),
    inverse: inverseDeltaMisses.map((measurement) => measurement.id),
    contrastAdjustment: contrastAdjustmentMisses.map((measurement) => measurement.id),
    liveThemeSwitch: mismatchedLiveSwitches.map((measurement) => measurement.id),
  };
};

const runDiagnostic = async () => {
  runButton.disabled = true;
  window.__diagnosticReady = false;
  window.__diagnosticReport = undefined;
  disposeActiveTerminals();
  themesElement.replaceChildren();
  const selectedFont = DIAGNOSTIC_FONTS.find((font) => font.id === fontInput.value) ?? defaultFont;
  activeFontFamily = fontFamilyFor(selectedFont);
  const parsedFontSize = Number.parseInt(fontSizeInput.value, 10);
  const fontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : DEFAULT_FONT_SIZE_PX;
  const parsedContrastFloor = Number.parseFloat(contrastFloorInput.value);
  const displayMinimumContrastRatio = Number.isFinite(parsedContrastFloor)
    ? parsedContrastFloor
    : 1;
  try {
    statusElement.textContent = `Loading ${selectedFont.name}…`;
    await Promise.all([
      document.fonts.load(`400 ${fontSize}px ${activeFontFamily}`, PLAIN_SAMPLE),
      document.fonts.load(
        `${selectedFont.boldWeight} ${fontSize}px ${activeFontFamily}`,
        ANSI_SAMPLE,
      ),
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
    const validationFailures = summarize(measurements);
    statusElement.textContent = `Complete · DPR ${devicePixelRatio} · font ${selectedFont.name} ${fontSize}px · contrast floor ${displayMinimumContrastRatio}`;
    window.__diagnosticReport = {
      devicePixelRatio,
      fontId: selectedFont.id,
      fontName: selectedFont.name,
      fontSize,
      displayMinimumContrastRatio,
      displayedThemeId: displayedTheme.id,
      displayedThemeColors: displayedTheme.colors,
      rendererColumns: TERMINAL_COLUMNS,
      rendererRows: ANSI_SAMPLE_LINES.length,
      normalReferenceStartRow: NORMAL_REFERENCE_START_ROW,
      normalReferenceRowCount: NORMAL_REFERENCE_ROW_COUNT,
      measurements,
      validationFailures,
    };
    window.__diagnosticReady = true;
  } catch (error) {
    statusElement.textContent = `Diagnostic failed: ${error instanceof Error ? error.message : String(error)}`;
    window.__diagnosticError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw error;
  } finally {
    runButton.disabled = false;
  }
};

runButton.addEventListener("click", () => void runDiagnostic());
void runDiagnostic();
