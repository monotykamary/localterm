import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import type { SyntaxHighlightColorScheme } from "./syntax-highlight";

const SYNTAX_COLOR_SCHEMES: readonly SyntaxHighlightColorScheme[] = ["dark", "light"];

const SYNTAX_THEME_IDS: Record<SyntaxHighlightColorScheme, string> = {
  dark: "dark-plus",
  light: "light-plus",
};

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

// Tokens cross the worker boundary stripped of their content (the main thread
// already owns the source text) and palletized per scheme: for each document
// line, a flat quadruple list [tokenStart, tokenEnd, paletteIndex, fontStyle].
// Both color schemes ride one payload, so a scheme switch never re-tokenizes.
export interface CompactThemeTokens {
  palette: string[];
  lines: number[][];
}

type CompactSideTokens = Record<SyntaxHighlightColorScheme, CompactThemeTokens>;

export interface SyntaxDocumentTokens {
  old: CompactSideTokens | null;
  next: CompactSideTokens | null;
}

export interface TokenizeDocumentsRequest {
  langId: string;
  oldText: string | null;
  newText: string | null;
  // Tokenize only through the deepest shown hunk line per side; the tail of a
  // large file past that is never displayed, so tokenizing it would be waste.
  oldMaxLines: number;
  newMaxLines: number;
}

export interface SyntaxWorkerRequest {
  requestId: number;
  request: TokenizeDocumentsRequest;
}

export interface SyntaxWorkerResponse {
  requestId: number;
  result: SyntaxDocumentTokens | null;
}

type HighlighterCore = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangIds = new Set<string>();

const getHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import("@shikijs/themes/dark-plus"), import("@shikijs/themes/light-plus")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
};

const loadScopedSource = (
  text: string,
  maxLines: number,
): { code: string; lineStartOffsets: number[] } => {
  const lines = text.split("\n");
  const scoped = maxLines > 0 && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const lineStartOffsets: number[] = [];
  let offset = 0;
  for (const line of scoped) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }
  return { code: scoped.join("\n"), lineStartOffsets };
};

const tokenizeSide = (
  highlighter: HighlighterCore,
  text: string,
  maxLines: number,
  langId: string,
): CompactSideTokens => {
  const { code, lineStartOffsets } = loadScopedSource(text, maxLines);
  const sides = {} as Record<SyntaxHighlightColorScheme, CompactThemeTokens>;
  for (const scheme of SYNTAX_COLOR_SCHEMES) {
    const themedTokens = highlighter.codeToTokens(code, {
      lang: langId,
      theme: SYNTAX_THEME_IDS[scheme],
    });
    const palette: string[] = [];
    const paletteIndexByColor = new Map<string, number>();
    const lines = themedTokens.tokens.map((lineTokens, rowIndex) => {
      const rowStart = lineStartOffsets[rowIndex] ?? 0;
      const quads: number[] = [];
      for (const token of lineTokens) {
        const color = token.color ?? "";
        let paletteIndex = paletteIndexByColor.get(color);
        if (paletteIndex === undefined) {
          paletteIndex = palette.length;
          palette.push(color);
          paletteIndexByColor.set(color, paletteIndex);
        }
        const start = token.offset - rowStart;
        quads.push(start, start + token.content.length, paletteIndex, token.fontStyle ?? 0);
      }
      return quads;
    });
    sides[scheme] = { palette, lines };
  }
  return sides;
};

// Tokenize both side documents for a diff. Runs identically inside the syntax
// worker and on the main thread (fallback when workers are unavailable), so
// the import graph here must stay free of DOM assumptions. Returns null only
// when the language is unknown or the highlighter fails.
export const tokenizeDocuments = async (
  request: TokenizeDocumentsRequest,
): Promise<SyntaxDocumentTokens | null> => {
  const loader = LANG_LOADERS[request.langId];
  if (!loader) return null;
  try {
    const highlighter = await getHighlighter();
    if (!loadedLangIds.has(request.langId)) {
      const grammarModule = await loader();
      const grammar = (grammarModule as { default: unknown }).default;
      await highlighter.loadLanguage(grammar as Parameters<HighlighterCore["loadLanguage"]>[0]);
      loadedLangIds.add(request.langId);
    }
    return {
      old:
        request.oldText === null
          ? null
          : tokenizeSide(highlighter, request.oldText, request.oldMaxLines, request.langId),
      next:
        request.newText === null
          ? null
          : tokenizeSide(highlighter, request.newText, request.newMaxLines, request.langId),
    };
  } catch {
    return null;
  }
};
