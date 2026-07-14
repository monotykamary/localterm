import { Space, type LucideIcon } from "lucide-react";

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
}

export interface CharKey {
  readonly type: "char";
  readonly icon?: LucideIcon;
  readonly center: KeyGlyph;
  readonly alternates?: Partial<Record<SlideDirection, KeyGlyph>>;
  readonly grow?: number;
}

export type SpecialAction = "backspace" | "enter" | "shift" | "control" | "alternate";

export interface SpecialKey {
  readonly type: "special";
  readonly action: SpecialAction;
  readonly label: string;
  readonly symbol?: string;
  readonly grow?: number;
}

export type KeyboardCell = CharKey | SpecialKey;

export interface KeyboardRow {
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
): SpecialKey => ({
  type: "special",
  action,
  label,
  symbol,
  grow,
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
  grow: 5,
};

// qwerty + number row. Each key shows its center glyph and the corner symbols
// drawn around it; slide past the threshold toward a corner to type that
// symbol (Unexpected Keyboard's slide mechanic). Punctuation sits on the
// diagonal corners — number-row shifted symbols at northEast (shift = up), and
// the row-end clusters on the keys that physically hold them (`, ~ on 1; -, =,
// _ on 0; [, ], {, } on p; ;, :, ', " on l; ,, ., /, ? on m; \, |, <, > on n).
// Cardinal slides (up/down/left/right) are reserved for drag-to-correct —
// slide to a neighboring key before lifting to fix a mis-press. Space carries
// the arrows on its four edges.
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
        char("9", { northEast: "(" }),
        char("0", { northEast: ")", southEast: "-", southWest: "=", northWest: "_" }),
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
        char("o"),
        char("p", { northEast: "{", northWest: "}", southEast: "[", southWest: "]" }),
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
        char("k"),
        char("l", {
          northEast: SINGLE_QUOTE,
          northWest: DOUBLE_QUOTE,
          southEast: ";",
          southWest: ":",
        }),
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
        char("n", { northEast: "<", northWest: ">", southEast: BACKSLASH, southWest: "|" }),
        char("m", { northEast: "/", northWest: "?", southEast: ",", southWest: "." }),
        special("backspace", "delete", 1.5),
      ],
    },
    {
      cells: [
        special("control", "ctrl", 1),
        special("alternate", "alt", 1),
        SPACE_KEY,
        special("enter", "return", 2),
      ],
    },
  ],
};
