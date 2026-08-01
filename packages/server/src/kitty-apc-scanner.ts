import { MAX_APC_BUFFER_BYTES } from "./constants.js";

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

export interface KittyApcScan {
  // The input with medium probes removed (they are answered by the daemon, so
  // leaking them to clients would race the terminal emulator's own reply).
  // Everything else — including the file-medium transmits themselves — passes
  // through verbatim.
  output: string;
  frames: KittyPixelFrame[];
  probes: KittyMediumProbe[];
  // The app left the alternate screen (1049/1047/47) or hard-reset (ESC c) —
  // any relayed pixel picture on screen is stale from this point on, so the
  // client must clear its overlay.
  screenReset: boolean;
}

const ESC = "\x1b";
const ESCAPE_START = ESC + "_";
const ESCAPE_END = ESC + "\\";
// The single final byte after ESC _ that identifies the kitty graphics protocol.
const APC_FINAL_KITTY = 0x47; // 'G'

// Screen-state transitions that invalidate an on-screen pixel picture: leaving
// the alternate screen restores the pre-app main buffer (fresh content under
// the overlay), and ESC c wipes the whole terminal state.
const SCREEN_RESET_SEQUENCES = ["\x1b[?1049l", "\x1b[?1047l", "\x1b[?47l", "\x1bc"];
// A reset sequence can straddle two PTY data events; carry enough of the
// previous chunk's tail to match any of them across the boundary.
const SCREEN_RESET_TAIL_BYTES = 7;

interface KittyFields {
  [key: string]: string;
}

const parseControl = (control: string): KittyFields => {
  const fields: KittyFields = {};
  for (const part of control.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
};

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const decodeName = (payload: string): string => Buffer.from(payload, "base64").toString("utf8");

type Classification =
  | { kind: "frame"; frame: KittyPixelFrame }
  | { kind: "probe"; probe: KittyMediumProbe }
  | { kind: "other" };

// Scans PTY output for kitty graphics APCs that use the file medium (t=f): the
// payload is a base64 filesystem path instead of inline pixel bytes. Detects:
//
//   1. Medium probes (a=q) — the app asking whether this terminal can read a
//      named frame file. These are stripped from the stream and answered by the
//      daemon so nothing else races an answer.
//   2. Named transmits (a=T / a=t) — the app saying "display the pixels in this
//      file". These pass through normally while the daemon relays the pixels
//      over the WS pixel-frame channel.
//
// PTY data arrives chunked, so an APC sequence can span multiple pushes; the
// incomplete tail is buffered until its ESC \\ terminator lands.
export class KittyApcScanner {
  private partial = "";
  private resetTail = "";

  constructor(private readonly isAllowedPath: (name: string) => boolean) {}

  push(chunk: string): KittyApcScan {
    const buffer = this.partial + chunk;
    this.partial = "";
    let output = "";
    const frames: KittyPixelFrame[] = [];
    const probes: KittyMediumProbe[] = [];
    const screenReset = this.detectScreenReset(buffer);
    let from = 0;
    while (from < buffer.length) {
      const start = buffer.indexOf(ESCAPE_START, from);
      if (start === -1) {
        output += buffer.slice(from);
        break;
      }
      output += buffer.slice(from, start);
      const end = buffer.indexOf(ESCAPE_END, start + ESCAPE_START.length);
      if (end === -1) {
        const tail = buffer.slice(start);
        if (tail.length <= MAX_APC_BUFFER_BYTES) {
          this.partial = tail;
        } else {
          output += tail;
        }
        break;
      }
      const after = end + ESCAPE_END.length;
      const classification = this.classify(buffer.slice(start + ESCAPE_START.length, end));
      if (classification.kind === "probe") {
        probes.push(classification.probe);
      } else {
        if (classification.kind === "frame") frames.push(classification.frame);
        output += buffer.slice(start, after);
      }
      from = after;
    }
    return { output, frames, probes, screenReset };
  }

  // Match reset sequences against the chunk plus the carried tail so a sequence
  // split across PTY reads still trips. Each push yields a single flag: multiple
  // resets in one push collapse, and a boundary match only fires on the later
  // push (the earlier one merely prepared the tail).
  private detectScreenReset(buffer: string): boolean {
    const hay = this.resetTail + buffer;
    this.resetTail = hay.slice(-SCREEN_RESET_TAIL_BYTES);
    for (const sequence of SCREEN_RESET_SEQUENCES) {
      if (hay.includes(sequence)) return true;
    }
    return false;
  }

  private classify(body: string): Classification {
    if (body.charCodeAt(0) !== APC_FINAL_KITTY) return { kind: "other" };
    const content = body.slice(1);
    const semi = content.indexOf(";");
    const control = semi === -1 ? content : content.slice(0, semi);
    const payload = semi === -1 ? "" : content.slice(semi + 1);
    const fields = parseControl(control);
    if (fields.t !== "f") return { kind: "other" };
    const path_ = decodeName(payload);
    if (!path_ || !this.isAllowedPath(path_)) return { kind: "other" };
    const imageId = toInt(fields.i);
    if (imageId === undefined || imageId < 0) return { kind: "other" };
    if (fields.a === "q") {
      return { kind: "probe", probe: { imageId, quiet: toInt(fields.q) ?? 0, path: path_ } };
    }
    if (fields.a === "T" || fields.a === "t") {
      const width = toInt(fields.s);
      const height = toInt(fields.v);
      const format = toInt(fields.f);
      // f=32 is the raw RGBA format the relay supports.
      if (!width || !height || width <= 0 || height <= 0 || format !== 32) return { kind: "other" };
      return { kind: "frame", frame: { width, height, imageId, path: path_ } };
    }
    return { kind: "other" };
  }
}
