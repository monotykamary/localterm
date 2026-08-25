import {
  KITTY_GRAPHICS_FORMAT_PNG,
  KITTY_GRAPHICS_FORMAT_RGB,
  KITTY_GRAPHICS_FORMAT_RGBA,
  MAX_APC_BUFFER_BYTES,
} from "./constants.js";

export interface KittyPixelFrame {
  width: number;
  height: number;
  imageId: number;
  path: string;
}

export interface KittyMediumProbe {
  imageId: number;
  quiet: number;
  path: string;
}

export interface KittyFileTransmission {
  controls: Readonly<Record<string, string>>;
  original: string;
  path: string;
  temporary: boolean;
}

export type KittyApcOutputPart =
  | { kind: "file"; transmission: KittyFileTransmission }
  | { kind: "text"; text: string };

export interface KittyApcScan {
  output: string;
  outputParts: KittyApcOutputPart[];
  frames: KittyPixelFrame[];
  probes: KittyMediumProbe[];
  screenReset: boolean;
}

const ESC = "\x1b";
const ESCAPE_START = ESC + "_";
const ESCAPE_END = ESC + "\\";
const APC_FINAL_KITTY = 0x47;
const SCREEN_RESET_SEQUENCES = ["\x1b[?1049l", "\x1b[?1047l", "\x1b[?47l", "\x1bc"];
const SCREEN_RESET_TAIL_BYTES = 7;

interface KittyFields {
  [key: string]: string;
}

const parseControl = (control: string): KittyFields => {
  const fields: KittyFields = {};
  for (const part of control.split(",")) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    fields[part.slice(0, equals)] = part.slice(equals + 1);
  }
  return fields;
};

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const decodeName = (payload: string): string => Buffer.from(payload, "base64").toString("utf8");

type Classification =
  | { kind: "file"; transmission: Omit<KittyFileTransmission, "original"> }
  | { kind: "frame"; frame: KittyPixelFrame }
  | { kind: "probe"; probe: KittyMediumProbe }
  | { kind: "other" };

export class KittyApcScanner {
  private partial = "";
  private resetTail = "";

  constructor(private readonly isAllowedPath: (name: string) => boolean) {}

  push(chunk: string): KittyApcScan {
    const buffer = this.partial + chunk;
    this.partial = "";
    let output = "";
    const outputParts: KittyApcOutputPart[] = [];
    const frames: KittyPixelFrame[] = [];
    const probes: KittyMediumProbe[] = [];
    const screenReset = this.detectScreenReset(buffer);
    const appendText = (text: string): void => {
      if (!text) return;
      output += text;
      const previous = outputParts.at(-1);
      if (previous?.kind === "text") previous.text += text;
      else outputParts.push({ kind: "text", text });
    };

    let from = 0;
    while (from < buffer.length) {
      const start = buffer.indexOf(ESCAPE_START, from);
      if (start === -1) {
        appendText(buffer.slice(from));
        break;
      }
      appendText(buffer.slice(from, start));
      const end = buffer.indexOf(ESCAPE_END, start + ESCAPE_START.length);
      if (end === -1) {
        const tail = buffer.slice(start);
        if (tail.length <= MAX_APC_BUFFER_BYTES) this.partial = tail;
        else appendText(tail);
        break;
      }

      const after = end + ESCAPE_END.length;
      const original = buffer.slice(start, after);
      const classification = this.classify(buffer.slice(start + ESCAPE_START.length, end));
      if (classification.kind === "probe") {
        probes.push(classification.probe);
      } else if (classification.kind === "file") {
        const transmission = { ...classification.transmission, original };
        output += original;
        outputParts.push({ kind: "file", transmission });
      } else {
        if (classification.kind === "frame") frames.push(classification.frame);
        appendText(original);
      }
      from = after;
    }
    return { output, outputParts, frames, probes, screenReset };
  }

  private detectScreenReset(buffer: string): boolean {
    const haystack = this.resetTail + buffer;
    this.resetTail = haystack.slice(-SCREEN_RESET_TAIL_BYTES);
    return SCREEN_RESET_SEQUENCES.some((sequence) => haystack.includes(sequence));
  }

  private classify(body: string): Classification {
    if (body.charCodeAt(0) !== APC_FINAL_KITTY) return { kind: "other" };
    const content = body.slice(1);
    const semicolon = content.indexOf(";");
    const control = semicolon === -1 ? content : content.slice(0, semicolon);
    const payload = semicolon === -1 ? "" : content.slice(semicolon + 1);
    const fields = parseControl(control);
    if (fields.t !== "f" && fields.t !== "t") return { kind: "other" };
    const path = decodeName(payload);
    if (!path || !this.isAllowedPath(path)) return { kind: "other" };
    const imageId = toInt(fields.i);
    if (imageId === undefined || imageId <= 0) return { kind: "other" };
    if (fields.a === "q") {
      return {
        kind: "probe",
        probe: { imageId, quiet: toInt(fields.q) ?? 0, path },
      };
    }
    if (fields.a !== "T" && fields.a !== "t") return { kind: "other" };

    const width = toInt(fields.s);
    const height = toInt(fields.v);
    const parsedFormat = toInt(fields.f);
    const format = fields.f === undefined ? KITTY_GRAPHICS_FORMAT_RGBA : parsedFormat;
    if (
      fields.t === "f" &&
      fields.a === "T" &&
      fields.U !== "1" &&
      width !== undefined &&
      height !== undefined &&
      width > 0 &&
      height > 0 &&
      format === KITTY_GRAPHICS_FORMAT_RGBA
    ) {
      return { kind: "frame", frame: { width, height, imageId, path } };
    }
    if (
      format !== KITTY_GRAPHICS_FORMAT_RGB &&
      format !== KITTY_GRAPHICS_FORMAT_RGBA &&
      format !== KITTY_GRAPHICS_FORMAT_PNG
    ) {
      return { kind: "other" };
    }
    return {
      kind: "file",
      transmission: {
        controls: fields,
        path,
        temporary: fields.t === "t",
      },
    };
  }
}
