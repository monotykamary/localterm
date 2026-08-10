import { SYNTAX_TOKEN_CACHE_MAX_FILES, SYNTAX_TOKEN_CACHE_MAX_SOURCE_CHARS } from "@/lib/constants";
import { hashSyntaxSource } from "./hash-syntax-source";
import type {
  CompactThemeTokens,
  SyntaxDocumentTokens,
  SyntaxWorkerResponse,
  TokenizeDocumentsRequest,
} from "./syntax-tokenizer-core";
import type { SyntaxHighlightColorScheme, SyntaxLine, SyntaxToken } from "./syntax-highlight";

export interface SyntaxDocuments {
  oldText: string | null;
  newText: string | null;
}

export interface MaterializedDocumentTokens {
  old: readonly (SyntaxLine | undefined)[] | null;
  next: readonly (SyntaxLine | undefined)[] | null;
}

export interface SyntaxTokenCacheEntry {
  documents: SyntaxDocuments;
  compact: SyntaxDocumentTokens | null;
  materialized: Partial<Record<SyntaxHighlightColorScheme, MaterializedDocumentTokens>>;
  sourceChars: number;
}

interface QueuedJob {
  requestId: number;
  key: string;
  request: TokenizeDocumentsRequest;
  priority: number;
  resolve: (tokens: SyntaxDocumentTokens | null) => void;
}

// Content-hash keyed, so realtime refreshes re-tokenize only sides that
// actually changed document text — the old side is a base blob and rarely
// changes while the working tree is being edited.
const tokenCache = new Map<string, SyntaxTokenCacheEntry>();
let tokenCacheChars = 0;
const inFlightByKey = new Map<string, Promise<SyntaxTokenCacheEntry>>();

const jobQueue: QueuedJob[] = [];

export const clearSyntaxTokenCache = (): void => {
  tokenCache.clear();
  tokenCacheChars = 0;
};
let queueDraining = false;
let nextRequestId = 1;
let syntaxWorker: Worker | null | undefined;
const pendingWorkerJobs = new Map<number, (tokens: SyntaxDocumentTokens | null) => void>();

const getSyntaxWorker = (): Worker | null => {
  if (syntaxWorker !== undefined) return syntaxWorker;
  syntaxWorker = null;
  try {
    if (typeof Worker === "undefined") return null;
    const spawned = new Worker(new URL("../workers/syntax-worker.ts", import.meta.url), {
      type: "module",
    });
    spawned.onmessage = (event: MessageEvent<SyntaxWorkerResponse>) => {
      const { requestId, result } = event.data;
      const resolve = pendingWorkerJobs.get(requestId);
      pendingWorkerJobs.delete(requestId);
      resolve?.(result);
    };
    spawned.onerror = () => {
      // The worker is gone (offline uncached chunk, old Safari, CSP): settle
      // every pending job as unhighlighted and permanently take the inline path.
      for (const resolve of pendingWorkerJobs.values()) resolve(null);
      pendingWorkerJobs.clear();
      spawned.terminate();
      if (syntaxWorker === spawned) syntaxWorker = null;
    };
    syntaxWorker = spawned;
  } catch {
    syntaxWorker = null;
  }
  return syntaxWorker;
};

const runJob = async (job: QueuedJob): Promise<SyntaxDocumentTokens | null> => {
  const activeWorker = getSyntaxWorker();
  if (activeWorker) {
    return new Promise((resolve) => {
      pendingWorkerJobs.set(job.requestId, resolve);
      activeWorker.postMessage({ requestId: job.requestId, request: job.request });
    });
  }
  // No worker (jsdom, iOS <15, worker construction rejected): tokenize inline
  // and let the async engine keep this off the synchronous render path.
  const core = await import("./syntax-tokenizer-core");
  return core.tokenizeDocuments(job.request).catch(() => null);
};

const drainQueue = async (): Promise<void> => {
  if (queueDraining) return;
  queueDraining = true;
  while (jobQueue.length > 0) {
    jobQueue.sort((a, b) => a.priority - b.priority || a.requestId - b.requestId);
    const job = jobQueue.shift();
    if (!job) continue;
    job.resolve(await runJob(job));
  }
  queueDraining = false;
};

const storeEntry = (
  key: string,
  documents: SyntaxDocuments,
  compact: SyntaxDocumentTokens | null,
): SyntaxTokenCacheEntry => {
  const entry: SyntaxTokenCacheEntry = {
    documents,
    compact,
    materialized: {},
    sourceChars: (documents.oldText?.length ?? 0) + (documents.newText?.length ?? 0),
  };
  tokenCache.delete(key);
  tokenCache.set(key, entry);
  tokenCacheChars += entry.sourceChars;
  while (
    tokenCache.size > SYNTAX_TOKEN_CACHE_MAX_FILES ||
    tokenCacheChars > SYNTAX_TOKEN_CACHE_MAX_SOURCE_CHARS
  ) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = tokenCache.get(oldestKey);
    if (oldest) tokenCacheChars -= oldest.sourceChars;
    tokenCache.delete(oldestKey);
  }
  return entry;
};

export const requestSyntaxTokens = (spec: {
  langId: string;
  documents: SyntaxDocuments;
  oldMaxLines: number;
  newMaxLines: number;
  priority: number;
}): Promise<SyntaxTokenCacheEntry> => {
  const key =
    spec.langId +
    "\0" +
    hashSyntaxSource(spec.documents.oldText ?? "") +
    "\0" +
    hashSyntaxSource(spec.documents.newText ?? "");
  const cached = tokenCache.get(key);
  if (cached) {
    tokenCache.delete(key);
    tokenCache.set(key, cached);
    return Promise.resolve(cached);
  }
  const inFlight = inFlightByKey.get(key);
  if (inFlight) {
    const queued = jobQueue.find((job) => job.key === key);
    if (queued && spec.priority < queued.priority) queued.priority = spec.priority;
    return inFlight;
  }
  const request: TokenizeDocumentsRequest = {
    langId: spec.langId,
    oldText: spec.documents.oldText,
    newText: spec.documents.newText,
    oldMaxLines: spec.oldMaxLines,
    newMaxLines: spec.newMaxLines,
  };
  const documents = spec.documents;
  const promise = new Promise<SyntaxTokenCacheEntry>((resolve) => {
    jobQueue.push({
      requestId: nextRequestId,
      key,
      request,
      priority: spec.priority,
      resolve: (tokens) => resolve(storeEntry(key, documents, tokens)),
    });
    nextRequestId += 1;
  });
  inFlightByKey.set(key, promise);
  void promise.then(() => inFlightByKey.delete(key));
  void drainQueue();
  return promise;
};

const materializeSide = (
  compactTheme: CompactThemeTokens,
  sourceText: string | null,
): readonly (SyntaxLine | undefined)[] | null => {
  if (sourceText === null) return null;
  const sourceLines = sourceText.split("\n");
  return compactTheme.lines.map((quads, rowIndex) => {
    const lineText = sourceLines[rowIndex];
    if (lineText === undefined) return undefined;
    const tokens: SyntaxToken[] = [];
    for (let quadIndex = 0; quadIndex + 3 < quads.length; quadIndex += 4) {
      tokens.push({
        content: lineText.slice(quads[quadIndex], quads[quadIndex + 1]),
        color: compactTheme.palette[quads[quadIndex + 2]] ?? "",
        fontStyle: quads[quadIndex + 3],
      });
    }
    return { tokens };
  });
};

// Rebuild per-scheme render tokens from a cached entry. Runs once per scheme
// per entry; the result is memoized on the entry itself.
export const materializeEntryTokens = (
  entry: SyntaxTokenCacheEntry,
  colorScheme: SyntaxHighlightColorScheme,
): MaterializedDocumentTokens => {
  const memoized = entry.materialized[colorScheme];
  if (memoized) return memoized;
  const old = entry.compact?.old
    ? materializeSide(entry.compact.old[colorScheme], entry.documents.oldText)
    : null;
  const next = entry.compact?.next
    ? materializeSide(entry.compact.next[colorScheme], entry.documents.newText)
    : null;
  const built: MaterializedDocumentTokens = { old, next };
  entry.materialized[colorScheme] = built;
  return built;
};
