// OSC 7 (Set Working Directory) format:
//   ESC ] 7 ; file://HOST/PATH ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
// The path is URL-encoded (spaces = %20, etc.).
//
// This parser scans a chunk of PTY output for the last OSC 7 in that chunk,
// returning the decoded filesystem path (or null if none found).
// It is deliberately simple: we only care about the *most recent* OSC 7,
// and the sequences are short enough that they won't span huge buffers.

const OSC7_PREFIX = "\x1b]7;";
const BEL = "\x07";
const ST = "\x1b\\";

const extractPath = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
};

export const parseOsc7FromChunk = (data: string): string | null => {
  let searchFrom = 0;
  let lastResult: string | null = null;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC7_PREFIX, searchFrom);
    if (start === -1) break;

    const payloadStart = start + OSC7_PREFIX.length;
    const belIndex = data.indexOf(BEL, payloadStart);
    const stIndex = data.indexOf(ST, payloadStart);

    let payloadEnd: number;
    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
      payloadEnd = belIndex;
    } else if (stIndex !== -1) {
      payloadEnd = stIndex;
    } else {
      break;
    }

    const payload = data.slice(payloadStart, payloadEnd);
    const path = extractPath(payload);
    if (path) lastResult = path;

    searchFrom = payloadEnd + 1;
  }

  return lastResult;
};
