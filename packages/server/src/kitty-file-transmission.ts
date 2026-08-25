import fs from "node:fs/promises";
import path from "node:path";
import {
  KITTY_GRAPHICS_DIRECT_CHUNK_BYTES,
  KITTY_GRAPHICS_FORMAT_PNG,
  KITTY_GRAPHICS_FORMAT_RGB,
  KITTY_GRAPHICS_FORMAT_RGBA,
  KITTY_GRAPHICS_MAX_FILE_BYTES,
  KITTY_GRAPHICS_RGB_CHANNELS,
  KITTY_GRAPHICS_RGBA_CHANNELS,
  MAX_PIXEL_FRAME_PIXELS,
} from "./constants.js";
import type { KittyApcOutputPart, KittyFileTransmission } from "./kitty-apc-scanner.js";

const ESC = "\x1b";

const integerControl = (transmission: KittyFileTransmission, key: string): number | undefined => {
  const value = transmission.controls[key];
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const pngDimensions = (bytes: Uint8Array): { height: number; width: number } | undefined => {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const validatePayload = (transmission: KittyFileTransmission, bytes: Uint8Array): boolean => {
  if (transmission.controls.o === "z") return true;
  const parsedFormat = integerControl(transmission, "f");
  const format = transmission.controls.f === undefined ? KITTY_GRAPHICS_FORMAT_RGBA : parsedFormat;
  if (format === KITTY_GRAPHICS_FORMAT_PNG) {
    const dimensions = pngDimensions(bytes);
    return Boolean(
      dimensions &&
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      dimensions.width * dimensions.height <= MAX_PIXEL_FRAME_PIXELS,
    );
  }
  if (format !== KITTY_GRAPHICS_FORMAT_RGB && format !== KITTY_GRAPHICS_FORMAT_RGBA) {
    return false;
  }
  const width = integerControl(transmission, "s");
  const height = integerControl(transmission, "v");
  if (!width || !height || width <= 0 || height <= 0) return false;
  if (width * height > MAX_PIXEL_FRAME_PIXELS) return false;
  const channels =
    format === KITTY_GRAPHICS_FORMAT_RGB
      ? KITTY_GRAPHICS_RGB_CHANNELS
      : KITTY_GRAPHICS_RGBA_CHANNELS;
  return bytes.byteLength === width * height * channels;
};

const directControls = (transmission: KittyFileTransmission, more: number): string => {
  const controls: string[] = [];
  let hasMedium = false;
  for (const [key, value] of Object.entries(transmission.controls)) {
    if (key === "m" || key === "S" || key === "O") continue;
    if (key === "t") {
      controls.push("t=d");
      hasMedium = true;
    } else {
      controls.push(`${key}=${value}`);
    }
  }
  if (!hasMedium) controls.push("t=d");
  controls.push(`m=${more}`);
  return controls.join(",");
};

const encodeDirect = (transmission: KittyFileTransmission, bytes: Uint8Array): string => {
  const encoded = Buffer.from(bytes).toString("base64");
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += KITTY_GRAPHICS_DIRECT_CHUNK_BYTES) {
    chunks.push(encoded.slice(offset, offset + KITTY_GRAPHICS_DIRECT_CHUNK_BYTES));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks
    .map((chunk, index) => {
      const first = index === 0;
      const last = index === chunks.length - 1;
      const controls = first ? directControls(transmission, last ? 0 : 1) : `m=${last ? 0 : 1}`;
      return `${ESC}_G${controls};${chunk}${ESC}\\`;
    })
    .join("");
};

const readTransmission = async (
  transmission: KittyFileTransmission,
  tmpdirRoot: string,
): Promise<Uint8Array | undefined> => {
  const real = await fs.realpath(transmission.path);
  if (!real.startsWith(tmpdirRoot + path.sep)) return undefined;
  const stat = await fs.stat(real);
  if (!stat.isFile()) return undefined;

  const offset = integerControl(transmission, "O") ?? 0;
  const requestedSize = integerControl(transmission, "S");
  const size = requestedSize ?? stat.size - offset;
  if (
    offset < 0 ||
    size <= 0 ||
    size > KITTY_GRAPHICS_MAX_FILE_BYTES ||
    offset + size > stat.size
  ) {
    return undefined;
  }

  const handle = await fs.open(real, "r");
  try {
    const bytes = new Uint8Array(size);
    const { bytesRead } = await handle.read(bytes, 0, size, offset);
    return bytesRead === size ? bytes : undefined;
  } finally {
    await handle.close();
  }
};

export const expandKittyFileTransmission = async (
  transmission: KittyFileTransmission,
  tmpdirRoot: string,
): Promise<string> => {
  try {
    const bytes = await readTransmission(transmission, tmpdirRoot);
    if (!bytes || !validatePayload(transmission, bytes)) return transmission.original;
    return encodeDirect(transmission, bytes);
  } catch {
    return transmission.original;
  } finally {
    if (transmission.temporary) {
      try {
        const real = await fs.realpath(transmission.path);
        if (real.startsWith(tmpdirRoot + path.sep)) await fs.unlink(real);
      } catch {
        // The sender may remove a temporary file first; deletion is best-effort.
      }
    }
  }
};

export const expandKittyApcOutputParts = async (
  parts: readonly KittyApcOutputPart[],
  tmpdirRoot: string,
): Promise<string> => {
  const output: string[] = [];
  for (const part of parts) {
    output.push(
      part.kind === "text"
        ? part.text
        : await expandKittyFileTransmission(part.transmission, tmpdirRoot),
    );
  }
  return output.join("");
};
