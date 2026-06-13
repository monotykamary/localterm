import type { IUnicodeVersionProvider } from "@xterm/xterm";
import { isEmojiWideWidthOverride } from "./emoji-wide-width-overrides";
import { spacingCombiningMarkOverrideWidth } from "./spacing-combining-mark-overrides";
import { isZeroWidthOverride } from "./zero-width-overrides";

// charProperties packs values as (charKind << 3) | (width << 1) | shouldJoin,
// matching UnicodeService.createPropertyValue in @xterm/xterm.
const WIDTH_BITS = 0b110;
const WIDTH_WIDE = 2 << 1;
const SHOULD_JOIN = 0b1;

/**
 * Wraps the "15-graphemes" provider and corrects only the codepoints where its
 * Unicode data disagrees with what TUI apps (Bun.stringWidth, modern wcwidth)
 * compute, so terminal wrapping stays in lockstep with app repaint math
 * during streaming: stale-narrow emoji ranges are widened to 2, and invisible
 * format characters (ZWSP, BOM, soft hyphen, …) are zeroed. Join and
 * char-kind bits pass through untouched, keeping grapheme clustering (VS16,
 * ZWJ, skin-tone joining) intact.
 *
 * One override is buffer-scoped: the non-Latin combining marks that
 * Bun.stringWidth counts as a spacing cell instead of joining (see
 * spacing-combining-mark-overrides). Claude Code lives in the normal screen
 * buffer and lays those marks out one column wider than xterm draws them, so
 * matching Bun there keeps its cursor math in sync. Full-screen TUIs (vim,
 * less, tmux) run in the alternate buffer and use correct wcwidth, so the
 * override is suppressed there via `isNormalBufferActive`, leaving their
 * combining-mark joins intact.
 */
export class EmojiWidthUnicodeProvider implements IUnicodeVersionProvider {
  public readonly version = "15-graphemes-emoji";

  private readonly base: IUnicodeVersionProvider;
  private readonly isNormalBufferActive: () => boolean;

  constructor(base: IUnicodeVersionProvider, isNormalBufferActive: () => boolean = () => true) {
    this.base = base;
    this.isNormalBufferActive = isNormalBufferActive;
  }

  public wcwidth(codepoint: number): 0 | 1 | 2 {
    if (isZeroWidthOverride(codepoint)) return 0;
    const spacingWidth = spacingCombiningMarkOverrideWidth(codepoint);
    if (spacingWidth !== 0 && this.isNormalBufferActive()) return spacingWidth;
    if (isEmojiWideWidthOverride(codepoint)) return 2;
    return this.base.wcwidth(codepoint);
  }

  public charProperties(codepoint: number, preceding: number): number {
    const props = this.base.charProperties(codepoint, preceding);
    if (isZeroWidthOverride(codepoint)) {
      // Encode like the addon encodes Extend combining marks: join into the
      // preceding cell and report the cluster's width (the preceding cell's).
      // InputHandler.print advances the cursor for any non-joining codepoint
      // even at width 0, so a bare width override would still eat a column.
      const precedingWidth = preceding & WIDTH_BITS;
      return (props & ~WIDTH_BITS) | precedingWidth | SHOULD_JOIN;
    }
    const spacingWidth = spacingCombiningMarkOverrideWidth(codepoint);
    if (spacingWidth !== 0 && this.isNormalBufferActive()) {
      // Match Bun: render the mark as its own spacing cell (charKind Other,
      // no join) of the given width, so the cluster occupies base + spacing
      // columns exactly as Claude measured it.
      return spacingWidth << 1;
    }
    if (!isEmojiWideWidthOverride(codepoint)) return props;
    return (props & ~WIDTH_BITS) | WIDTH_WIDE;
  }
}
