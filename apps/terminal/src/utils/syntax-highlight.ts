import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

export interface SyntaxToken {
  content: string;
  color: string;
  fontStyle: number;
}

export interface SyntaxLine {
  tokens: readonly SyntaxToken[];
}

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  python: () => import("@shikijs/langs/python"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  less: () => import("@shikijs/langs/less"),
  html: () => import("@shikijs/langs/html"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  markdown: () => import("@shikijs/langs/markdown"),
  bash: () => import("@shikijs/langs/bash"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  docker: () => import("@shikijs/langs/docker"),
  sql: () => import("@shikijs/langs/sql"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  xml: () => import("@shikijs/langs/xml"),
  diff: () => import("@shikijs/langs/diff"),
};

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

const THEME_ID = "dark-plus";

interface TokenCacheEntry {
  contentKey: string;
  result: readonly SyntaxLine[] | null;
}

const tokenCache = new Map<string, TokenCacheEntry>();

export const detectLangId = (filePath: string): string | null => {
  const lastSlash = filePath.lastIndexOf("/");
  const basename = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);

  const filenameLang = FILENAME_TO_LANG[basename];
  if (filenameLang) return filenameLang;

  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const extension = basename.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[extension] ?? null;
};

let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighterCore>>> | null = null;

const loadedLangIds = new Set<string>();

const getHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import("@shikijs/themes/dark-plus")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
};

const contentKey = (lines: readonly string[]): string => lines.join("\n");

export const getCachedTokens = (
  filePath: string,
  lines: readonly string[],
): readonly SyntaxLine[] | null | undefined => {
  const entry = tokenCache.get(filePath);
  if (!entry) return undefined;
  if (entry.contentKey !== contentKey(lines)) return undefined;
  return entry.result;
};

export const prefetchTokens = (
  filePath: string,
  lines: readonly string[],
  langId: string,
): void => {
  if (getCachedTokens(filePath, lines) !== undefined) return;
  void tokenizeDiffLines(filePath, lines, langId);
};

export const tokenizeDiffLines = async (
  filePath: string,
  lines: readonly string[],
  langId: string,
): Promise<readonly SyntaxLine[] | null> => {
  const cached = getCachedTokens(filePath, lines);
  if (cached !== undefined) return cached;

  const loader = LANG_LOADERS[langId];
  if (!loader) {
    tokenCache.set(filePath, { contentKey: contentKey(lines), result: null });
    return null;
  }

  try {
    const highlighter = await getHighlighter();

    if (!loadedLangIds.has(langId)) {
      const grammarModule = await loader();
      const grammar = (grammarModule as { default: unknown }).default;
      await highlighter.loadLanguage(grammar as Parameters<typeof highlighter.loadLanguage>[0]);
      loadedLangIds.add(langId);
    }

    const code = lines.join("\n");
    const themedTokens = highlighter.codeToTokens(code, {
      lang: langId,
      theme: THEME_ID,
    });

    const result = themedTokens.tokens.map((line) => ({
      tokens: line.map((token) => ({
        content: token.content,
        color: token.color ?? "",
        fontStyle: token.fontStyle ?? 0,
      })),
    }));

    tokenCache.set(filePath, { contentKey: contentKey(lines), result });
    return result;
  } catch {
    tokenCache.set(filePath, { contentKey: contentKey(lines), result: null });
    return null;
  }
};
