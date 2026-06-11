import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { describe, expect, it } from "vite-plus/test";
import { EmojiWidthUnicodeProvider } from "@/utils/emoji-width-unicode-provider";
import { isEmojiWideWidthOverride } from "@/utils/emoji-wide-width-overrides";

const extractWidth = (props: number): number => (props >> 1) & 0x3;
const extractShouldJoin = (props: number): boolean => (props & 1) !== 0;

const createRealProvider = (): EmojiWidthUnicodeProvider => {
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
  return new EmojiWidthUnicodeProvider(base);
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
});

describe("isEmojiWideWidthOverride", () => {
  it("matches only the stale-narrow emoji ranges", () => {
    expect(isEmojiWideWidthOverride(0x1fae0)).toBe(true);
    expect(isEmojiWideWidthOverride(0x1f3fb)).toBe(true);
    expect(isEmojiWideWidthOverride(0x1faf8)).toBe(true);
    expect(isEmojiWideWidthOverride(0x23fa)).toBe(false); // ⏺ must stay narrow
    expect(isEmojiWideWidthOverride(0x2714)).toBe(false); // ✔ must stay narrow
    expect(isEmojiWideWidthOverride(0x1f600)).toBe(false); // 😀 already wide
  });
});
