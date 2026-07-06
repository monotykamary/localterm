import type { ITheme } from "@xterm/xterm";
import type { TerminalTheme } from "@/lib/terminal-themes";

export type ImportedThemeResult = { theme: TerminalTheme } | { error: string };

const colorKeysToTheme: Record<string, keyof ITheme> = {
  "Background Color": "background",
  "Foreground Color": "foreground",
  "Cursor Color": "cursor",
  "Cursor Text Color": "cursorAccent",
  "Selection Color": "selectionBackground",
  "Selected Text Color": "selectionForeground",
  "Ansi 0 Color": "black",
  "Ansi 1 Color": "red",
  "Ansi 2 Color": "green",
  "Ansi 3 Color": "yellow",
  "Ansi 4 Color": "blue",
  "Ansi 5 Color": "magenta",
  "Ansi 6 Color": "cyan",
  "Ansi 7 Color": "white",
  "Ansi 8 Color": "brightBlack",
  "Ansi 9 Color": "brightRed",
  "Ansi 10 Color": "brightGreen",
  "Ansi 11 Color": "brightYellow",
  "Ansi 12 Color": "brightBlue",
  "Ansi 13 Color": "brightMagenta",
  "Ansi 14 Color": "brightCyan",
  "Ansi 15 Color": "brightWhite",
};

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);

// Coerce a color value to a #rrggbb hex string. Accepts #rgb/#rrggbb/#rrggbbaa
// (alpha dropped — xterm colors are opaque) or null/undefined (field omitted).
const normalizeColor = (value: unknown): string | undefined => {
  if (!isHexColor(value)) return undefined;
  const hex = (value as string).slice(1);
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  return `#${hex.slice(0, 6)}`.toLowerCase();
};

const generateThemeId = (): string =>
  `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const baseNameFrom = (filename: string | undefined): string => {
  if (!filename) return "Imported theme";
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  return withoutExt || "Imported theme";
};

// Build a TerminalTheme from a partial ITheme colors object, omitting any field
// that isn't a valid hex color so xterm falls back to its per-field defaults
// rather than rendering an invalid color string.
const buildFromColors = (name: string, colors: Record<string, unknown>): TerminalTheme => {
  const resolved: Record<string, string> = {};
  for (const key of Object.keys(colors)) {
    const normalized = normalizeColor(colors[key]);
    if (normalized) resolved[key] = normalized;
  }
  return {
    id: generateThemeId(),
    name,
    source: "imported",
    colors: resolved as unknown as ITheme,
  };
};

const parseJsonTheme = (text: string, filename: string | undefined): ImportedThemeResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) return { error: "Not a JSON object" };
  const obj = parsed as Record<string, unknown>;
  // Accept either { name?, colors: {...} } (the TerminalTheme shape, minus the
  // generated id/source) or a bare colors object (the xterm ITheme) so a user
  // can paste either form.
  const colors = (obj.colors && typeof obj.colors === "object" ? obj.colors : obj) as Record<
    string,
    unknown
  >;
  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : baseNameFrom(filename);
  if (!colors || typeof colors !== "object") return { error: "No color fields found" };
  return { theme: buildFromColors(name, colors) };
};

// Read a `<real>`/`<integer>`/`<string>` value from an iTerm color component dict
// and convert the 0–1 float to a two-digit hex channel.
const channelHex = (colorDict: Element, component: string): string | undefined => {
  const keyEl = Array.from(colorDict.children).find(
    (child) => child.tagName === "key" && child.textContent === component,
  );
  if (!keyEl) return undefined;
  const valueEl = keyEl.nextElementSibling;
  if (!valueEl) return undefined;
  const text = valueEl.textContent ?? "";
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
};

const parseItermPlist = (text: string, filename: string | undefined): ImportedThemeResult => {
  if (typeof DOMParser === "undefined") return { error: "XML parsing unavailable" };
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) return { error: "Not a valid iTerm .itermcolors plist" };
  // The top-level <plist><dict> holds alternating <key>/<dict> pairs.
  const topDict = doc.documentElement.querySelector("dict") ?? doc.documentElement;
  const colors: Record<string, string> = {};
  const children = Array.from(topDict.children);
  for (let index = 0; index < children.length - 1; index++) {
    const keyEl = children[index];
    if (keyEl.tagName !== "key") continue;
    const themeKey = keyEl.textContent ?? "";
    const mapped = colorKeysToTheme[themeKey];
    if (!mapped) continue;
    const colorDict = children[index + 1];
    if (!colorDict || colorDict.tagName !== "dict") continue;
    const red = channelHex(colorDict, "Red Component");
    const green = channelHex(colorDict, "Green Component");
    const blue = channelHex(colorDict, "Blue Component");
    if (red && green && blue) colors[mapped] = `#${red}${green}${blue}`;
  }
  if (Object.keys(colors).length === 0) return { error: "No iTerm color entries found" };
  return {
    theme: {
      id: generateThemeId(),
      name: baseNameFrom(filename),
      source: "imported",
      colors: colors as unknown as ITheme,
    },
  };
};

export const parseImportedTheme = (
  text: string,
  filename: string | undefined,
): ImportedThemeResult => {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Empty file" };
  // .itermcolors is an XML plist (starts with <?xml or <plist); anything else is
  // treated as JSON (the TerminalTheme / bare-colors shape).
  const looksLikeXml = /^<\?xml/.test(trimmed) || /^<plist/.test(trimmed);
  const isItermFile = filename ? /\.itermcolors$/i.test(filename) : false;
  if (looksLikeXml || isItermFile) return parseItermPlist(text, filename);
  return parseJsonTheme(text, filename);
};
