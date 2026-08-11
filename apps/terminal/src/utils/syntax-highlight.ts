import { SYNTAX_HIGHLIGHT_MAX_SOURCE_CHARS } from "@/lib/constants";
import { getDiffFileContents, peekDiffFileContents } from "./diff-file-contents";
import {
  buildDocumentTokenTargets,
  buildFragmentTokenTargets,
  type DiffLineTokenTarget,
} from "./diff-line-token-targets";
import type { GitDiffQuery } from "./fetch-git-diff";
import { parseUnifiedDiff, type DiffHunk } from "./parse-unified-diff";
import {
  buildSyntaxTokenCacheKey,
  readSyntaxTokenCache,
  requestSyntaxTokens,
} from "./syntax-token-manager";
import type { SyntaxDocuments, SyntaxTokenCacheEntry } from "./syntax-token-manager";

export interface SyntaxToken {
  content: string;
  color: string;
  fontStyle: number;
}

export interface SyntaxLine {
  tokens: readonly SyntaxToken[];
}

export type SyntaxHighlightColorScheme = "dark" | "light";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyw: "python",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  json: "json",
  jsonc: "jsonc",
  json5: "jsonc",
  md: "markdown",
  mdx: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "shellscript",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  svg: "xml",
};

const FILENAME_TO_LANG: Record<string, string> = {
  Dockerfile: "docker",
  Makefile: "make",
};

const detectLangId = (filePath: string): string | null => {
  const lastSlash = filePath.lastIndexOf("/");
  const basename = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);

  const filenameLang = FILENAME_TO_LANG[basename];
  if (filenameLang) return filenameLang;

  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const extension = basename.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[extension] ?? null;
};

// Priority used for the file the viewer is showing right now; prefetch warmers
// pass their queue priority (higher = later).
export const DIFF_SYNTAX_PRIORITY_SELECTED = 0;

// Lower than neighbor prefetch, higher than background warm: used when the
// user hovers/focuses a file row, signalling selection intent.
export const DIFF_SYNTAX_PRIORITY_WARM = 0.5;

export interface DiffSyntaxModel {
  targets: readonly DiffLineTokenTarget[];
  entry: SyntaxTokenCacheEntry;
}

const capSideText = (text: string | null): string | null =>
  text !== null && text.length <= SYNTAX_HIGHLIGHT_MAX_SOURCE_CHARS ? text : null;

// Resolve the tokenized side documents backing one file's patch. Prefers the
// real per-side documents (base blob + working-tree file) so grammar state
// around hunks is correct; falls back to per-side fragment streams when the
// documents endpoint is unreachable (offline, older server).
export const requestDiffSyntaxTokens = async (options: {
  cwd: string;
  filePath: string;
  query: GitDiffQuery;
  patch: string;
  priority: number;
}): Promise<DiffSyntaxModel | null> => {
  const langId = detectLangId(options.filePath);
  if (!langId) return null;
  const hunks = parseUnifiedDiff(options.patch);
  if (hunks.every((hunk) => hunk.lines.length === 0)) return null;

  const contents = await getDiffFileContents(
    options.cwd,
    options.filePath,
    options.query,
    options.patch,
  );
  if (contents) {
    const { targets, oldMaxLines, newMaxLines } = buildDocumentTokenTargets(hunks);
    const documents: SyntaxDocuments = {
      // No old rows shown (pure-addition diff): skip tokenizing the old side.
      oldText: oldMaxLines === 0 || contents.oldTruncated ? null : capSideText(contents.oldContent),
      newText: contents.newTruncated ? null : capSideText(contents.newContent),
    };
    if (documents.oldText === null && documents.newText === null) return null;
    const entry = await requestSyntaxTokens({
      langId,
      documents,
      oldMaxLines,
      newMaxLines,
      priority: options.priority,
    });
    return { targets, entry };
  }

  const fragments = buildFragmentTokenTargets(hunks);
  const documents: SyntaxDocuments = {
    oldText: capSideText(fragments.oldText === "" ? null : fragments.oldText),
    newText: capSideText(fragments.newText === "" ? null : fragments.newText),
  };
  if (documents.oldText === null && documents.newText === null) return null;
  const entry = await requestSyntaxTokens({
    langId,
    documents,
    oldMaxLines: fragments.oldMaxLines,
    newMaxLines: fragments.newMaxLines,
    priority: options.priority,
  });
  return { targets: fragments.targets, entry };
};

// Synchronous cache probe mirroring requestDiffSyntaxTokens' document mapping,
// so a file whose pipeline is fully warm paints colored text in the first
// commit. `undefined` means "not knowable without async work" (contents not
// cached or token cache miss) - callers fall back to requestDiffSyntaxTokens.
export const getCachedDiffSyntaxTokens = (options: {
  cwd: string;
  filePath: string;
  query: GitDiffQuery;
  patch: string;
  hunks: readonly DiffHunk[];
}): DiffSyntaxModel | null | undefined => {
  const langId = detectLangId(options.filePath);
  if (!langId) return null;
  if (options.hunks.every((hunk) => hunk.lines.length === 0)) return null;

  const contents = peekDiffFileContents(
    options.cwd,
    options.filePath,
    options.query,
    options.patch,
  );
  if (!contents) return undefined;

  const { targets, oldMaxLines } = buildDocumentTokenTargets(options.hunks);
  const documents: SyntaxDocuments = {
    oldText: oldMaxLines === 0 || contents.oldTruncated ? null : capSideText(contents.oldContent),
    newText: contents.newTruncated ? null : capSideText(contents.newContent),
  };
  if (documents.oldText === null && documents.newText === null) return null;

  const entry = readSyntaxTokenCache(
    buildSyntaxTokenCacheKey(langId, documents.oldText ?? "", documents.newText ?? ""),
  );
  return entry ? { targets, entry } : undefined;
};
