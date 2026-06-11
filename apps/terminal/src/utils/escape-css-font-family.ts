/**
 * Escape a font-family name for safe interpolation inside a double-quoted CSS
 * string. CSS string syntax requires `\` to be escaped as `\\` and the matching
 * quote (`"`) as `\"`. The order matters: escape backslashes first so we don't
 * double-escape the backslash we add for the quote.
 *
 * Most installed fonts have plain names, but user-configured font names from
 * settings can contain unusual characters — we can't trust the input.
 */
export const escapeCssFontFamily = (family: string): string =>
  family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
