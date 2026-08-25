import {
  KITTY_GRAPHICS_FORMAT_PNG,
  KITTY_GRAPHICS_FORMAT_RGB,
  KITTY_GRAPHICS_FORMAT_RGBA,
  KITTY_GRAPHICS_MAX_DECODED_BYTES,
  KITTY_GRAPHICS_MAX_IMAGE_PIXELS,
  KITTY_GRAPHICS_RGB_CHANNELS,
  KITTY_GRAPHICS_RGBA_CHANNELS,
} from "@/lib/constants";
import type { KittyImageSource } from "@/lib/terminal-runtime/kitty-unicode-placeholder-types";
import type { KittyGraphicsCommand } from "@/utils/parse-kitty-graphics-command";
import { kittyIntegerControl } from "@/utils/parse-kitty-graphics-command";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_DIMENSION_OFFSET_BYTES = 16;
const PNG_DIMENSION_HEADER_BYTES = 24;

const decodeBase64 = (payload: string): Uint8Array => {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const decompressZlib = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const reader = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > KITTY_GRAPHICS_MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error("decompressed Kitty image exceeds the byte limit");
    }
    chunks.push(value);
  }
  const decompressed = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    decompressed.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decompressed;
};

const bitmapSource = async (source: ImageBitmapSource): Promise<KittyImageSource> => {
  const bitmap = await createImageBitmap(source);
  if (bitmap.width * bitmap.height > KITTY_GRAPHICS_MAX_IMAGE_PIXELS) {
    bitmap.close();
    throw new Error("Kitty image exceeds the pixel limit");
  }
  return {
    close: () => bitmap.close(),
    height: bitmap.height,
    source: bitmap,
    width: bitmap.width,
  };
};

const validatePngDimensions = (bytes: Uint8Array): void => {
  if (
    bytes.byteLength < PNG_DIMENSION_HEADER_BYTES ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("invalid Kitty PNG payload");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(PNG_DIMENSION_OFFSET_BYTES);
  const height = view.getUint32(PNG_DIMENSION_OFFSET_BYTES + Uint32Array.BYTES_PER_ELEMENT);
  if (width <= 0 || height <= 0 || width * height > KITTY_GRAPHICS_MAX_IMAGE_PIXELS) {
    throw new Error("Kitty PNG exceeds the pixel limit");
  }
};

const rawImage = async (
  bytes: Uint8Array,
  width: number,
  height: number,
  format: number,
): Promise<KittyImageSource> => {
  if (width <= 0 || height <= 0 || width * height > KITTY_GRAPHICS_MAX_IMAGE_PIXELS) {
    throw new Error("invalid Kitty raw image dimensions");
  }
  const channels =
    format === KITTY_GRAPHICS_FORMAT_RGB
      ? KITTY_GRAPHICS_RGB_CHANNELS
      : KITTY_GRAPHICS_RGBA_CHANNELS;
  const expectedBytes = width * height * channels;
  if (bytes.byteLength !== expectedBytes) throw new Error("invalid Kitty raw image byte length");

  let rgba: Uint8ClampedArray<ArrayBuffer>;
  if (format === KITTY_GRAPHICS_FORMAT_RGBA) {
    rgba = new Uint8ClampedArray(bytes.byteLength);
    rgba.set(bytes);
  } else {
    rgba = new Uint8ClampedArray(width * height * KITTY_GRAPHICS_RGBA_CHANNELS);
    for (
      let source = 0, destination = 0;
      source < bytes.length;
      source += KITTY_GRAPHICS_RGB_CHANNELS, destination += KITTY_GRAPHICS_RGBA_CHANNELS
    ) {
      rgba[destination] = bytes[source]!;
      rgba[destination + 1] = bytes[source + 1]!;
      rgba[destination + 2] = bytes[source + 2]!;
      rgba[destination + 3] = 0xff;
    }
  }
  return bitmapSource(new ImageData(rgba, width, height));
};

export const decodeKittyImage = async (
  command: KittyGraphicsCommand,
  encodedPayload: string,
): Promise<KittyImageSource> => {
  let bytes = decodeBase64(encodedPayload);
  if (bytes.byteLength > KITTY_GRAPHICS_MAX_DECODED_BYTES) {
    throw new Error("Kitty image exceeds the byte limit");
  }
  if (command.controls.o === "z") bytes = await decompressZlib(bytes);

  const parsedFormat = kittyIntegerControl(command, "f");
  const format = command.controls.f === undefined ? KITTY_GRAPHICS_FORMAT_RGBA : parsedFormat;
  if (format === KITTY_GRAPHICS_FORMAT_PNG) {
    validatePngDimensions(bytes);
    return bitmapSource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" }));
  }
  if (format !== KITTY_GRAPHICS_FORMAT_RGB && format !== KITTY_GRAPHICS_FORMAT_RGBA) {
    throw new Error("unsupported Kitty image format");
  }
  const width = kittyIntegerControl(command, "s");
  const height = kittyIntegerControl(command, "v");
  if (width === undefined || height === undefined) {
    throw new Error("Kitty raw image dimensions are required");
  }
  return rawImage(bytes, width, height, format);
};
