/**
 * Codepoints that Claude Code's width function (Bun.stringWidth) and modern
 * wcwidth tables measure as 2 columns, but the Unicode 15 data bundled with
 * @xterm/addon-unicode-graphemes measures as 1: emoji skin-tone modifiers and
 * symbols added in Emoji 14/15. When the terminal and the TUI app disagree on
 * width, the app's cursor-up repaints land on the wrong rows during streaming
 * and leave stale lines behind.
 *
 * Deliberately excluded: characters with Emoji_Presentation=true but
 * East_Asian_Width=Narrow (⏺ ✔ ✘ ⚠ ☒ …). Both Bun.stringWidth and the addon
 * agree those are 1 column; widening them desynchronizes the terminal from
 * the app and causes the exact artifacting it was meant to fix.
 */
const EMOJI_WIDE_WIDTH_OVERRIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2ffc, 0x2fff], // ideographic description characters (Unicode 15.1 made these Wide)
  [0x31ef, 0x31ef], // ideographic description character subtraction (Unicode 15.1 Wide)
  [0x1aff0, 0x1aff3], // Katakana Minnan tone letters (Unicode 14, EAW=Wide)
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b11f, 0x1b122], // archaic Hiragana/Katakana letters (Unicode 14, EAW=Wide)
  [0x1b132, 0x1b132], // Hiragana small ko (Unicode 15, EAW=Wide)
  [0x1b155, 0x1b155], // Katakana small ko (Unicode 15, EAW=Wide)
  [0x1f3fb, 0x1f3ff], // emoji skin-tone modifiers
  [0x1f6dc, 0x1f6df], // wireless, playground slide, wheel, ring buoy
  [0x1f7f0, 0x1f7f0], // heavy equals sign
  [0x1f979, 0x1f979], // face holding back tears
  [0x1f9cc, 0x1f9cc], // troll
  [0x1fa75, 0x1fa77], // light blue, grey, pink hearts
  [0x1fa7b, 0x1fa7c], // x-ray, crutch
  [0x1fa87, 0x1fa88], // maracas, flute
  [0x1faa9, 0x1faaf], // mirror ball … khanda
  [0x1fab7, 0x1fabd], // lotus … wing
  [0x1fabf, 0x1fabf], // goose
  [0x1fac3, 0x1fac5], // pregnant man, pregnant person, person with crown
  [0x1face, 0x1facf], // moose, donkey
  [0x1fad7, 0x1fadb], // pouring liquid … pea pod
  [0x1fae0, 0x1fae8], // melting face … shaking face
  [0x1faf0, 0x1faf8], // hand with index finger and thumb crossed … rightwards pushing hand
];

export const isEmojiWideWidthOverride = (codepoint: number): boolean => {
  if (codepoint < 0x2ffc || codepoint > 0x1faf8) return false;
  for (const [start, end] of EMOJI_WIDE_WIDTH_OVERRIDE_RANGES) {
    if (codepoint >= start && codepoint <= end) return true;
  }
  return false;
};
