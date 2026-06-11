import type { IUnicodeVersionProvider } from "@xterm/xterm";
import { isEmojiWideWidthOverride } from "./emoji-wide-width-overrides";

// charProperties packs values as (charKind << 3) | (width << 1) | shouldJoin,
// matching UnicodeService.createPropertyValue in @xterm/xterm.
const WIDTH_BITS = 0b110;
const WIDTH_WIDE = 2 << 1;

/**
 * Wraps the "15-graphemes" provider and widens only the codepoints where its
 * Unicode data lags behind what TUI apps (Bun.stringWidth, modern wcwidth)
 * compute, so terminal wrapping stays in lockstep with app repaint math
 * during streaming. Join and char-kind bits pass through untouched, keeping
 * grapheme clustering (VS16, ZWJ, skin-tone joining) intact.
 */
export class EmojiWidthUnicodeProvider implements IUnicodeVersionProvider {
  public readonly version = "15-graphemes-emoji";

  private readonly base: IUnicodeVersionProvider;

  constructor(base: IUnicodeVersionProvider) {
    this.base = base;
  }

  public wcwidth(codepoint: number): 0 | 1 | 2 {
    if (isEmojiWideWidthOverride(codepoint)) return 2;
    return this.base.wcwidth(codepoint);
  }

  public charProperties(codepoint: number, preceding: number): number {
    const props = this.base.charProperties(codepoint, preceding);
    if (!isEmojiWideWidthOverride(codepoint)) return props;
    return (props & ~WIDTH_BITS) | WIDTH_WIDE;
  }
}
