import type { TerminalTheme, ThemeColors } from "./terminal-themes.js";

export type ImportedThemeResult = { theme: TerminalTheme } | { error: string };

const colorKeysToTheme: Record<string, keyof ThemeColors> = {
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

// Build a TerminalTheme from a partial colors object, omitting any field that
// isn't a valid hex color so xterm falls back to its per-field defaults rather
// than rendering an invalid color string.
const buildFromColors = (
  name: string,
  source: string,
  colors: Record<string, unknown>,
): TerminalTheme => {
  const resolved: ThemeColors = {};
  for (const [key, value] of Object.entries(colors)) {
    const normalized = normalizeColor(value);
    if (normalized) Object.assign(resolved, { [key]: normalized });
  }
  return {
    id: generateThemeId(),
    name,
    source,
    colors: resolved,
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
  return { theme: buildFromColors(name, "imported", colors) };
};

// A tiny Apple-plist XML parser (dict / key / string / real / integer / true /
// false / array), enough for `.itermcolors` files. Node has no built-in XML DOM,
// and the plist grammar is a fixed, narrow subset, so a focused recursive-
// descent over a tag stream avoids pulling in an XML dependency. Returns the
// root value (a dict for a plist) or undefined when the document isn't a
// recognizable plist.
type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

interface OpenToken {
  kind: "open";
  tag: string;
}
interface CloseToken {
  kind: "close";
  tag: string;
}
interface SelfToken {
  kind: "self";
  tag: string;
}
interface TextToken {
  kind: "text";
  value: string;
}
type PlistToken = OpenToken | CloseToken | SelfToken | TextToken;

const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tokenizePlist = (xml: string): PlistToken[] => {
  const tokens: PlistToken[] = [];
  let index = 0;
  while (index < xml.length) {
    const char = xml[index];
    if (char === "<") {
      // Skip processing instructions (<?xml ...?>) and declarations (<!DOCTYPE ...>).
      if (xml.startsWith("<?", index)) {
        const end = xml.indexOf("?>", index + 2);
        index = end === -1 ? xml.length : end + 2;
        continue;
      }
      if (xml.startsWith("<!", index)) {
        const end = xml.indexOf(">", index + 2);
        index = end === -1 ? xml.length : end + 1;
        continue;
      }
      const close = xml.startsWith("</", index);
      const tagStart = index + (close ? 2 : 1);
      const tagEnd = xml.indexOf(">", tagStart);
      if (tagEnd === -1) break;
      let raw = xml.slice(tagStart, tagEnd).trim();
      const selfClose = raw.endsWith("/");
      if (selfClose) raw = raw.slice(0, -1).trim();
      // The tag name is the leading token; ignore any attributes (e.g.
      // <plist version="1.0">).
      const tagName = raw.split(/\s+/)[0];
      if (!tagName) {
        index = tagEnd + 1;
        continue;
      }
      if (close) tokens.push({ kind: "close", tag: tagName });
      else if (selfClose) tokens.push({ kind: "self", tag: tagName });
      else tokens.push({ kind: "open", tag: tagName });
      index = tagEnd + 1;
    } else {
      const nextTag = xml.indexOf("<", index);
      const sliceEnd = nextTag === -1 ? xml.length : nextTag;
      const value = decodeEntities(xml.slice(index, sliceEnd)).trim();
      if (value) tokens.push({ kind: "text", value });
      index = sliceEnd;
    }
  }
  return tokens;
};

const isCloseToken = (token: PlistToken | undefined, tag: string): boolean =>
  token !== undefined && token.kind === "close" && token.tag === tag;

const parsePlistValue = (tokens: PlistToken[], pos: number): [PlistValue | undefined, number] => {
  const token = tokens[pos];
  if (!token) return [undefined, pos];
  if (token.kind === "text") return [token.value, pos + 1];
  if (token.kind !== "open") return [undefined, pos + 1];
  const { tag } = token;
  let next = pos + 1;
  if (tag === "true" || tag === "false") {
    // <true/> and <false/> are self-closing; if an open form slips through,
    // consume to its close.
    if (isCloseToken(tokens[next], tag)) next += 1;
    return [tag === "true", next];
  }
  if (tag === "string" || tag === "real" || tag === "integer" || tag === "data" || tag === "date") {
    const textToken = tokens[next];
    const text = textToken?.kind === "text" ? textToken.value : "";
    if (textToken?.kind === "text") next += 1;
    if (isCloseToken(tokens[next], tag)) next += 1;
    if (tag === "real" || tag === "integer") {
      const numberValue = Number(text);
      return [Number.isFinite(numberValue) ? numberValue : undefined, next];
    }
    return [text, next];
  }
  if (tag === "array") {
    const values: PlistValue[] = [];
    while (next < tokens.length && !isCloseToken(tokens[next], "array")) {
      const [value, after] = parsePlistValue(tokens, next);
      if (after === next) {
        next += 1;
        continue;
      }
      if (value !== undefined) values.push(value);
      next = after;
    }
    if (isCloseToken(tokens[next], "array")) next += 1;
    return [values, next];
  }
  if (tag === "dict") {
    const dict: { [key: string]: PlistValue } = {};
    while (next < tokens.length && !isCloseToken(tokens[next], "dict")) {
      const keyToken = tokens[next];
      if (keyToken?.kind === "open" && keyToken.tag === "key") {
        const keyTextToken = tokens[next + 1];
        const keyText = keyTextToken?.kind === "text" ? keyTextToken.value : "";
        let keyEnd = next + 2;
        if (isCloseToken(tokens[keyEnd], "key")) keyEnd += 1;
        const [value, after] = parsePlistValue(tokens, keyEnd);
        if (keyText) dict[keyText] = value ?? "";
        next = after;
      } else {
        next += 1;
      }
    }
    if (isCloseToken(tokens[next], "dict")) next += 1;
    return [dict, next];
  }
  return [undefined, next];
};

const parsePlist = (xml: string): PlistValue | undefined => {
  const tokens = tokenizePlist(xml);
  // Find the <plist> root and parse its single value (a dict for .itermcolors).
  const plistOpen = tokens.findIndex((token) => token.kind === "open" && token.tag === "plist");
  if (plistOpen === -1) {
    // Some files omit the <plist> wrapper; parse the first value directly.
    const [value] = parsePlistValue(tokens, 0);
    return value;
  }
  const [value] = parsePlistValue(tokens, plistOpen + 1);
  return value;
};

// Read a 0–1 float component from an iTerm color dict and convert to a two-digit
// hex channel.
const channelHex = (colorDict: PlistValue, component: string): string | undefined => {
  if (!colorDict || typeof colorDict !== "object" || Array.isArray(colorDict)) return undefined;
  const value = (colorDict as { [key: string]: PlistValue })[component];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
};

const parseItermPlist = (text: string, filename: string | undefined): ImportedThemeResult => {
  const root = parsePlist(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { error: "Not a valid iTerm .itermcolors plist" };
  }
  const topDict = root as { [key: string]: PlistValue };
  const colors: ThemeColors = {};
  for (const [itermKey, themeKey] of Object.entries(colorKeysToTheme)) {
    const component = topDict[itermKey];
    const red = channelHex(component, "Red Component");
    const green = channelHex(component, "Green Component");
    const blue = channelHex(component, "Blue Component");
    if (red && green && blue) Object.assign(colors, { [themeKey]: `#${red}${green}${blue}` });
  }
  if (Object.keys(colors).length === 0) return { error: "No iTerm color entries found" };
  return {
    theme: {
      id: generateThemeId(),
      name: baseNameFrom(filename),
      source: "imported",
      colors,
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
