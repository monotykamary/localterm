import path from "node:path";
import { MAX_TERMINAL_BROWSER_FRAME_STREAM_BYTES } from "./constants.js";

export interface TerminalBrowserFrame {
  width: number;
  height: number;
  imageId: number;
  path: string;
}

// kitty "file" medium: the app transmits a base64 filesystem path by name and
// the terminal reads the pixels itself. terminal-browser writes
// <tmp>/terminal-browser-<pid>-<terminal-id>-<slot>.rgba for this.
const ESC = "\x1b";
const ESCAPE_START = ESC + "_";
const ESCAPE_END = ESC + "\\";
export const TERMINAL_BROWSER_FRAME_PATH_REGEX = /^terminal-browser-\d+-\d+-\d+\.rgba$/;

export function isTerminalBrowserFramePath(name: string, tmpdir: string): boolean {
  const resolved = path.resolve(name);
  const root = path.resolve(tmpdir) + path.sep;
  if (!resolved.startsWith(root)) return false;
  return TERMINAL_BROWSER_FRAME_PATH_REGEX.test(path.basename(resolved));
}

// Parses the body of a \x1b_G…\x1b\\ APC chunk into name-transmit metadata, or
// null when it isn't a kitty file-medium transmit. Exported for direct testing.
export function parseTerminalBrowserTransmit(
  body: string,
): { width: number; height: number; imageId: number; name: string } | null {
  const semi = body.indexOf(";");
  if (semi === -1) return null;
  const control = body.slice(0, semi);
  const payload = body.slice(semi + 1);
  const fields: Record<string, string> = {};
  for (const part of control.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if ((fields.a !== "T" && fields.a !== "t") || fields.t !== "f") return null;
  const width = Number(fields.s);
  const height = Number(fields.v);
  const imageId = Number(fields.i);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Number.isInteger(imageId) || imageId < 0) return null;
  return { width, height, imageId, name: Buffer.from(payload, "base64").toString("utf8") };
}

// Incremental scanner: PTY output arrives as many small data events, so a single
// \x1b_G…\x1b\\ APC can span several. Holds the incomplete tail until the
// terminator lands, then emits any complete frames. Non-frame APCs (inline
// transmits, sixel, other kitty actions) pass through untouched and are ignored.
export class TerminalBrowserFrameScanner {
  private partial = "";

  constructor(private readonly isAllowedPath: (name: string) => boolean) {}

  push(chunk: string): TerminalBrowserFrame[] {
    const buffer = this.partial + chunk;
    this.partial = "";
    const frames: TerminalBrowserFrame[] = [];
    let from = 0;
    while (from < buffer.length) {
      const start = buffer.indexOf(ESCAPE_START, from);
      if (start === -1) break;
      const end = buffer.indexOf(ESCAPE_END, start + ESCAPE_START.length);
      if (end === -1) {
        const tail = buffer.slice(start);
        if (tail.length <= MAX_TERMINAL_BROWSER_FRAME_STREAM_BYTES) this.partial = tail;
        break;
      }
      // An APC carries a single final byte after ESC _ ; the kitty graphics
      // protocol uses 'G', so the body here reads "Ga=…". Strip it so the
      // control data parses cleanly.
      let body = buffer.slice(start + ESCAPE_START.length, end);
      if (body.charCodeAt(0) === 0x47) body = body.slice(1);
      const parsed = parseTerminalBrowserTransmit(body);
      if (parsed && this.isAllowedPath(parsed.name)) {
        frames.push({
          width: parsed.width,
          height: parsed.height,
          imageId: parsed.imageId,
          path: parsed.name,
        });
      }
      from = end + ESCAPE_END.length;
    }
    return frames;
  }
}
