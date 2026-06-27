/**
 * Build-time script: rasterizes public/icons/icon.svg into the PNG sizes the
 * PWA manifest references. The single SVG is the source of truth; run from
 * apps/terminal with `pnpm generate:icons` after editing the SVG.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// viewBox 0 0 24 24 at 2048 DPI yields a 512px canvas (24 / 96 * 2048); every
// target is downscaled from that so each size is crisp and identically composed.
const RASTER_DENSITY = 2048;
const BACKGROUND_HEX = "#f4f4f5";

const ICON_TARGETS = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(moduleDir, "..", "public", "icons");
const source = readFileSync(path.join(iconsDir, "icon.svg"));

const render = (size) =>
  sharp(source, { density: RASTER_DENSITY })
    .resize(size, size)
    .flatten({ background: BACKGROUND_HEX })
    .png();

const main = async () => {
  for (const { name, size } of ICON_TARGETS) {
    await render(size).toFile(path.join(iconsDir, name));
    console.log(`generated icons/${name} (${size}x${size})`);
  }
};

main();
