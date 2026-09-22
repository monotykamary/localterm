import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

interface GlyphPoint {
  x: number;
  y: number;
}

interface GlyphBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface GlyphImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface GlyphAtlas {
  _config: {
    deviceCellWidth: number;
    deviceCellHeight: number;
    deviceCharWidth: number;
    deviceCharHeight: number;
    lineHeight: number;
  };
  _tmpCanvas: { width: number; height: number };
}

interface RasterizedGlyph {
  size: GlyphPoint;
  sizeClipSpace: GlyphPoint;
  offset: GlyphPoint;
}

type FindGlyphBounds = (
  this: GlyphAtlas,
  image: GlyphImage,
  bounds: GlyphBounds,
  scanWidth: number,
  restricted: boolean,
  custom: boolean,
  padding: number,
) => RasterizedGlyph;

const require = createRequire(import.meta.url);
const addonDirectory = dirname(require.resolve("@xterm/addon-webgl/package.json"));
const source = readFileSync(join(addonDirectory, "lib/addon-webgl.mjs"), "utf8");
const method = source.match(/^    _findGlyphBoundingBox\([^\n]*\) \{[\s\S]*?^    \}/m)?.[0];
if (!method) throw new Error("Patched xterm glyph bounds method was not found");
// The atlas is private; execute the installed method rather than copying its algorithm into tests.
const findGlyphBounds = runInNewContext(`({${method}})._findGlyphBoundingBox`) as FindGlyphBounds;

const createImage = (width: number, height: number, ink: GlyphBounds): GlyphImage => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = ink.top; y <= ink.bottom; y++) {
    for (let x = ink.left; x <= ink.right; x++) {
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return {
    width,
    height,
    data: new Proxy(data, {
      get(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          const index = Number(property);
          if (index >= target.length) throw new Error(`Out-of-bounds glyph pixel read: ${index}`);
          return target[index];
        }
        return Reflect.get(target, property, target);
      },
    }),
  };
};

const emptyBounds = (): GlyphBounds => ({ top: 0, left: 0, bottom: 0, right: 0 });

const fixtures = [
  {
    name: "single-pixel border at DPR 1",
    imageWidth: 22,
    imageHeight: 28,
    cellWidth: 7,
    cellHeight: 20,
    charHeight: 17,
    ink: { left: 4, right: 10, top: 14, bottom: 14 },
    offset: { x: 0, y: -8 },
  },
  {
    name: "thicker border at DPR 2",
    imageWidth: 42,
    imageHeight: 48,
    cellWidth: 15,
    cellHeight: 40,
    charHeight: 34,
    ink: { left: 4, right: 18, top: 23, bottom: 25 },
    offset: { x: 0, y: -16 },
  },
  {
    name: "vertical border touching the last image row",
    imageWidth: 22,
    imageHeight: 28,
    cellWidth: 7,
    cellHeight: 20,
    charHeight: 17,
    ink: { left: 7, right: 7, top: 4, bottom: 27 },
    offset: { x: -3, y: 2 },
  },
  {
    name: "wide glyph touching the last image column",
    imageWidth: 80,
    imageHeight: 28,
    cellWidth: 7,
    cellHeight: 20,
    charHeight: 17,
    ink: { left: 4, right: 79, top: 4, bottom: 20 },
    offset: { x: 0, y: 2 },
  },
];

describe("patched xterm glyph bounds", () => {
  it.each(fixtures)("scans the cropped image for $name", (fixture) => {
    const image = createImage(fixture.imageWidth, fixture.imageHeight, fixture.ink);
    const bounds = emptyBounds();
    const atlas: GlyphAtlas = {
      _config: {
        deviceCellWidth: fixture.cellWidth,
        deviceCellHeight: fixture.cellHeight,
        deviceCharWidth: fixture.cellWidth,
        deviceCharHeight: fixture.charHeight,
        lineHeight: 1.2,
      },
      _tmpCanvas: { width: 256, height: 128 },
    };
    const glyph = findGlyphBounds.call(atlas, image, bounds, image.width, false, true, 4);
    expect(bounds).toEqual(fixture.ink);
    expect(glyph.size).toEqual({
      x: fixture.ink.right - fixture.ink.left + 1,
      y: fixture.ink.bottom - fixture.ink.top + 1,
    });
    expect(glyph.sizeClipSpace).toEqual(glyph.size);
    expect(glyph.offset).toEqual(fixture.offset);
  });

  it("keeps restricted glyphs inside the cell rather than including outside ink", () => {
    const image = createImage(22, 28, { left: 0, right: 6, top: 0, bottom: 19 });
    image.data[(27 * image.width + 20) * 4 + 3] = 255;
    const bounds = emptyBounds();
    const atlas: GlyphAtlas = {
      _config: {
        deviceCellWidth: 7,
        deviceCellHeight: 20,
        deviceCharWidth: 7,
        deviceCharHeight: 17,
        lineHeight: 1.2,
      },
      _tmpCanvas: { width: 32, height: 40 },
    };
    const glyph = findGlyphBounds.call(atlas, image, bounds, image.width, true, true, 0);
    expect(bounds).toEqual({ left: 0, right: 6, top: 0, bottom: 19 });
    expect(glyph.size).toEqual({ x: 7, y: 20 });
    expect(glyph.offset).toEqual({ x: 0, y: 2 });
  });
});
