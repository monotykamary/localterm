// Resolves human key names to the xterm escape bytes a real terminal sends,
// so an agent writes `press F2` / `press Escape : w q Enter` instead of
// `send-keys '\x1bOQ'`. Space-separated tokens: a known name maps to its byte
// sequence; an unknown token passes through as literal text so `press hello`
// types "hello" and `press :` sends a colon. Ctrl-<letter> (e.g. `Ctrl-C`,
// `C-c`) and a few common alt sequences are generated to avoid enumerating
// every combination.

const ESC = "\x1b";

const NAMED_KEYS: Record<string, string> = {
  Enter: "\r",
  Return: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Space: " ",
  Esc: ESC,
  Escape: ESC,
  Up: `${ESC}[A`,
  Down: `${ESC}[B`,
  Right: `${ESC}[C`,
  Left: `${ESC}[D`,
  Home: `${ESC}[H`,
  End: `${ESC}[F`,
  PageUp: `${ESC}[5~`,
  PageDown: `${ESC}[6~`,
  Insert: `${ESC}[2~`,
  Delete: `${ESC}[3~`,
  F1: `${ESC}OP`,
  F2: `${ESC}OQ`,
  F3: `${ESC}OR`,
  F4: `${ESC}OS`,
  F5: `${ESC}[15~`,
  F6: `${ESC}[17~`,
  F7: `${ESC}[18~`,
  F8: `${ESC}[19~`,
  F9: `${ESC}[20~`,
  F10: `${ESC}[21~`,
  F11: `${ESC}[23~`,
  F12: `${ESC}[24~`,
};

const ctrlByte = (letter: string): string | null => {
  if (letter.length !== 1) return null;
  const lower = letter.toLowerCase();
  if (lower < "a" || lower > "z") return null;
  return String.fromCharCode(lower.charCodeAt(0) - "a".charCodeAt(0) + 1);
};

// Resolve one token to its byte sequence, or null when it names no key and
// should pass through as literal text. `Ctrl-X` / `C-x` → the control byte;
// `M-x` / `Alt-x` → ESC + x (the xterm meta prefix).
const resolveToken = (token: string): string | null => {
  const named = NAMED_KEYS[token];
  if (named !== undefined) return named;

  const ctrlMatch = /^(?:Ctrl|C)-(.+)$/.exec(token);
  if (ctrlMatch) {
    const byte = ctrlByte(ctrlMatch[1]);
    if (byte !== null) return byte;
    return null;
  }
  const metaMatch = /^(?:M|Alt)-(.+)$/.exec(token);
  if (metaMatch && metaMatch[1].length === 1) {
    return ESC + metaMatch[1];
  }
  return null;
};

// Resolve a space-separated key string into the raw bytes to write to the PTY.
// Known names map to their sequences; unknown tokens pass through as literal
// text (so `press hello` types "hello"). A literal space can be sent as the
// `Space` name or by passing a single token containing one.
const resolveNamedKeys = (input: string): string => {
  const tokens = input.split(/\s+/).filter((token) => token.length > 0);
  let result = "";
  for (const token of tokens) {
    const resolved = resolveToken(token);
    result += resolved ?? token;
  }
  return result;
};

export { resolveNamedKeys, resolveToken };
