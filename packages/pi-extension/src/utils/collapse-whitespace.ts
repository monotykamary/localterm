const WHITESPACE_RUN = /\s+/g;

// Collapse every run of whitespace (spaces, tabs, newlines) to a single space
// and strip the leading/trailing edges. The OSC 9 body sanitizer uses this to
// keep a notification on one visual line, and the agent-end excerpt uses it so
// truncation is measured against the final visible text rather than raw
// markdown, which may carry indentation and blank lines that would otherwise
// eat the character budget before any prose shows. Pure.
export const collapseWhitespace = (text: string): string =>
  text.replace(WHITESPACE_RUN, " ").trim();
