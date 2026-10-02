import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const piRequire = createRequire(
  new URL("../../packages/pi-extension/package.json", import.meta.url),
);
const terminalRequire = createRequire(new URL("../../apps/terminal/package.json", import.meta.url));
const { TuiAltScreen, Image, Text, Spacer, setCapabilities, setCellDimensions } = await import(
  pathToFileURL(piRequire.resolve("@earendil-works/pi-tui")).href
);
const { default: sharp } = await import(pathToFileURL(terminalRequire.resolve("sharp")).href);

export async function frames(cellWidth, cellHeight) {
  setCapabilities({ images: "kitty", hyperlinks: true, trueColor: true });
  setCellDimensions({ widthPx: cellWidth, heightPx: cellHeight });
  delete process.env.WEZTERM_PANE;
  delete process.env.TERM_PROGRAM;
  const width = 32;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset + (y < height / 2 ? 0 : 1)] = 255;
      pixels[offset + 3] = 255;
    }
  }
  const png = (
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
  ).toString("base64");
  let output = "";
  const terminal = {
    columns: 50,
    rows: 24,
    write: (text) => {
      output += text;
    },
    start() {},
    stop() {},
    hideCursor() {},
    showCursor() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  for (let i = 0; i < 24; i++) {
    tui.addChild(new Text(`Image ${i + 1}`, 0, 0));
    tui.addChild(new Image(png, "image/png", { fallbackColor: (s) => s }, { maxWidthCells: 8 }));
    tui.addChild(new Spacer(1));
  }
  const result = [];
  const capture = (name, action) => {
    action();
    tui.renderNow();
    const rectangles = tui.getScreenLines().flatMap((line, row) => {
      const match = /\x1b_G([^;]+);/.exec(line);
      if (!match) return [];
      const controls = Object.fromEntries(match[1].split(",").map((pair) => pair.split("=")));
      return [
        {
          row,
          columns: Number(controls.c),
          rows: Number(controls.r),
          cropped: Boolean(controls.y || controls.h),
        },
      ];
    });
    result.push({
      name,
      bytes: output,
      columns: terminal.columns,
      rows: terminal.rows,
      rectangles,
    });
    output = "";
  };
  capture("initial", () => tui.start());
  capture("scroll-top", () => tui.scrollToTop());
  capture("partial-image", () => tui.scrollBy(4));
  capture("scroll-middle", () => tui.scrollBy(7));
  capture("scroll-bottom", () => tui.scrollToBottom());
  capture("resize", () => {
    terminal.columns = 44;
    terminal.rows = 20;
  });
  capture("forced-redraw", () => tui.renderNow(true));
  tui.stop({ preserveScreen: true });
  capture("reenter-alternate", () => tui.start());
  tui.stop({ preserveScreen: true });
  return result;
}
