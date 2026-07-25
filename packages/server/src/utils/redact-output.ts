import { REDACTION_MASK, REDACTION_MIN_VALUE_LENGTH } from "../constants.js";

// Redact exact known secret values from a complete, already-assembled text
// string (an automation's accumulated, ANSI-stripped output log). Operating on
// the final string — not a streaming pipe — means a value split across chunk
// reads cannot slip through: every value is matched whole, so no cross-chunk
// overlap tracking is needed (unlike a streaming redactor). Values below the
// length floor are skipped: a 2-3 char value would substring-match ordinary
// output everywhere. Longer values are scanned first so a short value that is a
// substring of a longer one does not mask the longer match before it runs. The
// fixed single-character mask avoids leaking a value's length.
export const redactText = (text: string, values: readonly string[]): string => {
  const applicable = values.filter((value) => value.length >= REDACTION_MIN_VALUE_LENGTH);
  if (applicable.length === 0) return text;
  const ordered = [...applicable].sort((valueA, valueB) => valueB.length - valueA.length);
  let redacted = text;
  for (const value of ordered) {
    if (!redacted.includes(value)) continue;
    redacted = redacted.split(value).join(REDACTION_MASK);
  }
  return redacted;
};
