import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { describe, expect, it } from "vite-plus/test";
import { EmojiWidthUnicodeProvider } from "@/utils/emoji-width-unicode-provider";
import { isEmojiWideWidthOverride } from "@/utils/emoji-wide-width-overrides";
import { spacingCombiningMarkOverrideWidth } from "@/utils/spacing-combining-mark-overrides";
import { isZeroWidthOverride } from "@/utils/zero-width-overrides";

const extractWidth = (props: number): number => (props >> 1) & 0x3;
const extractShouldJoin = (props: number): boolean => (props & 1) !== 0;

const createRealProvider = (
  isNormalBufferActive: () => boolean = () => true,
): EmojiWidthUnicodeProvider => {
  const providers: Record<string, IUnicodeVersionProvider> = {};
  const fakeTerminal = {
    unicode: {
      register(provider: IUnicodeVersionProvider) {
        providers[provider.version] = provider;
      },
      activeVersion: "",
    },
  } as unknown as Terminal;
  new UnicodeGraphemesAddon().activate(fakeTerminal);
  const base = providers["15-graphemes"];
  if (!base) throw new Error("15-graphemes provider not registered");
  return new EmojiWidthUnicodeProvider(base, isNormalBufferActive);
};

// Sum a string's cell width the way UnicodeService.getStringCellWidth does, so
// base + combining-mark clusters reflect the provider's join decisions.
const clusterWidth = (provider: EmojiWidthUnicodeProvider, text: string): number => {
  let total = 0;
  let preceding = 0;
  for (const ch of text) {
    const props = provider.charProperties(ch.codePointAt(0) ?? 0, preceding);
    let width = extractWidth(props);
    if (extractShouldJoin(props)) width -= extractWidth(preceding);
    total += width;
    preceding = props;
  }
  return total;
};

describe("EmojiWidthUnicodeProvider", () => {
  const provider = createRealProvider();

  it("keeps Emoji_Presentation + EAW=Narrow symbols at width 1 to match app-side stringWidth", () => {
    // ⏺ ✔ ✘ ⚠ ☒ — Claude Code's TUI glyphs; Bun.stringWidth counts these as 1.
    for (const codepoint of [0x23fa, 0x2714, 0x2718, 0x26a0, 0x2612, 0x25fb, 0x25cb, 0x25cf]) {
      expect(provider.wcwidth(codepoint)).toBe(1);
      expect(extractWidth(provider.charProperties(codepoint, 0))).toBe(1);
    }
  });

  it("widens Emoji 14/15 symbols the bundled Unicode data under-counts", () => {
    // 🫠 🥹 🛟 🪩 🩷 — Bun.stringWidth and modern wcwidth count these as 2.
    for (const codepoint of [0x1fae0, 0x1f979, 0x1f6df, 0x1faa9, 0x1fa75]) {
      expect(provider.wcwidth(codepoint)).toBe(2);
      expect(extractWidth(provider.charProperties(codepoint, 0))).toBe(2);
    }
  });

  it("leaves variation selector-16 clustering intact", () => {
    const warning = provider.charProperties(0x26a0, 0);
    expect(extractWidth(warning)).toBe(1);
    const withVs16 = provider.charProperties(0xfe0f, warning);
    expect(extractWidth(withVs16)).toBe(2);
    expect(extractShouldJoin(withVs16)).toBe(true);
  });

  it("preserves the join bit when widening skin-tone modifiers after an emoji base", () => {
    const thumbsUp = provider.charProperties(0x1f44d, 0);
    const withTone = provider.charProperties(0x1f3fc, thumbsUp);
    expect(extractShouldJoin(withTone)).toBe(true);
    expect(extractWidth(withTone)).toBe(2);
  });

  it("delegates unlisted codepoints to the base provider", () => {
    expect(provider.wcwidth(0x61)).toBe(1); // a
    expect(provider.wcwidth(0x4e00)).toBe(2); // 一
    expect(provider.wcwidth(0x1f600)).toBe(2); // 😀 already wide in the base data
  });

  it("zeroes invisible format characters the bundled Unicode data counts as 1", () => {
    // ZWSP, BOM, soft hyphen, LRM/RLM, word joiner — Bun.stringWidth counts
    // these as 0; one of them inside an exactly-full line otherwise wraps it
    // a row early and desyncs every relative cursor move that follows.
    for (const codepoint of [0x200b, 0xfeff, 0x00ad, 0x200e, 0x200f, 0x2060, 0x2064]) {
      expect(provider.wcwidth(codepoint)).toBe(0);
      expect(extractWidth(provider.charProperties(codepoint, 0))).toBe(0);
    }
  });

  it("joins zeroed format characters into the preceding cell without advancing it", () => {
    // InputHandler.print advances the cursor for any non-joining codepoint
    // even at width 0, so the override must join and carry the cluster width.
    const letter = provider.charProperties(0x78, 0); // x
    const zwsp = provider.charProperties(0x200b, letter);
    expect(extractShouldJoin(zwsp)).toBe(true);
    expect(extractWidth(zwsp)).toBe(extractWidth(letter));
    const wide = provider.charProperties(0x4e00, 0); // 一
    const bomAfterWide = provider.charProperties(0xfeff, wide);
    expect(extractShouldJoin(bomAfterWide)).toBe(true);
    expect(extractWidth(bomAfterWide)).toBe(2);
  });

  it("keeps the zero-width override out of joining classes the base provider handles", () => {
    // ZWJ/ZWNJ and VS16 join into the preceding cluster; zeroing them here
    // would double-apply. They must not be in the override table.
    for (const codepoint of [0x200d, 0x200c, 0xfe0f]) {
      expect(isZeroWidthOverride(codepoint)).toBe(false);
    }
  });

  it("widens ideographic description characters added in Unicode 15.1", () => {
    for (const codepoint of [0x2ffc, 0x2fff, 0x31ef]) {
      expect(provider.wcwidth(codepoint)).toBe(2);
      expect(extractWidth(provider.charProperties(codepoint, 0))).toBe(2);
    }
  });

  it("keeps a line that stringWidth counts as exactly fitting on a single terminal row", () => {
    // Regression for the task-finish artifacting: Claude Code writes a line it
    // measured at exactly `cols` columns; an invisible char must not add a
    // 1-column overshoot that wraps it and shifts all later rows.
    const line = `${"x".repeat(40)}\u200b${"y".repeat(40)}`;
    let total = 0;
    let preceding = 0;
    for (const ch of line) {
      const props = provider.charProperties(ch.codePointAt(0) ?? 0, preceding);
      let width = extractWidth(props);
      if (extractShouldJoin(props)) {
        const prevWidth = extractWidth(preceding);
        total -= prevWidth;
        width = Math.max(width, prevWidth);
      }
      total += width;
      preceding = props;
    }
    expect(total).toBe(80);
  });

  it("matches Bun by giving non-Latin combining marks a spacing cell in the normal buffer", () => {
    // Bun.stringWidth counts these marks as a spacing column instead of joining;
    // Claude Code (normal buffer) lays text out that way, so the terminal must
    // too or its relative-cursor repaints drift and leave stale lines behind.
    const provider = createRealProvider(() => true);
    expect(clusterWidth(provider, "א֨")).toBe(2); // Hebrew alef + accent qadma
    expect(clusterWidth(provider, "اً")).toBe(2); // Arabic alef + fathatan
    expect(clusterWidth(provider, "е҈")).toBe(2); // Cyrillic + hundred-thousands sign
    expect(clusterWidth(provider, "が")).toBe(4); // か + combining voiced sound mark
  });

  it("leaves combining-mark joins intact in the alternate buffer for correct TUIs", () => {
    // vim/less/tmux run in the alternate buffer and measure these marks as
    // zero-width; the override must be suppressed there so they stay in sync.
    const provider = createRealProvider(() => false);
    expect(clusterWidth(provider, "א֨")).toBe(1);
    expect(clusterWidth(provider, "اً")).toBe(1);
    expect(clusterWidth(provider, "е҈")).toBe(1);
    expect(clusterWidth(provider, "が")).toBe(2);
  });

  it("never disturbs marks Bun already joins, keycaps, or emoji clustering", () => {
    // The override mirrors only the marks Bun mis-widths. Latin/Devanagari marks,
    // keycap sequences, skin tones and ZWJ emoji must stay width-correct in both
    // buffers.
    for (const isNormal of [true, false]) {
      const provider = createRealProvider(() => isNormal);
      expect(clusterWidth(provider, "é")).toBe(1); // é
      expect(clusterWidth(provider, "कि")).toBe(1); // Devanagari कि — Bun joins
      expect(clusterWidth(provider, "1️⃣")).toBe(2); // keycap 1️⃣
      expect(clusterWidth(provider, "\u{1f44d}\u{1f3fd}")).toBe(2); // 👍🏽
    }
  });
});

describe("isEmojiWideWidthOverride", () => {
  it("matches only the stale-narrow emoji ranges", () => {
    expect(isEmojiWideWidthOverride(0x1fae0)).toBe(true);
    expect(isEmojiWideWidthOverride(0x1f3fb)).toBe(true);
    expect(isEmojiWideWidthOverride(0x1faf8)).toBe(true);
    expect(isEmojiWideWidthOverride(0x2ffc)).toBe(true); // ⿼ Unicode 15.1 Wide
    expect(isEmojiWideWidthOverride(0x23fa)).toBe(false); // ⏺ must stay narrow
    expect(isEmojiWideWidthOverride(0x2714)).toBe(false); // ✔ must stay narrow
    expect(isEmojiWideWidthOverride(0x1f600)).toBe(false); // 😀 already wide
  });
});

describe("isZeroWidthOverride", () => {
  it("matches only invisible format characters the addon counts as 1", () => {
    expect(isZeroWidthOverride(0x200b)).toBe(true); // ZWSP
    expect(isZeroWidthOverride(0xfeff)).toBe(true); // BOM
    expect(isZeroWidthOverride(0x00ad)).toBe(true); // soft hyphen
    expect(isZeroWidthOverride(0xe0001)).toBe(true); // language tag
    expect(isZeroWidthOverride(0x20)).toBe(false); // space stays 1
    expect(isZeroWidthOverride(0x200d)).toBe(false); // ZWJ joins, not zeroed here
    expect(isZeroWidthOverride(0xfe0f)).toBe(false); // VS16 joins, not zeroed here
  });
});

describe("spacingCombiningMarkOverrideWidth", () => {
  it("returns 1 for non-Latin combining marks Bun counts as a spacing cell", () => {
    expect(spacingCombiningMarkOverrideWidth(0x05a8)).toBe(1); // Hebrew accent qadma
    expect(spacingCombiningMarkOverrideWidth(0x064b)).toBe(1); // Arabic fathatan
    expect(spacingCombiningMarkOverrideWidth(0x0488)).toBe(1); // Cyrillic hundred-thousands sign
    expect(spacingCombiningMarkOverrideWidth(0xff9e)).toBe(1); // halfwidth katakana voiced mark
    expect(spacingCombiningMarkOverrideWidth(0x11000)).toBe(1); // Brahmi sign (SMP range)
  });

  it("returns 2 for the CJK voiced/semi-voiced sound marks", () => {
    expect(spacingCombiningMarkOverrideWidth(0x3099)).toBe(2);
    expect(spacingCombiningMarkOverrideWidth(0x309a)).toBe(2);
  });

  it("returns 0 for marks Bun already joins, the keycap base, and ordinary text", () => {
    expect(spacingCombiningMarkOverrideWidth(0x0301)).toBe(0); // combining acute (Latin)
    expect(spacingCombiningMarkOverrideWidth(0x093f)).toBe(0); // Devanagari vowel sign i
    expect(spacingCombiningMarkOverrideWidth(0x20e3)).toBe(0); // keycap — must stay joined for 1️⃣
    expect(spacingCombiningMarkOverrideWidth(0xfe0f)).toBe(0); // VS16
    expect(spacingCombiningMarkOverrideWidth(0x41)).toBe(0); // A
    expect(spacingCombiningMarkOverrideWidth(0x4e00)).toBe(0); // 一
  });
});
