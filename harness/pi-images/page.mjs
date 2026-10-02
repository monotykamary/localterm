import { Terminal } from "/xterm.mjs";
import { ImageAddon } from "/addon-image.mjs";

export async function run() {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 50,
    rows: 24,
    fontSize: 14,
    fontFamily: "monospace",
    theme: { background: "#000000" },
  });
  const addon = new ImageAddon();
  terminal.loadAddon(addon);
  terminal.open(document.querySelector("#terminal"));
  globalThis.phase = "fonts";
  await document.fonts.ready;
  globalThis.phase = "initial animation frame";
  await new Promise(requestAnimationFrame);
  const cell = terminal._core._renderService.dimensions.css.cell;
  globalThis.phase = "fetch Pi frames";
  const frames = await (await fetch(`/frames?width=${cell.width}&height=${cell.height}`)).json();
  const receipts = [];
  try {
    for (const frame of frames) {
      terminal.resize(frame.columns, frame.rows);
      globalThis.phase = `${frame.name}: write`;
      await new Promise((resolve) => terminal.write(frame.bytes, resolve));
      globalThis.phase = `${frame.name}: render`;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = addon._renderer.canvas;
      const context = canvas?.getContext("2d");
      const scaleX = canvas ? canvas.width / (cell.width * terminal.cols) : 0;
      const scaleY = canvas ? canvas.height / (cell.height * terminal.rows) : 0;
      let samples = 0;
      const missing = [];
      for (const rect of frame.rectangles) {
        for (let row = 0; row < rect.rows; row++) {
          const x = Math.floor((rect.columns * cell.width * scaleX) / 2);
          const y = Math.floor((rect.row + row + 0.5) * cell.height * scaleY);
          const pixel = context?.getImageData(x, y, 1, 1).data;
          samples++;
          if (!pixel || pixel[0] + pixel[1] < 240 || pixel[2] > 20 || pixel[3] < 200)
            missing.push({ x, y, pixel: pixel ? [...pixel] : null });
        }
      }
      receipts.push({
        name: frame.name,
        samples,
        missing,
        images: frame.rectangles.length,
        cropped: frame.rectangles.some((rect) => rect.cropped),
        uploads: (frame.bytes.match(/a=T/g) ?? []).length,
        reuse: (frame.bytes.match(/a=p/g) ?? []).length,
      });
    }
    return { dpr: devicePixelRatio, cell, receipts };
  } finally {
    terminal.dispose();
  }
}

globalThis.run = run;
