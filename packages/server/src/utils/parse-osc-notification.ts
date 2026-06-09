// OSC 9 (Terminal Notification) format:
//   ESC ] 9 ; MESSAGE ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
//
// This parser scans a chunk of PTY output for all OSC 9 sequences in that
// chunk, returning the message strings in order. Unlike title/cwd where only
// the last value matters, each notification is independently meaningful.

const OSC9_PREFIX = "\x1b]9;";
const BEL = "\x07";
const ST = "\x1b\\";

export const parseOscNotificationsFromChunk = (data: string): string[] => {
  const notifications: string[] = [];
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC9_PREFIX, searchFrom);
    if (start === -1) break;

    const payloadStart = start + OSC9_PREFIX.length;
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
    if (payload) notifications.push(payload);

    searchFrom = payloadEnd + 1;
  }

  return notifications;
};
