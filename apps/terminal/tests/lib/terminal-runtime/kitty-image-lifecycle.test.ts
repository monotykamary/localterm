import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ImageAddon } from "@xterm/addon-image";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ESC = "\x1b";
const apc = (controls: string, payload = ""): string =>
  `${ESC}_G${controls}${payload ? `;${payload}` : ""}${ESC}\\`;
const write = (terminal: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));

interface Bitmap {
  width: number;
  height: number;
  close: () => void;
}
interface InternalAddon {
  _storage: {
    _images: Map<number, unknown>;
    deleteImage: (id: number) => void;
    _evictOnAlternate: () => void;
  };
  _handlers: Map<
    string,
    {
      _kittyStorage: {
        images: ReadonlyMap<number, { data: Blob }>;
        getImage: (id: number) => unknown;
      };
    }
  >;
}

const require = createRequire(import.meta.url);
const cjsAddon: typeof ImageAddon = require("@xterm/addon-image").ImageAddon;
const esmUrl = new URL("./addon-image.mjs", pathToFileURL(require.resolve("@xterm/addon-image")))
  .href;
const { ImageAddon: esmAddon } = (await import(/* @vite-ignore */ esmUrl)) as {
  ImageAddon: typeof ImageAddon;
};

describe.each([
  ["ESM", esmAddon],
  ["CommonJS", cjsAddon],
] as const)("Kitty image lifecycle (%s)", (_name, Addon) => {
  const terminals: Terminal[] = [];
  beforeEach(() => {
    vi.stubGlobal("Blob", NodeBlob);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (source: Bitmap, ...args: unknown[]) => {
        const options = args[0] as { resizeWidth?: number; resizeHeight?: number } | undefined;
        return {
          width: args.length === 4 ? Number(args[2]) : (options?.resizeWidth ?? source.width),
          height: args.length === 4 ? Number(args[3]) : (options?.resizeHeight ?? source.height),
          close: vi.fn(),
        };
      }),
    );
  });
  afterEach(() => {
    for (const terminal of terminals.splice(0)) terminal.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const setup = () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 30, rows: 12 });
    terminals.push(terminal);
    const addon = new Addon({ sixelSupport: false, iipSupport: false });
    terminal.loadAddon(addon);
    const internal = addon as unknown as InternalAddon;
    const storage = internal._handlers.get("kitty")!._kittyStorage;
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));
    const upload = (id: number, display = true, placement = 0) =>
      write(
        terminal,
        apc(
          `a=${display ? "T" : "t"},f=32,s=1,v=1,i=${id},p=${placement},c=2,r=2,C=1,q=0`,
          "/wAA/w==",
        ),
      );
    const place = (id: number, placement = 0) =>
      write(terminal, apc(`a=p,i=${id},p=${placement},c=2,r=2,C=1,q=0`));
    return { terminal, addon, internal, storage, replies, upload, place };
  };

  it.each([false, true])(
    "reuses uploads after placement-only deletion (alternate=%s)",
    async (alternate) => {
      const h = setup();
      if (alternate) await write(h.terminal, `${ESC}[?1049h`);
      await h.upload(42);
      expect(h.internal._storage._images.size).toBe(1);
      await write(h.terminal, apc("a=d,d=a"));
      expect(h.storage.getImage(42)).toBeDefined();
      expect(h.internal._storage._images.size).toBe(0);
      await write(h.terminal, `${ESC}[2J${ESC}[H`);
      await h.place(42);
      expect(h.replies.at(-1)).toContain(";OK");
      expect(h.internal._storage._images.size).toBe(1);
      await write(h.terminal, apc("a=d,d=A"));
      expect(h.storage.getImage(42)).toBeUndefined();
      await h.place(42);
      expect(h.replies.at(-1)).toContain("ENOENT");
    },
  );

  it("keeps multiple images through Pi-style row clears and subsequent uploads", async () => {
    const h = setup();
    await write(h.terminal, `${ESC}[?1049h`);
    for (let id = 1; id <= 4; id++) {
      const row = (id - 1) * 3 + 1;
      await write(h.terminal, `${ESC}[${row};1H`);
      await h.upload(id);
      await write(h.terminal, `${ESC}[${row};1H${ESC}[2Ktext${ESC}[${row + 1};1H${ESC}[2K`);
    }
    h.internal._storage._evictOnAlternate();
    expect(h.internal._storage._images.size).toBe(4);
    expect(h.storage.images.size).toBe(4);
  });

  it("deletes only the specified placement, retaining data while another placement exists", async () => {
    const h = setup();
    await h.upload(42, true, 1);
    await write(h.terminal, `${ESC}[5;1H`);
    await h.place(42, 2);
    expect(h.internal._storage._images.size).toBe(2);
    await write(h.terminal, apc("a=d,d=I,i=42,p=1"));
    expect(h.storage.getImage(42)).toBeDefined();
    expect(h.internal._storage._images.size).toBe(1);
    await write(h.terminal, apc("a=d,d=i,i=42"));
    expect(h.storage.getImage(42)).toBeDefined();
    expect(h.internal._storage._images.size).toBe(0);
    await write(h.terminal, apc("a=d,d=I,i=42"));
    expect(h.storage.getImage(42)).toBeUndefined();
  });

  it("isolates normal and alternate uploads with the same id and clears alternate state on exit", async () => {
    const h = setup();
    await h.upload(42, false);
    const normal = h.storage.getImage(42);
    await write(h.terminal, `${ESC}[?1049h`);
    expect(h.storage.getImage(42)).toBeUndefined();
    await h.upload(42, false);
    expect(h.storage.getImage(42)).not.toBe(normal);
    await write(h.terminal, `${ESC}[?1049l`);
    expect(h.storage.getImage(42)).toBe(normal);
    await write(h.terminal, `${ESC}[?1049h`);
    expect(h.storage.images.size).toBe(0);
  });

  it("retains uploads when a decoded placement is evicted and clears them on reset", async () => {
    const h = setup();
    await h.upload(42);
    h.internal._storage.deleteImage([...h.internal._storage._images.keys()][0]!);
    expect(h.storage.getImage(42)).toBeDefined();
    await h.place(42);
    expect(h.replies.at(-1)).toContain(";OK");
    await write(h.terminal, `${ESC}c`);
    expect(h.storage.images.size).toBe(0);
  });

  it("does not delete normal-buffer scrollback placements with d=A", async () => {
    const h = setup();
    await h.upload(42);
    await write(h.terminal, `${ESC}[12;1H\n\n\n`);
    await h.upload(43);
    await write(h.terminal, apc("a=d,d=A"));
    expect(h.storage.getImage(42)).toBeDefined();
    expect(h.storage.getImage(43)).toBeUndefined();
    expect(h.internal._storage._images.size).toBe(1);
  });

  it("does not cancel a chunked upload when only placements are deleted", async () => {
    const h = setup();
    await write(h.terminal, apc("a=t,f=32,s=1,v=1,i=42,m=1", "/wAA"));
    await write(h.terminal, apc("a=d,d=a"));
    await write(h.terminal, apc("m=0", "/w=="));
    expect(h.storage.images.get(42)?.data.size).toBe(4);
    await h.place(42);
    expect(h.replies.at(-1)).toContain(";OK");
  });

  it("bounds retained upload count and bytes", async () => {
    const h = setup();
    for (let id = 1; id <= 260; id++) await h.upload(id, false);
    expect(h.storage.images.size).toBeLessThanOrEqual(256);
    expect(h.storage.getImage(1)).toBeUndefined();
    h.addon.storageLimit = 0.5;
    const payload = Buffer.alloc(300_000).toString("base64");
    for (const id of [300, 301])
      await write(h.terminal, apc(`a=t,f=32,s=75000,v=1,i=${id},q=0`, payload));
    expect(h.storage.getImage(301)).toBeDefined();
    expect(
      [...h.storage.images.values()].reduce((sum, image) => sum + image.data.size, 0),
    ).toBeLessThanOrEqual(500_000);
  });
});
