// OSC 7777 (localterm automation exit signal) format:
//   ESC ] 7777 ; automation-exit ; <decimal exit code> ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
//
// Emitted once by the shell hook injected into automation-run sessions, on the
// first prompt after the scheduled command finishes, carrying the command's
// exit status.

import { MAX_AUTOMATION_EXIT_CODE_DIGITS } from "../constants.js";

const OSC_AUTOMATION_EXIT_PREFIX = "\x1b]7777;automation-exit;";
const BEL = "\x07";
const ST = "\x1b\\";

export const parseOscAutomationExitFromChunk = (data: string): number | null => {
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC_AUTOMATION_EXIT_PREFIX, searchFrom);
    if (start === -1) return null;

    const payloadStart = start + OSC_AUTOMATION_EXIT_PREFIX.length;
    const belIndex = data.indexOf(BEL, payloadStart);
    const stIndex = data.indexOf(ST, payloadStart);

    let terminatorIndex = -1;
    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) terminatorIndex = belIndex;
    else if (stIndex !== -1) terminatorIndex = stIndex;
    if (terminatorIndex === -1) return null;

    const payload = data.slice(payloadStart, terminatorIndex);
    if (payload.length >= 1 && payload.length <= MAX_AUTOMATION_EXIT_CODE_DIGITS) {
      if (/^\d+$/.test(payload)) return Number.parseInt(payload, 10);
    }

    searchFrom = terminatorIndex + 1;
  }

  return null;
};
