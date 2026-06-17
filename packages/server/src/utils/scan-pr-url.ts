// Best-effort scan of recent PTY output for a freshly-printed GitHub PR URL, so
// the ambient overlay can warm when an agent (e.g. pi) creates a PR and echoes
// the URL without going through the interactive `gh` wrapper. Strips ANSI first
// so a URL colored or boxed by a TUI still matches.
//
// Returns every DISTINCT PR URL found in the chunk, in first-appearance order.
// The caller keeps a sliding window and only treats a window containing exactly
// one distinct URL as a creation signal — that suppresses `gh pr list`-style
// output (many URLs at once) while accepting a TUI that redraws one URL across
// several frames.

// Control chars as runtime values so the regex sources carry no literal control
// escapes (which would trip the no-control-regex lint rule).
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(7);
const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const ANSI_OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

const stripAnsi = (data: string): string => data.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "");

export const scanPrUrls = (data: string): string[] => {
  const matches = stripAnsi(data).match(PR_URL_RE);
  if (!matches) return [];
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const url of matches) {
    if (seen.has(url)) continue;
    seen.add(url);
    distinct.push(url);
  }
  return distinct;
};
