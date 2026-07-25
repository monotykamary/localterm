import { REDACTION_MASK, REDACTION_MIN_VALUE_LENGTH } from "../constants.js";

// Redact exact known secret values from a complete, already-assembled text
// string. Operating on the final string — not a streaming pipe — means a value
// split across chunk boundaries cannot slip through: every value is matched
// whole. Values below the length floor are skipped (a 2-3 char value would
// substring-match ordinary output everywhere); longer values are scanned first
// so a short value that is a substring of a longer one does not mask the longer
// match before it runs. The fixed single-character mask avoids leaking length.
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

// The longest suffix of `text` that is also a prefix of some redact value — or
// the whole value, when it sits complete at the end. That suffix could be the
// start of a value that continues in the next chunk, so a streaming redactor
// holds it back instead of emitting it (which would leak the value's leading
// characters before the full match arrives). The cap is value.length (not
// value.length - 1): with single-character length-changing masking and
// safe-slice-only redaction, a full value at the chunk boundary must be held
// entirely so its head never lands in the emitted safe region. (sigillo caps at
// value.length - 1 because it redacts the whole buffer in place with a
// length-preserving mask before splitting; this redactor redacts the safe
// slice only, so it must hold the full value.)
export const overlapTailLen = (text: string, values: readonly string[]): number => {
  let best = 0;
  for (const value of values) {
    if (value.length <= 1) continue;
    const maxOverlap = Math.min(text.length, value.length);
    for (let overlap = maxOverlap; overlap > best; overlap -= 1) {
      if (text.endsWith(value.slice(0, overlap))) {
        best = overlap;
        break;
      }
    }
  }
  return best;
};

export interface StreamingRedactor {
  push(chunk: string): string;
  finish(): string;
}

// Redact exact known secret values from a stream of text chunks, where a value
// can be split across two pushes. Each push accumulates into a pending buffer,
// holds back the overlap tail (the suffix that could be a value's start), and
// returns the redacted safe prefix. finish() flushes whatever remains (the tail
// is now known to be a complete-but-unmatched suffix, so it is safe to redact
// and emit). Returns pass-through closures when there is nothing to redact, so
// the common case (no secrets wired to pi) pays zero allocation per chunk.
export const createStreamingRedactor = (values: readonly string[]): StreamingRedactor => {
  const applicable = values.filter((value) => value.length >= REDACTION_MIN_VALUE_LENGTH);
  if (applicable.length === 0) {
    return { push: (chunk) => chunk, finish: () => "" };
  }
  let pending = "";
  return {
    push(chunk: string): string {
      pending += chunk;
      const safeLen = pending.length - overlapTailLen(pending, applicable);
      if (safeLen <= 0) return "";
      const safe = pending.slice(0, safeLen);
      pending = pending.slice(safeLen);
      return redactText(safe, applicable);
    },
    finish(): string {
      if (pending.length === 0) return "";
      const redacted = redactText(pending, applicable);
      pending = "";
      return redacted;
    },
  };
};
