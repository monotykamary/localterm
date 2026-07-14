// OSC 7777 (localterm foreground signal) format:
//   ESC ] 7777 ; fg ; <program token> ST  -> a foreground program (name token)
//   ESC ] 7777 ; fg-idle ST               -> back at the shell prompt (idle)
// where ST is BEL (0x07) or ESC \ (0x1b 0x5c).
//
// Emitted by the preexec/precmd hooks localterm installs into zsh/bash/fish
// (plus the initial-command eval hook), so the server learns the foreground
// state from the shell itself instead of polling pty.process. The token is
// the first word of the command line; it is sanitized here (cut at the first
// shell separator or control char, trimmed, length-capped) before emission.
//
// Returns the last signal in the chunk: a string (foreground), null (idle), or
// undefined (no foreground signal present). An incomplete OSC (terminator not
// yet in the chunk) yields undefined so the session's pendingParse buffer can
// hold it for the next chunk.

import { MAX_FOREGROUND_LENGTH } from "../constants.js";

const OSC_PREFIX = "\x1b]7777;";
const FG_PREFIX = "fg;";
const FG_IDLE = "fg-idle";
const BEL = "\x07";
const ST = "\x1b\\";

// Cut the token at the first shell metacharacter or C0 control char so a first
// word that still contains separators (the hook space-splits but a token like
// "a;b" can survive) can't leak past the program name. Char-code checks (not a
// control-char regex) keep eslint's no-control-regex quiet.
const isTokenCut = (ch: string): boolean => ";|&<>()".includes(ch) || ch.charCodeAt(0) < 0x20;

const sanitizeToken = (raw: string): string => {
  let cut = raw.length;
  for (let i = 0; i < raw.length; i++) {
    if (isTokenCut(raw[i])) {
      cut = i;
      break;
    }
  }
  return raw.slice(0, cut).trim().slice(0, MAX_FOREGROUND_LENGTH);
};

export const parseOscForegroundFromChunk = (data: string): string | null | undefined => {
  let result: string | null | undefined = undefined;
  let searchFrom = 0;

  while (searchFrom < data.length) {
    const start = data.indexOf(OSC_PREFIX, searchFrom);
    if (start === -1) break;

    const payloadStart = start + OSC_PREFIX.length;
    const belIndex = data.indexOf(BEL, payloadStart);
    const stIndex = data.indexOf(ST, payloadStart);

    let terminatorIndex = -1;
    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) terminatorIndex = belIndex;
    else if (stIndex !== -1) terminatorIndex = stIndex;
    if (terminatorIndex === -1) break;

    const payload = data.slice(payloadStart, terminatorIndex);
    if (payload === FG_IDLE) {
      result = null;
    } else if (payload.startsWith(FG_PREFIX)) {
      const token = sanitizeToken(payload.slice(FG_PREFIX.length));
      if (token) result = token;
    }

    searchFrom = terminatorIndex + 1;
  }

  return result;
};
