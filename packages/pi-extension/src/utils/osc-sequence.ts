import { NOTIFICATION_MAX_LENGTH } from "../constants.js";

const OSC9_PREFIX = "\x1b]9;";
const OSC9_BEL = "\x07";
const WHITESPACE_RUN = /\s+/g;

// A BEL in the body would terminate the OSC sequence early and leak the rest
// as visible garbage; an ESC would let the body forge an ST terminator. Other
// control chars (C0 0x00-0x1F + DEL 0x7F) render as noise in a desktop
// notification, so replace them all with spaces. Done as a code-point check
// rather than a control-char regex so eslint's no-control-regex rule stays
// clean (and so astral characters survive unsplit).
const isControlOrDel = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
};

// Build an OSC 9 "Terminal Notification" sequence (ESC ] 9 ; MESSAGE BEL)
// safe to write to a PTY the localterm daemon parses. Replaces control chars
// with spaces (then collapses whitespace and trims), and caps the body to
// `maxLength` UTF-16 code units. localterm's daemon slices any body past its
// own 1024-unit cap and can split a surrogate pair there; capping first keeps
// the emitted body within the daemon's limit. Pure: unit-testable without a
// TTY.
export const buildOsc9Sequence = (
  body: string,
  maxLength: number = NOTIFICATION_MAX_LENGTH,
): string => {
  const sanitized = Array.from(body, (char) => (isControlOrDel(char) ? " " : char)).join("");
  const cleaned = sanitized.replace(WHITESPACE_RUN, " ").trim();
  const capped = cleaned.slice(0, maxLength);
  return `${OSC9_PREFIX}${capped}${OSC9_BEL}`;
};
