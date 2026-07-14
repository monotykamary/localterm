// Heuristic for spotting a repo-relative file path inside a markdown inline
// code span (the agent log wraps the files it touches in backticks). Conservative
// on purpose: a path must be whitespace-free, stay under cwd (no leading slash,
// no "~", no ".." traversal), avoid URL/shell metacharacters, and its basename
// must carry a short extension — so directory names, shell flags, and npm
// commands don't turn into clickable preview triggers.
const PATH_BODY = /^[A-Za-z0-9._\-/]+$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const EXTENSION = /^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/;

export const isLikelyRelativePath = (token: string): boolean => {
  if (token.length === 0 || /\s/.test(token)) return false;
  if (token.startsWith("/") || token.startsWith("~") || token.includes("..")) return false;
  if (URL_SCHEME.test(token)) return false;
  if (!PATH_BODY.test(token)) return false;
  const basename = token.slice(token.lastIndexOf("/") + 1);
  return EXTENSION.test(basename);
};
