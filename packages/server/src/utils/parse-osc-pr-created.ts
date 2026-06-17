// OSC 7777 (localterm pr-created signal) format:
//   ESC ] 7777 ; pr-created ; <pr url> ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
//
// Emitted by the injected shell `gh` wrapper when `gh pr create` exits 0,
// carrying the URL the CLI printed. The ambient PR overlay refreshes inline off
// it — no separate `gh pr list` round-trip — so a freshly-created PR surfaces
// the moment the CLI returns, before the toolbar lease would have re-polled.

import { MAX_PR_CREATED_URL_LENGTH } from "../constants.js";

const OSC_PR_CREATED_PREFIX = "\x1b]7777;pr-created;";
const BEL = "\x07";
const ST = "\x1b\\";

export const parseOscPrCreatedFromChunk = (data: string): string | null => {
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC_PR_CREATED_PREFIX, searchFrom);
    if (start === -1) return null;

    const payloadStart = start + OSC_PR_CREATED_PREFIX.length;
    const belIndex = data.indexOf(BEL, payloadStart);
    const stIndex = data.indexOf(ST, payloadStart);

    let terminatorIndex = -1;
    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) terminatorIndex = belIndex;
    else if (stIndex !== -1) terminatorIndex = stIndex;
    if (terminatorIndex === -1) return null;

    const payload = data.slice(payloadStart, terminatorIndex);
    if (payload.length >= 1 && payload.length <= MAX_PR_CREATED_URL_LENGTH) {
      return payload;
    }

    searchFrom = terminatorIndex + 1;
  }

  return null;
};
