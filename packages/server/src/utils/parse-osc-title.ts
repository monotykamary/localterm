// OSC 0 (Set Icon Name and Window Title) and OSC 2 (Set Window Title) format:
//   ESC ] 0 ; TITLE ST
//   ESC ] 2 ; TITLE ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
//
// This parser scans a chunk of PTY output for the last OSC 0/2 in that chunk,
// returning the title string (or null if none found).

const OSC0_PREFIX = "\x1b]0;";
const OSC2_PREFIX = "\x1b]2;";
const BEL = "\x07";
const ST = "\x1b\\";

interface OscTitleMatch {
  offset: number;
  title: string;
}

export const parseOscTitleFromChunk = (data: string): string | null => {
  const matches: OscTitleMatch[] = [];

  for (const prefix of [OSC0_PREFIX, OSC2_PREFIX]) {
    let searchFrom = 0;
    while (searchFrom < data.length) {
      const start = data.indexOf(prefix, searchFrom);
      if (start === -1) break;

      const payloadStart = start + prefix.length;
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
      if (payload) matches.push({ offset: start, title: payload });

      searchFrom = payloadEnd + 1;
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => a.offset - b.offset);
  return matches[matches.length - 1].title;
};
