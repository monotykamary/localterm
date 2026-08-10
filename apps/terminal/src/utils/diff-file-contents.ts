import type { GitDiffFileContents } from "@monotykamary/localterm-server/protocol";
import { DIFF_CONTENTS_CACHE_MAX_CHARS, DIFF_CONTENTS_CACHE_MAX_ENTRIES } from "@/lib/constants";
import { fetchGitDiffFileContents } from "./fetch-git-diff";
import type { GitDiffQuery } from "./fetch-git-diff";

interface ContentsCacheEntry {
  patch: string;
  contents: GitDiffFileContents;
  chars: number;
}

// Keyed per (cwd, comparison, path) and verified by patch text: an unchanged
// patch against the same comparison implies unchanged side documents, so
// refreshes that only refetch the same patch never refetch contents. An edit
// anywhere in the file changes the patch (either the hunk or the file list),
// which refetches contents — staleness is only possible when the working tree
// is edited without the server noticing, self-healing on the next dirty signal.
const contentsCache = new Map<string, ContentsCacheEntry>();
let contentsCacheChars = 0;

export const clearDiffFileContentsCache = (): void => {
  contentsCache.clear();
  contentsCacheChars = 0;
};
// The pane and the prefetch warmer request the same file concurrently; share
// their fetch instead of doubling it.
const inFlightContents = new Map<string, Promise<GitDiffFileContents | null>>();

const cacheKey = (cwd: string, filePath: string, query: GitDiffQuery): string =>
  [cwd, query.mode, query.base ?? "", filePath].join("\0");

export const getDiffFileContents = async (
  cwd: string,
  filePath: string,
  query: GitDiffQuery,
  patch: string,
): Promise<GitDiffFileContents | null> => {
  const key = cacheKey(cwd, filePath, query);
  const cached = contentsCache.get(key);
  if (cached && cached.patch === patch) {
    contentsCache.delete(key);
    contentsCache.set(key, cached);
    return cached.contents;
  }
  const inFlight = inFlightContents.get(key);
  if (inFlight) return inFlight;
  const promise = fetchAndCache(cwd, filePath, query, key, patch, cached);
  inFlightContents.set(key, promise);
  void promise.then(() => inFlightContents.delete(key));
  return promise;
};

const fetchAndCache = async (
  cwd: string,
  filePath: string,
  query: GitDiffQuery,
  key: string,
  patch: string,
  previous: ContentsCacheEntry | undefined,
): Promise<GitDiffFileContents | null> => {
  const contents = await fetchGitDiffFileContents(cwd, filePath, query);
  // Fetch failures are not cached: the caller falls back to fragment
  // tokenization and a later request can retry the real documents.
  if (!contents) return null;
  if (previous) contentsCacheChars -= previous.chars;
  const chars = (contents.oldContent?.length ?? 0) + (contents.newContent?.length ?? 0);
  contentsCache.delete(key);
  contentsCache.set(key, { patch, contents, chars });
  contentsCacheChars += chars;
  while (
    contentsCache.size > DIFF_CONTENTS_CACHE_MAX_ENTRIES ||
    contentsCacheChars > DIFF_CONTENTS_CACHE_MAX_CHARS
  ) {
    const oldestKey = contentsCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = contentsCache.get(oldestKey);
    if (oldest) contentsCacheChars -= oldest.chars;
    contentsCache.delete(oldestKey);
  }
  return contents;
};
