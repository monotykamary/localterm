export interface SkillToken {
  slashIndex: number;
  endIndex: number;
  query: string;
}

const SKILL_PREFIX = "skill:";
export const SKILL_INVOCATION_PREFIX = `/${SKILL_PREFIX}`;

const isWhitespace = (char: string): boolean => /\s/.test(char);

// Find the slash-command token under the cursor: a "/" at the very start of
// the text (position 0), followed by a run of non-whitespace (the body, which
// may start with "skill:"). Matches pi's own expansion rule — it only expands
// /skill:name when the prompt message starts with it — so the menu can't insert
// a mid-prompt token that pi would pass through as literal text. The cursor
// must sit within that run for a token to be active. Returns the token's span
// + the body minus any leading "skill:" prefix (the filter query). The span
// always reaches the end of the run so inserting a skill replaces the whole
// typed token, leaving no fragment behind when the cursor is mid-token.
export const computeSkillToken = (value: string, cursor: number): SkillToken | null => {
  let index = cursor - 1;
  while (index >= 0) {
    const char = value[index];
    if (isWhitespace(char)) return null;
    if (char === "/") {
      if (index !== 0) return null;
      let end = index + 1;
      while (end < value.length && !isWhitespace(value[end])) end += 1;
      const body = value.slice(index + 1, end);
      const query = body.startsWith(SKILL_PREFIX) ? body.slice(SKILL_PREFIX.length) : body;
      return { slashIndex: index, endIndex: end, query };
    }
    index -= 1;
  }
  return null;
};
