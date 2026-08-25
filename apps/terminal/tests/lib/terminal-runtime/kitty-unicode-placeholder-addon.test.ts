import { Terminal as XtermTerminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KITTY_UNICODE_PLACEHOLDER_CODE_POINT } from "../../../src/lib/constants";
import {
  kittyPlaceholderMetadataAt,
  type KittyBufferLine,
} from "../../../src/lib/terminal-runtime/kitty-unicode-placeholder-buffer";
import { KittyUnicodePlaceholderAddon } from "../../../src/lib/terminal-runtime/kitty-unicode-placeholder-addon";
import type { KittyImageSource } from "../../../src/lib/terminal-runtime/kitty-unicode-placeholder-types";
import type { KittyGraphicsCommand } from "../../../src/utils/parse-kitty-graphics-command";

const ESC = "\x1b";
const PLACEHOLDER = String.fromCodePoint(KITTY_UNICODE_PLACEHOLDER_CODE_POINT);
const ROW_0 = "\u0305";
const ROW_1 = "\u030d";
const HIGH_2 = "\u030e";

interface InternalTerminal extends XtermTerminal {
  _core: {
    buffer: {
      lines: { get(index: number): KittyBufferLine | undefined };
      ybase: number;
    };
  };
}

const write = (terminal: XtermTerminal, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));

const source = (close = vi.fn()): KittyImageSource => ({
  close,
  height: 2,
  source: {} as CanvasImageSource,
  width: 2,
});

const lineAt = (terminal: XtermTerminal, row: number): KittyBufferLine | undefined =>
  (terminal as InternalTerminal)._core.buffer.lines.get(row);

const loadImage = async (
  terminal: XtermTerminal,
  imageId: number,
  placementId: number,
  columns = 3,
  rows = 2,
): Promise<void> => {
  await write(
    terminal,
    `${ESC}_Ga=T,f=100,q=2,U=1,i=${imageId},p=${placementId},c=${columns},r=${rows};AA==${ESC}\\`,
  );
};

describe("KittyUnicodePlaceholderAddon", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders combined transmit placements as blank metadata cells instead of tofu", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 20, rows: 4 });
    const decodeImage = vi.fn(async () => source());
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage });
    terminal.loadAddon(addon);
    const imageId = 0x123456;
    const placementId = 0x654321;

    await loadImage(terminal, imageId, placementId);
    await write(
      terminal,
      `${ESC}[38;2;18;52;86m${ESC}[58;2;101;67;33m${PLACEHOLDER}${ROW_0}${ROW_0}${PLACEHOLDER}${ROW_0}${ROW_1}${ESC}[39;59mend`,
    );

    expect(decodeImage).toHaveBeenCalledOnce();
    expect(addon.imageCount).toBe(1);
    expect(addon.placementCount).toBe(1);
    expect(terminal.buffer.active.getLine(0)?.translateToString(false)).not.toContain(PLACEHOLDER);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)).toEqual({
      imageColumn: 0,
      imageId,
      imageRow: 0,
      placementId,
    });
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 1)).toEqual({
      imageColumn: 1,
      imageId,
      imageRow: 0,
      placementId,
    });
    terminal.dispose();
  });

  it("supports chunked image.nvim transmission and inherited placeholder columns", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 20, rows: 4 });
    const payloads: string[] = [];
    const decodeImage = vi.fn(async (_command: KittyGraphicsCommand, payload: string) => {
      payloads.push(payload);
      return source();
    });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage });
    terminal.loadAddon(addon);

    await write(terminal, `${ESC}_Ga=t,f=100,q=2,U=1,i=42,m=1;AA${ESC}\\`);
    await write(terminal, `${ESC}_Gm=0;==${ESC}\\`);
    await write(terminal, `${ESC}_Ga=p,q=2,U=1,i=42,p=7,c=3,r=2,C=1${ESC}\\`);
    await write(
      terminal,
      `${ESC}[38;5;42m${PLACEHOLDER}${ROW_1}${ROW_0}${PLACEHOLDER}${PLACEHOLDER}${ESC}[39m`,
    );

    expect(payloads).toEqual(["AA=="]);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)?.imageColumn).toBe(0);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 1)?.imageColumn).toBe(1);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 2)?.imageColumn).toBe(2);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 2)?.imageRow).toBe(1);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 2)?.placementId).toBe(0);
    terminal.dispose();
  });

  it("completes split diacritics and the high image-id byte across writes", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source() });
    terminal.loadAddon(addon);
    const imageId = 42 + 2 * 0x1000000;

    await loadImage(terminal, imageId, 1, 1, 1);
    await write(terminal, `${ESC}[38;5;42m${PLACEHOLDER}`);
    await write(terminal, ROW_0 + ROW_0 + HIGH_2);

    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)).toEqual({
      imageColumn: 0,
      imageId,
      imageRow: 0,
      placementId: 0,
    });
    terminal.dispose();
  });

  it("moves metadata with inserted cells and removes it on text overwrite", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source() });
    terminal.loadAddon(addon);

    await loadImage(terminal, 9, 9, 1, 1);
    await write(terminal, `${ESC}[38;5;9m${PLACEHOLDER}${ROW_0}${ROW_0}${ESC}[39m`);
    await write(terminal, `${ESC}[1G${ESC}[@`);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)).toBeUndefined();
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 1)?.imageId).toBe(9);

    await write(terminal, `${ESC}[2GX`);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 1)).toBeUndefined();
    terminal.dispose();
  });

  it("keeps placeholder metadata through scrollback and isolates alternate buffers", async () => {
    const terminal = new XtermTerminal({
      allowProposedApi: true,
      cols: 10,
      rows: 2,
      scrollback: 20,
    });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source() });
    terminal.loadAddon(addon);

    await loadImage(terminal, 15, 1, 1, 1);
    await write(terminal, `${ESC}[38;5;15m${PLACEHOLDER}${ROW_0}${ROW_0}${ESC}[39m`);
    await write(terminal, "\r\nsecond\r\nthird");
    expect((terminal as InternalTerminal)._core.buffer.ybase).toBeGreaterThan(0);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)?.imageId).toBe(15);

    await write(
      terminal,
      `${ESC}[?1049h${ESC}[H${ESC}[38;5;15m${PLACEHOLDER}${ROW_0}${ROW_0}${ESC}[39m`,
    );
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)?.imageId).toBe(15);
    await write(terminal, `${ESC}[?1049l`);
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 0)?.imageId).toBe(15);
    terminal.dispose();
  });

  it("tracks independent rows and columns in multi-row placements", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 4 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source() });
    terminal.loadAddon(addon);

    await loadImage(terminal, 21, 2, 2, 2);
    await write(
      terminal,
      `${ESC}[38;5;21m${PLACEHOLDER}${ROW_0}${ROW_0}${PLACEHOLDER}${ROW_0}${ROW_1}\r\n${PLACEHOLDER}${ROW_1}${ROW_0}${PLACEHOLDER}${ROW_1}${ROW_1}${ESC}[39m`,
    );

    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 0), 1)).toMatchObject({
      imageColumn: 1,
      imageRow: 0,
    });
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 1), 0)).toMatchObject({
      imageColumn: 0,
      imageRow: 1,
    });
    expect(kittyPlaceholderMetadataAt(lineAt(terminal, 1), 1)).toMatchObject({
      imageColumn: 1,
      imageRow: 1,
    });
    terminal.dispose();
  });

  it("keeps ordinary Kitty commands on the existing addon path", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const decodeImage = vi.fn(async () => source());
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage });
    terminal.loadAddon(addon);

    await write(terminal, `${ESC}_Ga=T,f=100,i=3;AA==${ESC}\\`);

    expect(decodeImage).not.toHaveBeenCalled();
    expect(addon.imageCount).toBe(0);
    terminal.dispose();
  });

  it("applies virtual placement deletion and reset lifetime rules", async () => {
    const close = vi.fn();
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source(close) });
    terminal.loadAddon(addon);

    await loadImage(terminal, 11, 4, 1, 1);
    await write(terminal, `${ESC}_Ga=d,d=i,i=11,p=4,q=2${ESC}\\`);
    expect(addon.imageCount).toBe(1);
    expect(addon.placementCount).toBe(0);

    await write(terminal, `${ESC}_Ga=p,U=1,i=11,p=5,c=1,r=1,q=2${ESC}\\`);
    await write(terminal, `${ESC}_Ga=d,d=I,i=11,p=5,q=2${ESC}\\`);
    expect(addon.imageCount).toBe(0);
    expect(close).toHaveBeenCalledOnce();

    await loadImage(terminal, 12, 1, 1, 1);
    await write(terminal, `${ESC}c`);
    expect(addon.imageCount).toBe(0);
    expect(close).toHaveBeenCalledTimes(2);
    terminal.dispose();
  });

  it("replaces image data atomically and clears stale virtual placements", async () => {
    const firstClose = vi.fn();
    const replacementClose = vi.fn();
    const decodeImage = vi.fn(async () => source(replacementClose));
    decodeImage.mockResolvedValueOnce(source(firstClose));
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage });
    terminal.loadAddon(addon);

    await loadImage(terminal, 31, 4, 1, 1);
    await write(terminal, `${ESC}_Ga=t,f=100,q=2,U=1,i=31;AA==${ESC}\\`);

    expect(addon.imageCount).toBe(1);
    expect(addon.placementCount).toBe(0);
    expect(firstClose).toHaveBeenCalledOnce();
    terminal.dispose();
    expect(replacementClose).toHaveBeenCalledOnce();
  });

  it("aborts partial uploads and applies all-placement delete variants", async () => {
    const close = vi.fn();
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source(close) });
    terminal.loadAddon(addon);

    await write(terminal, `${ESC}_Ga=t,f=100,q=2,U=1,i=40,m=1;AA${ESC}\\`);
    await write(terminal, `${ESC}_Ga=d,d=A,q=2${ESC}\\`);
    await loadImage(terminal, 41, 1, 1, 1);
    await loadImage(terminal, 42, 1, 1, 1);
    await write(terminal, `${ESC}_Ga=d,d=a,q=2${ESC}\\`);

    expect(addon.imageCount).toBe(2);
    expect(addon.placementCount).toBe(0);
    await write(terminal, `${ESC}_Ga=d,d=A,q=2${ESC}\\`);
    expect(addon.imageCount).toBe(0);
    expect(close).toHaveBeenCalledTimes(2);
    terminal.dispose();
  });

  it("reports invalid virtual placements without swallowing later output", async () => {
    const terminal = new XtermTerminal({ allowProposedApi: true, cols: 10, rows: 2 });
    const addon = new KittyUnicodePlaceholderAddon({ decodeImage: async () => source() });
    terminal.loadAddon(addon);
    const responses: string[] = [];
    terminal.onData((data) => responses.push(data));

    await write(terminal, `${ESC}_Ga=p,U=1,i=99,p=1,c=1,r=1,q=0${ESC}\\after`);

    expect(responses.join("")).toContain("ENOENT:image not found");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("after");
    terminal.dispose();
  });
});
