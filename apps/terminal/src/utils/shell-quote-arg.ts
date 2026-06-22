// POSIX single-quote escaping: an embedded `'` becomes `'\''` (close, escape
// the literal, reopen) — the only way to embed a single quote inside a
// single-quoted string. Forcing single quotes (rather than relying on a shell
// builtin) keeps interpolation safe across sh/bash/zsh alike.
export const shellQuoteArg = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
