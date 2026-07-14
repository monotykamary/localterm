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
}

export interface CharKey {
  readonly type: "char";
  readonly center: KeyGlyph;
  readonly alternates?: Partial<Record<SlideDirection, KeyGlyph>>;
  readonly grow?: number;
}

export type SpecialAction =
  | "backspace"
  | "enter"
  | "tab"
  | "escape"
  | "space"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | "shift"
  | "control"
  | "alternate"
  | "systemKeyboard"
  | "dismiss";

export interface SpecialKey {
  readonly type: "special";
  readonly action: SpecialAction;
  readonly label: string;
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

const buildAlternates = (
  entries: Partial<Record<SlideDirection, string>>,
): Partial<Record<SlideDirection, KeyGlyph>> => {
  const result: Partial<Record<SlideDirection, KeyGlyph>> = {};
  for (const direction of ALL_SLIDE_DIRECTIONS) {
    const label = entries[direction];
    if (label != null) result[direction] = { label, output: label };
  }
  return result;
};

const char = (
  label: string,
  alternates?: Partial<Record<SlideDirection, string>>,
  grow?: number,
): CharKey => ({
  type: "char",
  center: { label, output: label },
  alternates: alternates ? buildAlternates(alternates) : undefined,
  grow,
});

const special = (action: SpecialAction, label: string, grow?: number): SpecialKey => ({
  type: "special",
  action,
  label,
  grow,
});

const SPACE_KEY: CharKey = {
  type: "char",
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
// symbol (Unexpected Keyboard's slide mechanic). Number-row shifted symbols
// sit at the top-right (northEast); shell punctuation sits at the bottom-right
// (southEast) where a thumb slides naturally. Space carries the arrows on its
// four edges.
export const qwertyLayout: KeyboardLayout = {
  rows: [
    {
      cells: [
        char("1", { northEast: "!" }),
        char("2", { northEast: "@" }),
        char("3", { northEast: "#" }),
        char("4", { northEast: "$" }),
        char("5", { northEast: "%" }),
        char("6", { northEast: "^" }),
        char("7", { northEast: "&" }),
        char("8", { northEast: "*" }),
        char("9", { northEast: "(" }),
        char("0", { northEast: ")" }),
      ],
    },
    {
      cells: [
        char("q", { southEast: "?" }),
        char("w", { southEast: "!" }),
        char("e", { southEast: "-" }),
        char("r", { southEast: "_" }),
        char("t", { southEast: "=" }),
        char("y", { southEast: "+" }),
        char("u", { southEast: "/" }),
        char("i", { southEast: BACKSLASH }),
        char("o", { southEast: "|" }),
        char("p", { southEast: "~" }),
      ],
    },
    {
      cells: [
        char("a", { southEast: ";" }),
        char("s", { southEast: ":" }),
        char("d", { southEast: SINGLE_QUOTE }),
        char("f", { southEast: DOUBLE_QUOTE }),
        char("g", { southEast: "," }),
        char("h", { southEast: "." }),
        char("j", { southEast: "<" }),
        char("k", { southEast: ">" }),
        char("l", { southEast: "]" }),
      ],
    },
    {
      cells: [
        char("z", { southEast: "[" }),
        char("x", { southEast: "{" }),
        char("c", { southEast: "}" }),
        char("v"),
        char("b"),
        char("n"),
        char("m"),
      ],
    },
    {
      cells: [
        special("control", "ctrl", 1.5),
        special("alternate", "alt", 1.5),
        special("shift", "shift", 1.5),
        special("escape", "esc", 1),
        special("tab", "tab", 1),
        SPACE_KEY,
        special("backspace", "⌫", 1.4),
        special("enter", "⏎", 1.4),
        special("systemKeyboard", "🌐", 1),
        special("dismiss", "⌄", 1),
      ],
    },
  ],
};
