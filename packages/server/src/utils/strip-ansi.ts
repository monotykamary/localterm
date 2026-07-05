// Strips ANSI/VT escape sequences (CSI, OSC, nF, and single-char ESC) from PTY
// output so an automation run's captured log reads as plain text instead of
// raw escape codes. Also normalizes CRLF → LF and drops lone CRs (progress-bar
// carriage returns) so the log is line-based.
/* eslint-disable no-control-regex -- these regexes match ANSI/VT escape sequences, so control characters are intentional */
const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[A-Za-z]/g;
const NF_SEQUENCE = /\x1b[\x20-\x2f]+[0-9A-Za-z]/g;
const SINGLE_ESCAPES = /\x1b[=>78NMc-de]/g;
/* eslint-enable no-control-regex */

export const stripAnsi = (raw: string): string =>
  raw
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(NF_SEQUENCE, "")
    .replace(SINGLE_ESCAPES, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
