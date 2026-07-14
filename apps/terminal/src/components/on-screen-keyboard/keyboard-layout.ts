import { ImageIcon, Space, type LucideIcon } from "lucide-react";

export type SlideDirection =
  | "north"
  | "northEast"
  | "east"
  | "southEast"
  | "south"
  | "southWest"
  | "west"
  | "northWest";

export interface KeyGlyph {
  readonly label: string;
  readonly output: string;
  readonly name?: string;
  readonly icon?: LucideIcon;
}

interface CharKey {
  readonly type: "char";
  readonly icon?: LucideIcon;
  readonly center: KeyGlyph;
  readonly alternates?: Partial<Record<SlideDirection, KeyGlyph>>;
  readonly grow?: number;
}

export type SpecialAction =
  | "backspace"
  | "enter"
  | "shift"
  | "control"
  | "alternate"
  | "command"
  | "function"
  | "attach-image";

export interface SpecialKey {
  readonly type: "special";
  readonly action: SpecialAction;
  readonly label: string;
  readonly symbol?: string;
  readonly alternates?: Partial<Record<SlideDirection, KeyGlyph>>;
  readonly grow?: number;
}

export type KeyboardCell = CharKey | SpecialKey;

interface KeyboardRow {
  readonly cells: readonly KeyboardCell[];
}

export interface KeyboardLayout {
  readonly rows: readonly KeyboardRow[];
}

export type ModifierMode = "off" | "oneShot" | "locked";

export interface ModifierState {
  readonly shift: ModifierMode;
  readonly control: ModifierMode;
  readonly alternate: ModifierMode;
  readonly command: ModifierMode;
  readonly function: ModifierMode;
}

export const ALL_SLIDE_DIRECTIONS: readonly SlideDirection[] = [
  "north",
  "northEast",
  "east",
  "southEast",
  "south",
  "southWest",
  "west",
  "northWest",
];

const BACKSLASH = String.fromCharCode(92);
const SINGLE_QUOTE = String.fromCharCode(39);
const DOUBLE_QUOTE = String.fromCharCode(34);
const ESC = String.fromCharCode(27);
const TAB = String.fromCharCode(9);
const BACKTICK = String.fromCharCode(96);

const buildAlternates = (
  entries: Partial<Record<SlideDirection, string | KeyGlyph>>,
): Partial<Record<SlideDirection, KeyGlyph>> => {
  const result: Partial<Record<SlideDirection, KeyGlyph>> = {};
  for (const direction of ALL_SLIDE_DIRECTIONS) {
    const entry = entries[direction];
    if (entry == null) continue;
    result[direction] = typeof entry === "string" ? { label: entry, output: entry } : entry;
  }
  return result;
};

const char = (
  label: string,
  alternates?: Partial<Record<SlideDirection, string | KeyGlyph>>,
  grow?: number,
): CharKey => ({
  type: "char",
  center: { label, output: label },
  alternates: alternates ? buildAlternates(alternates) : undefined,
  grow,
});

const special = (
  action: SpecialAction,
  label: string,
  grow?: number,
  symbol?: string,
  alternates?: Partial<Record<SlideDirection, string | KeyGlyph>>,
): SpecialKey => ({
  type: "special",
  action,
  label,
  symbol,
  grow,
  alternates: alternates ? buildAlternates(alternates) : undefined,
});

const SPACE_KEY: CharKey = {
  type: "char",
  icon: Space,
  center: { label: "space", output: " " },
  alternates: {
    west: { label: "←", output: ESC + "[D" },
    north: { label: "↑", output: ESC + "[A" },
    east: { label: "→", output: ESC + "[C" },
    south: { label: "↓", output: ESC + "[B" },
  },
  grow: 4,
};

// qwerty + number row. Each key shows its center glyph and corner symbols;
// slide past the threshold toward a corner to type that symbol (Unexpected
// Keyboard's slide mechanic). Punctuation sits on the diagonal corners:
// ` ~ on 1; ( and - _ on 9, ) and = + on 0; [ ] { } on o (brackets open on
// the left, close on the right), \ | on p; ; : on k, ' " on l; , < on n,
// . > / ? on m. Shifted symbols sit on the top corners, unshifted on the
// bottom (shift = up). The alt face shows the macOS option glyph (⌥) and
// ctrl shows a chevron-up icon; both carry fn/cmd on their north-east swipe
// (the cmd corner is ⌘; popups are text — "command"/"fn"). Cardinal slides
// (up/down/left/right) are reserved for drag-to-correct — slide to a
// neighboring key before lifting to fix a mis-press. Space carries the
// arrows on its four edges.
export const qwertyLayout: KeyboardLayout = {
  rows: [
    {
      cells: [
        char("1", { northEast: "!", northWest: BACKTICK, southWest: "~" }),
        char("2", { northEast: "@" }),
        char("3", { northEast: "#" }),
        char("4", { northEast: "$" }),
        char("5", { northEast: "%" }),
        char("6", { northEast: "^" }),
        char("7", { northEast: "&" }),
        char("8", { northEast: "*" }),
        char("9", { northEast: "(", southEast: "-", northWest: "_" }),
        char("0", { northEast: ")", southEast: "=", northWest: "+" }),
      ],
    },
    {
      cells: [
        char("q", { northWest: { label: "⎋", output: ESC, name: "esc" } }),
        char("w"),
        char("e"),
        char("r"),
        char("t"),
        char("y"),
        char("u"),
        char("i"),
        char("o", { southWest: "[", southEast: "]", northWest: "{", northEast: "}" }),
        char("p", { southEast: BACKSLASH, northEast: "|" }),
      ],
    },
    {
      cells: [
        char("a", { northWest: { label: "⇥", output: TAB, name: "tab" } }),
        char("s"),
        char("d"),
        char("f"),
        char("g"),
        char("h"),
        char("j"),
        char("k", { southEast: ";", northEast: ":" }),
        char("l", { southEast: SINGLE_QUOTE, northEast: DOUBLE_QUOTE }),
      ],
    },
    {
      cells: [
        special("shift", "shift", 1.5, "⇧"),
        char("z"),
        char("x"),
        char("c"),
        char("v"),
        char("b"),
        char("n", { southWest: ",", northWest: "<" }),
        char("m", { southWest: ".", northWest: ">", southEast: "/", northEast: "?" }),
        special("backspace", "delete", 1.5),
      ],
    },
    {
      cells: [
        special("control", "ctrl", 1, undefined, {
          northEast: { label: "fn", output: "", name: "function" },
          southWest: { label: "image", output: "", name: "attach-image", icon: ImageIcon },
        }),
        special("alternate", "alt", 1, "⌥", {
          northEast: { label: "⌘", output: "", name: "command" },
        }),
        SPACE_KEY,
        special("enter", "return", 2),
      ],
    },
  ],
};
