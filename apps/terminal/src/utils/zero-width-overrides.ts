/**
 * Codepoints that Claude Code's width function (Bun.stringWidth) and modern
 * wcwidth tables measure as 0 columns, but the Unicode 15 data bundled with
 * @xterm/addon-unicode-graphemes measures as 1: invisible format characters
 * (soft hyphen, zero-width space, word joiners, BOM, bidi marks, Arabic
 * prepended signs, Unicode tags) plus combining marks added after the addon's
 * data was generated.
 *
 * These are the worst desync triggers because they are invisible: a single
 * U+200B inside a line that the app counted as exactly fitting makes the
 * terminal wrap it one row early, and every relative cursor move in the app's
 * diff renderer lands one row off from then on — stale toolbar fragments and
 * a cursor blinking at the pre-desync position. kitty, ghostty, tmux and
 * iTerm all give these 0 columns, which is why the artifacting only shows up
 * here.
 *
 * Deliberately excluded: C0/C1 controls (handled by the VT parser, never
 * reach width measurement), joining classes the base provider already merges
 * into the preceding cell (ZWJ, ZWNJ, VS16, Extend marks), and spacing
 * combining marks (Mc) — those disagree with Bun in every grapheme-clustering
 * terminal and can't be fixed by a width override alone.
 */
const ZERO_WIDTH_OVERRIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x0600, 0x0605], // Arabic prepended number signs
  [0x070f, 0x070f], // Syriac abbreviation mark
  [0x1ac1, 0x1ace], // combining diacritical marks extended (Unicode 14)
  [0x1dfa, 0x1dfa], // combining dot below left (Unicode 14)
  [0x200b, 0x200b], // zero width space
  [0x200e, 0x200f], // left-to-right / right-to-left marks
  [0x2060, 0x2064], // word joiner … invisible plus
  [0xfeff, 0xfeff], // zero width no-break space (BOM)
  [0xe0000, 0xe001f], // tags block prefix (language tag and friends)
];

const FIRST_ZERO_WIDTH_OVERRIDE = 0x00ad;
const LAST_ZERO_WIDTH_OVERRIDE = 0xe001f;

export const isZeroWidthOverride = (codepoint: number): boolean => {
  if (codepoint < FIRST_ZERO_WIDTH_OVERRIDE || codepoint > LAST_ZERO_WIDTH_OVERRIDE) return false;
  for (const [start, end] of ZERO_WIDTH_OVERRIDE_RANGES) {
    if (codepoint >= start && codepoint <= end) return true;
  }
  return false;
};
