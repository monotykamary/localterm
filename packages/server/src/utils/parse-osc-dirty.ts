// OSC 7777 (localterm git-dirty signal) format:
//   ESC ] 7777 ; git-dirty ST
// where ST is either BEL (0x07) or ESC \ (0x1b 0x5c).
//
// The shell hook emits this on every prompt cycle (zsh precmd / bash
// PROMPT_COMMAND) so the server knows the working tree may have changed
// without polling. We only care whether the sequence is present, not its
// payload, but a named payload makes the wire protocol self-describing.

const OSC_DIRTY_PREFIX = "\x1b]7777;";
const BEL = "\x07";
const ST = "\x1b\\";

export const parseOscDirtyFromChunk = (data: string): boolean => {
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC_DIRTY_PREFIX, searchFrom);
    if (start === -1) return false;

    const payloadStart = start + OSC_DIRTY_PREFIX.length;
    const belIndex = data.indexOf(BEL, payloadStart);
    const stIndex = data.indexOf(ST, payloadStart);

    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) return true;
    if (stIndex !== -1) return true;

    searchFrom = payloadStart;
  }

  return false;
};
