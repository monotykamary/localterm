// The built-in terminal theme catalog, shared by the daemon (storage +
// completion + the `localterm theme` CLI) and the browser terminal app. Lives
// in the server package so every surface reads one source of truth — the
// browser's `apps/terminal/src/lib/terminal-themes.ts` re-exports this.

// The color fields of a terminal theme, mirroring xterm's `ITheme` shape (all
// optional `#rrggbb` strings). Defined as a plain interface — NOT imported
// from `@xterm/xterm`/`@xterm/headless` — so the browser app can consume this
// module without resolving the server-only `@xterm/headless` types at
// type-check time. Structurally assignable to xterm's `ITheme` (every field is
// optional), so passing `theme.colors` to xterm APIs works unchanged.
export interface ThemeColors {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  selectionInactiveBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface TerminalTheme {
  id: string;
  name: string;
  source: string;
  colors: ThemeColors;
}

const VESPER: TerminalTheme = {
  id: "vesper",
  name: "Vesper",
  source: "raunofreiberg/vesper",
  colors: {
    background: "#101010",
    foreground: "#ffffff",
    cursor: "#ffc799",
    cursorAccent: "#101010",
    selectionBackground: "#2a2a2a",
    selectionForeground: "#ffffff",
    black: "#101010",
    red: "#ff8080",
    green: "#99ffe4",
    yellow: "#ffc799",
    blue: "#a0a0a0",
    magenta: "#ffc799",
    cyan: "#99ffe4",
    white: "#ffffff",
    brightBlack: "#505050",
    brightRed: "#ff9999",
    brightGreen: "#b3ffe4",
    brightYellow: "#ffd1a8",
    brightBlue: "#b0b0b0",
    brightMagenta: "#ffc799",
    brightCyan: "#66ddcc",
    brightWhite: "#ffffff",
  },
};

const DRACULA: TerminalTheme = {
  id: "dracula",
  name: "Dracula",
  source: "dracula/visual-studio-code",
  colors: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    selectionForeground: "#f8f8f2",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
};

const ONE_DARK_PRO: TerminalTheme = {
  id: "one-dark-pro",
  name: "One Dark Pro",
  source: "Binaryify/OneDark-Pro",
  colors: {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#abb2bf",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4452",
    selectionForeground: "#abb2bf",
    black: "#3f4451",
    red: "#e05561",
    green: "#8cc265",
    yellow: "#d18f52",
    blue: "#4aa5f0",
    magenta: "#c162de",
    cyan: "#42b3c2",
    white: "#d7dae0",
    brightBlack: "#4f5666",
    brightRed: "#ff616e",
    brightGreen: "#a5e075",
    brightYellow: "#f0a45d",
    brightBlue: "#4dc4ff",
    brightMagenta: "#de73ff",
    brightCyan: "#4cd1e0",
    brightWhite: "#e6e6e6",
  },
};

const MONOKAI: TerminalTheme = {
  id: "monokai",
  name: "Monokai",
  source: "vscode/extensions/theme-monokai",
  colors: {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "#878b91",
    selectionForeground: "#f8f8f2",
    black: "#333333",
    red: "#c4265e",
    green: "#86b42b",
    yellow: "#b3b42b",
    blue: "#6a7ec8",
    magenta: "#8c6bc8",
    cyan: "#56adbc",
    white: "#e3e3dd",
    brightBlack: "#666666",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#e2e22e",
    brightBlue: "#819aff",
    brightMagenta: "#ae81ff",
    brightCyan: "#66d9ef",
    brightWhite: "#f8f8f2",
  },
};

const TOKYO_NIGHT: TerminalTheme = {
  id: "tokyo-night",
  name: "Tokyo Night",
  source: "enkia/tokyo-night-vscode-theme",
  colors: {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#515c7e",
    selectionForeground: "#c0caf5",
    black: "#363b54",
    red: "#f7768e",
    green: "#73daca",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#787c99",
    brightBlack: "#363b54",
    brightRed: "#f7768e",
    brightGreen: "#73daca",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#acb0d0",
  },
};

const TOKYO_NIGHT_STORM: TerminalTheme = {
  id: "tokyo-night-storm",
  name: "Tokyo Night Storm",
  source: "enkia/tokyo-night-vscode-theme",
  colors: {
    background: "#24283b",
    foreground: "#a9b1d6",
    cursor: "#c0caf5",
    cursorAccent: "#24283b",
    selectionBackground: "#6f7bb6",
    selectionForeground: "#c0caf5",
    black: "#414868",
    red: "#f7768e",
    green: "#73daca",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#8089b3",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#73daca",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#a9b1d6",
  },
};

const TOKYO_NIGHT_DAY: TerminalTheme = {
  id: "tokyo-night-day",
  name: "Tokyo Night Day",
  source: "folke/tokyonight.nvim",
  colors: {
    background: "#e1e2e7",
    foreground: "#3760bf",
    cursor: "#3760bf",
    cursorAccent: "#e1e2e7",
    selectionBackground: "#99a7df",
    selectionForeground: "#3760bf",
    black: "#e9e9ed",
    red: "#f52a65",
    green: "#587539",
    yellow: "#8c6c3e",
    blue: "#2e7de9",
    magenta: "#9854f1",
    cyan: "#007197",
    white: "#6172b0",
    brightBlack: "#a1a6c5",
    brightRed: "#f52a65",
    brightGreen: "#587539",
    brightYellow: "#8c6c3e",
    brightBlue: "#2e7de9",
    brightMagenta: "#9854f1",
    brightCyan: "#007197",
    brightWhite: "#3760bf",
  },
};

const CATPPUCCIN_MOCHA: TerminalTheme = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  source: "catppuccin/wezterm + style-guide",
  colors: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#11111b",
    selectionBackground: "#585b70",
    selectionForeground: "#cdd6f4",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

const CATPPUCCIN_MACCHIATO: TerminalTheme = {
  id: "catppuccin-macchiato",
  name: "Catppuccin Macchiato",
  source: "catppuccin/wezterm + style-guide",
  colors: {
    background: "#24273a",
    foreground: "#cad3f5",
    cursor: "#f4dbd6",
    cursorAccent: "#181926",
    selectionBackground: "#5b6078",
    selectionForeground: "#cad3f5",
    black: "#494d64",
    red: "#ed8796",
    green: "#a6da95",
    yellow: "#eed49f",
    blue: "#8aadf4",
    magenta: "#f5bde6",
    cyan: "#8bd5ca",
    white: "#b8c0e0",
    brightBlack: "#5b6078",
    brightRed: "#ed8796",
    brightGreen: "#a6da95",
    brightYellow: "#eed49f",
    brightBlue: "#8aadf4",
    brightMagenta: "#f5bde6",
    brightCyan: "#8bd5ca",
    brightWhite: "#a5adcb",
  },
};

const CATPPUCCIN_FRAPPE: TerminalTheme = {
  id: "catppuccin-frappe",
  name: "Catppuccin Frappé",
  source: "catppuccin/wezterm + style-guide",
  colors: {
    background: "#303446",
    foreground: "#c6d0f5",
    cursor: "#f2d5cf",
    cursorAccent: "#232634",
    selectionBackground: "#626880",
    selectionForeground: "#c6d0f5",
    black: "#51576d",
    red: "#e78284",
    green: "#a6d189",
    yellow: "#e5c890",
    blue: "#8caaee",
    magenta: "#f4b8e4",
    cyan: "#81c8be",
    white: "#b5bfe2",
    brightBlack: "#626880",
    brightRed: "#e78284",
    brightGreen: "#a6d189",
    brightYellow: "#e5c890",
    brightBlue: "#8caaee",
    brightMagenta: "#f4b8e4",
    brightCyan: "#81c8be",
    brightWhite: "#a5adce",
  },
};

const NORD: TerminalTheme = {
  id: "nord",
  name: "Nord",
  source: "arcticicestudio/nord-visual-studio-code",
  colors: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    selectionForeground: "#eceff4",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
};

const GRUVBOX_DARK_MEDIUM: TerminalTheme = {
  id: "gruvbox-dark",
  name: "Gruvbox Dark (Medium)",
  source: "jdinhify/vscode-theme-gruvbox",
  colors: {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#504945",
    selectionForeground: "#ebdbb2",
    black: "#3c3836",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
};

const NIGHT_OWL: TerminalTheme = {
  id: "night-owl",
  name: "Night Owl",
  source: "sdras/night-owl-vscode-theme",
  colors: {
    background: "#011627",
    foreground: "#d6deeb",
    cursor: "#80a4c2",
    cursorAccent: "#011627",
    selectionBackground: "#1b90dd",
    selectionForeground: "#d6deeb",
    black: "#011627",
    red: "#ef5350",
    green: "#22da6e",
    yellow: "#c5e478",
    blue: "#82aaff",
    magenta: "#c792ea",
    cyan: "#21c7a8",
    white: "#ffffff",
    brightBlack: "#575656",
    brightRed: "#ef5350",
    brightGreen: "#22da6e",
    brightYellow: "#ffeb95",
    brightBlue: "#82aaff",
    brightMagenta: "#c792ea",
    brightCyan: "#7fdbca",
    brightWhite: "#ffffff",
  },
};

const GITHUB_DARK: TerminalTheme = {
  id: "github-dark",
  name: "GitHub Dark Default",
  source: "primer/github-vscode-theme + @primer/primitives",
  colors: {
    background: "#0d1117",
    foreground: "#e6edf3",
    cursor: "#e6edf3",
    cursorAccent: "#0d1117",
    selectionBackground: "#264f78",
    selectionForeground: "#e6edf3",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#ffffff",
  },
};

const SOLARIZED_DARK: TerminalTheme = {
  id: "solarized-dark",
  name: "Solarized Dark",
  source: "vscode/extensions/theme-solarized-dark",
  colors: {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#d30102",
    cursorAccent: "#002b36",
    selectionBackground: "#274642",
    selectionForeground: "#93a1a1",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

const AYU_MIRAGE: TerminalTheme = {
  id: "ayu-mirage",
  name: "Ayu Mirage",
  source: "ayu-theme/vscode-ayu",
  colors: {
    background: "#1f2430",
    foreground: "#cccac2",
    cursor: "#ffcc66",
    cursorAccent: "#1f2430",
    selectionBackground: "#34455a",
    selectionForeground: "#cccac2",
    black: "#171b24",
    red: "#f28273",
    green: "#87d96c",
    yellow: "#fcca60",
    blue: "#6acdff",
    magenta: "#ddbbff",
    cyan: "#93e2c8",
    white: "#c7c7c7",
    brightBlack: "#686868",
    brightRed: "#f28779",
    brightGreen: "#d5ff80",
    brightYellow: "#ffcd66",
    brightBlue: "#73d0ff",
    brightMagenta: "#dfbfff",
    brightCyan: "#95e6cb",
    brightWhite: "#ffffff",
  },
};

const SYNTHWAVE_84: TerminalTheme = {
  id: "synthwave-84",
  name: "SynthWave '84",
  source: "robb0wen/synthwave-vscode",
  colors: {
    background: "#262335",
    foreground: "#ffffff",
    cursor: "#03edf9",
    cursorAccent: "#262335",
    selectionBackground: "#463465",
    selectionForeground: "#ffffff",
    black: "#2a2139",
    red: "#fe4450",
    green: "#72f1b8",
    yellow: "#f3e70f",
    blue: "#03edf9",
    magenta: "#ff7edb",
    cyan: "#03edf9",
    white: "#ffffff",
    brightBlack: "#495495",
    brightRed: "#fe4450",
    brightGreen: "#72f1b8",
    brightYellow: "#fede5d",
    brightBlue: "#03edf9",
    brightMagenta: "#ff7edb",
    brightCyan: "#03edf9",
    brightWhite: "#ffffff",
  },
};

const GITHUB_LIGHT: TerminalTheme = {
  id: "github-light",
  name: "GitHub Light Default",
  source: "primer/github-vscode-theme + @primer/primitives",
  colors: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#044cbd",
    cursorAccent: "#ffffff",
    selectionBackground: "#0576cb",
    selectionForeground: "#ffffff",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
};

const SOLARIZED_LIGHT: TerminalTheme = {
  id: "solarized-light",
  name: "Solarized Light",
  source: "vscode/extensions/theme-solarized-light",
  colors: {
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#657b83",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#eee8d5",
    selectionForeground: "#657b83",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

const CATPPUCCIN_LATTE: TerminalTheme = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  source: "catppuccin/wezterm + style-guide",
  colors: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#acbdcf",
    selectionForeground: "#4c4f69",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#209fb5",
    white: "#bcc0cc",
    brightBlack: "#6c6f85",
    brightRed: "#d20f39",
    brightGreen: "#40a02b",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#ea76cb",
    brightCyan: "#209fb5",
    brightWhite: "#6c6f85",
  },
};

export const TERMINAL_THEMES: TerminalTheme[] = [
  VESPER,
  AYU_MIRAGE,
  CATPPUCCIN_FRAPPE,
  CATPPUCCIN_MACCHIATO,
  CATPPUCCIN_MOCHA,
  DRACULA,
  GITHUB_DARK,
  GRUVBOX_DARK_MEDIUM,
  MONOKAI,
  NIGHT_OWL,
  NORD,
  ONE_DARK_PRO,
  SOLARIZED_DARK,
  SYNTHWAVE_84,
  TOKYO_NIGHT,
  TOKYO_NIGHT_STORM,
  GITHUB_LIGHT,
  SOLARIZED_LIGHT,
  CATPPUCCIN_LATTE,
  TOKYO_NIGHT_DAY,
];

export const DEFAULT_TERMINAL_THEME_ID: string = VESPER.id;
export const DEFAULT_DARK_TERMINAL_THEME_ID: string = VESPER.id;
export const DEFAULT_LIGHT_TERMINAL_THEME_ID: string = GITHUB_LIGHT.id;

// A pseudo-theme id resolved by the browser to the user's selected light or
// dark theme based on the host color scheme.
export const AUTO_THEME_ID = "auto";

// The set of ids a user can select as the active theme: the built-ins plus the
// "auto" pseudo-id. Custom (imported) themes are added by the caller. Used by
// the daemon to validate PUT /api/themes/active and to complete `theme set`.
export const BUILTIN_THEME_IDS: readonly string[] = [
  AUTO_THEME_ID,
  ...TERMINAL_THEMES.map((theme) => theme.id),
];

export const isBuiltinThemeId = (id: string): boolean =>
  id === AUTO_THEME_ID || TERMINAL_THEMES.some((theme) => theme.id === id);

// Resolve a theme id against the built-ins plus any user-imported custom
// themes (kept in ~/.localterm/themes.json by the daemon). The auto id is
// handled by the caller (resolveAutoTheme) since it needs the live
// prefers-color-scheme; passing it here falls back to the default, which the
// caller never does.
export const findTerminalThemeById = (
  id: string | null | undefined,
  customThemes: readonly TerminalTheme[] = [],
): TerminalTheme => {
  if (!id) return VESPER;
  return (
    TERMINAL_THEMES.find((theme) => theme.id === id) ??
    customThemes.find((theme) => theme.id === id) ??
    VESPER
  );
};

export const resolveAutoTheme = (
  prefersDark: boolean,
  lightThemeId = DEFAULT_LIGHT_TERMINAL_THEME_ID,
  darkThemeId = DEFAULT_DARK_TERMINAL_THEME_ID,
  customThemes: readonly TerminalTheme[] = [],
): TerminalTheme => findTerminalThemeById(prefersDark ? darkThemeId : lightThemeId, customThemes);
