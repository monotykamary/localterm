import type {
  GitDiffFileListResponse,
  GitDiffMode,
  GitDiffSummary,
} from "@monotykamary/localterm-server/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PatchEntry } from "@/components/diff-viewer-types";
import {
  DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS,
  PATCH_PREFETCH_CONCURRENCY,
  PATCH_PREFETCH_NEIGHBOR_RADIUS,
} from "@/lib/constants";
import { deriveDiffSummary } from "@/utils/derive-diff-summary";
import { fetchGitDiffFilePatch, fetchGitDiffFiles } from "@/utils/fetch-git-diff";
import { parseUnifiedDiff } from "@/utils/parse-unified-diff";
import { useLatestRef } from "@/utils/use-latest-ref";
import { PrefetchQueue, type PrefetchQueueItem } from "@/utils/prefetch-queue";
import { detectLangId, tokenizeDiffLines } from "@/utils/syntax-highlight";
import type { SyntaxHighlightColorScheme } from "@/utils/syntax-highlight";

interface UseDiffViewerDataOptions {
  open: boolean;
  cwd: string | null;
  compareMode: GitDiffMode;
  baseOverride: string | null;
  gitDirtyVersion: number | undefined;
  currentBranch: string | null;
  syntaxHighlightColorScheme: SyntaxHighlightColorScheme;
  onDiffSummaryUpdate: ((summary: GitDiffSummary) => void) | undefined;
}

export const useDiffViewerData = ({
  open,
  cwd,
  compareMode,
  baseOverride,
  gitDirtyVersion,
  currentBranch,
  syntaxHighlightColorScheme,
  onDiffSummaryUpdate,
}: UseDiffViewerDataOptions) => {
  // Per-mode file lists, pre-fetched on cwd change (even while the viewer is
  // closed) so data is ready instantly on open. No cross-component ref — state
  // triggers re-renders, so the viewer always reflects the latest fetch.
  const [workingFiles, setWorkingFiles] = useState<GitDiffFileListResponse | null>(null);
  const [branchFiles, setBranchFiles] = useState<GitDiffFileListResponse | null>(null);
  const [hasError, setHasError] = useState(false);
  const [patchCache, setPatchCache] = useState<Record<string, PatchEntry>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedPathRef = useRef(selectedPath);
  const [refreshCount, setRefreshCount] = useState(0);
  // In-flight per-file patch fetches, so they can be aborted on close/refresh.
  const patchControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Tracks the last-seen file metadata per path+mode so the patch-loading
  // effect can detect real changes (additions/deletions/status) vs mere
  // reference identity changes from re-fetches returning identical data.
  // Includes compareMode+base so switching modes invalidates stale patches.
  const prefetchQueueRef = useRef<PrefetchQueue | null>(null);
  const lastFileMetaRef = useRef<Map<string, string>>(new Map());
  // Latest cache, read by loadPatch without making it depend on patchCache.
  const patchCacheRef = useLatestRef(patchCache);
  const syntaxHighlightColorSchemeRef = useLatestRef(syntaxHighlightColorScheme);
  const onDiffSummaryUpdateRef = useLatestRef(onDiffSummaryUpdate);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const abortPatchFetches = useCallback(() => {
    for (const controller of patchControllersRef.current.values()) controller.abort();
    patchControllersRef.current.clear();
    prefetchQueueRef.current?.clear();
  }, []);

  useEffect(() => {
    setWorkingFiles(null);
    setBranchFiles(null);
    setHasError(false);
    setPatchCache({});
    lastFileMetaRef.current.clear();
    prefetchQueueRef.current = null;
    abortPatchFetches();
  }, [cwd, abortPatchFetches]);

  // Pre-fetch both file lists on cwd change, in parallel. Runs while the viewer
  // is closed so data is ready on open; each list sets state as it resolves, so
  // whichever mode compareMode lands on once branchInfo resolves paints without
  // waiting on the other. Parallel is safe: the server caches each (cwd, mode,
  // base) diff pass, so the two builds are independent git processes and the
  // patch prefetch that follows reads from cache without spawning more.
  useEffect(() => {
    if (!cwd) return;
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      const working = await fetchGitDiffFiles(cwd, { mode: "working" }, signal);
      if (!signal.aborted && working) setWorkingFiles(working);
    })();
    void (async () => {
      const branch = await fetchGitDiffFiles(cwd, { mode: "branch" }, signal);
      if (!signal.aborted && branch) setBranchFiles(branch);
    })();
    return () => controller.abort();
  }, [cwd]);

  const workingFilesRef = useLatestRef(workingFiles);
  const branchFilesRef = useLatestRef(branchFiles);

  // Refetch the current mode's file list and update the right per-mode state.
  // Returns the fetched list so callers can decide whether to recover from errors
  // or invalidate cached patch metadata.
  const refreshCurrentFiles = useCallback(
    async (signal: AbortSignal): Promise<GitDiffFileListResponse | null> => {
      if (!cwd) return null;
      const query = { mode: compareMode, base: baseOverride };
      const response = await fetchGitDiffFiles(cwd, query, signal);
      if (signal.aborted || !response) return null;
      const setter = compareMode === "branch" ? setBranchFiles : setWorkingFiles;
      setter(response);
      return response;
    },
    [cwd, compareMode, baseOverride],
  );

  // On-open revalidation: when the viewer opens with data already present, show
  // it immediately and silently refresh in the background. When data is missing
  // (first load on a fresh cwd, or explicit refresh), fetch with the center
  // spinner. Mode switches read from the per-mode state — no spinner.
  useEffect(() => {
    if (!open || !cwd) {
      abortPatchFetches();
      setPatchCache((previous) => {
        let didCacheChange = false;
        const nextCache: Record<string, PatchEntry> = {};
        for (const [filePath, entry] of Object.entries(previous)) {
          if (entry.state === "loading") didCacheChange = true;
          else nextCache[filePath] = entry;
        }
        return didCacheChange ? nextCache : previous;
      });
      return;
    }
    const currentData = compareMode === "branch" ? branchFilesRef.current : workingFilesRef.current;

    if (currentData) {
      const controller = new AbortController();
      void refreshCurrentFiles(controller.signal);
      return () => controller.abort();
    }

    setHasError(false);
    abortPatchFetches();
    setPatchCache({});
    const controller = new AbortController();
    void (async () => {
      const response = await refreshCurrentFiles(controller.signal);
      if (controller.signal.aborted) return;
      if (!response) setHasError(true);
    })();
    return () => controller.abort();
  }, [
    open,
    cwd,
    refreshCount,
    compareMode,
    baseOverride,
    abortPatchFetches,
    refreshCurrentFiles,
    branchFilesRef,
    workingFilesRef,
  ]);

  // When the server signals the working tree may have changed, debounce and
  // re-fetch the current mode's file list so opening lands on current, pre-cached
  // data — even before the viewer has ever been opened. The gate skips only when
  // the current mode's list hasn't loaded yet: that first load is owned by the
  // cwd-change effect, so acting on the startup git-dirty signal (which merely
  // duplicates it) would run a redundant heavy diff at terminal startup. When
  // open, we also mark the selected file's cached metadata stale so the prefetch
  // queue force-reloads its patch, keeping the diff content in sync with the disk.
  useEffect(() => {
    if (!cwd || gitDirtyVersion === undefined) return;
    const currentFilesLoaded = (compareMode === "branch" ? branchFilesRef : workingFilesRef)
      .current;
    if (!currentFilesLoaded) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await refreshCurrentFiles(controller.signal);
        if (controller.signal.aborted || !response) return;
        setHasError(false);
        if (open) {
          const stalePath = selectedPathRef.current;
          if (stalePath) lastFileMetaRef.current.set(stalePath, "__git-dirty__");
        }
      })();
    }, DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    cwd,
    gitDirtyVersion,
    compareMode,
    baseOverride,
    open,
    refreshCurrentFiles,
    branchFilesRef,
    workingFilesRef,
  ]);

  // Push working-tree summaries back to the ambient indicator so it stays in sync
  // with the viewer's latest fetch instead of waiting on the throttled WebSocket push.
  useEffect(() => {
    if (workingFiles && onDiffSummaryUpdateRef.current) {
      onDiffSummaryUpdateRef.current(deriveDiffSummary(workingFiles, currentBranch));
    }
  }, [workingFiles, currentBranch, onDiffSummaryUpdateRef]);

  // Invalidate cached patches when the comparison mode or base changes —
  // patches from one mode are wrong for another.
  useEffect(() => {
    abortPatchFetches();
    setPatchCache({});
    lastFileMetaRef.current.clear();
    prefetchQueueRef.current = null;
  }, [compareMode, baseOverride, abortPatchFetches]);

  const displayFileList = compareMode === "branch" ? branchFiles : workingFiles;
  const files = useMemo(() => displayFileList?.files ?? [], [displayFileList]);

  const loadPatch = useCallback(
    (filePath: string | null | undefined, force = false) => {
      if (!filePath || !cwd) return;
      const existing = patchCacheRef.current[filePath];
      const inFlight = patchControllersRef.current.has(filePath);
      if (
        !force &&
        existing &&
        (existing.state === "loaded" || (existing.state === "loading" && inFlight))
      )
        return;
      if (force && existing?.state === "loading" && inFlight) return;
      const previousData = existing?.data;
      setPatchCache((previous) => ({
        ...previous,
        [filePath]: { state: "loading", ...(previousData ? { data: previousData } : {}) },
      }));
      patchControllersRef.current.get(filePath)?.abort();
      const controller = new AbortController();
      patchControllersRef.current.set(filePath, controller);
      void fetchGitDiffFilePatch(
        cwd,
        filePath,
        { mode: compareMode, base: baseOverride },
        controller.signal,
      )
        .then(async (data) => {
          if (controller.signal.aborted) return;
          patchControllersRef.current.delete(filePath);
          if (data?.patch) {
            const languageId = detectLangId(filePath);
            if (languageId) {
              const hunks = parseUnifiedDiff(data.patch);
              const allLines = hunks.flatMap((hunk) => hunk.lines);
              if (allLines.length > 0) {
                await tokenizeDiffLines(
                  filePath,
                  allLines.map((line) => line.text),
                  languageId,
                  syntaxHighlightColorSchemeRef.current,
                );
              }
            }
          }
          if (controller.signal.aborted) return;
          setPatchCache((previous) => ({
            ...previous,
            [filePath]: data ? { state: "loaded", data } : { state: "error" },
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          patchControllersRef.current.delete(filePath);
          setPatchCache((previous) => ({
            ...previous,
            [filePath]: { state: "error" },
          }));
        });
    },
    [cwd, compareMode, baseOverride, patchCacheRef, syntaxHighlightColorSchemeRef],
  );

  const getOrCreatePrefetchQueue = useCallback(() => {
    if (!prefetchQueueRef.current) {
      prefetchQueueRef.current = new PrefetchQueue(
        PATCH_PREFETCH_CONCURRENCY,
        async (filePath, force) => {
          loadPatch(filePath, force);
        },
      );
    }
    return prefetchQueueRef.current;
  }, [loadPatch]);

  // Keep a valid selection: follow the current file across refreshes, fall back
  // to the first file when it disappears.
  useEffect(() => {
    if (!displayFileList) return;
    if (selectedPath && files.some((file) => file.path === selectedPath)) return;
    setSelectedPath(files[0]?.path ?? null);
  }, [displayFileList, files, selectedPath]);

  // Unified prefetch: the selected file (priority 0), its neighbors (priority
  // 1..N), and remaining uncached files (priority N+1+) all route through a
  // single concurrency-limited queue. When the selected file's metadata
  // changes (additions/deletions/status), the force flag invalidates its
  // cached patch so the queue re-fetches it.
  useEffect(() => {
    if (files.length === 0 || !selectedPath) return;
    const queue = getOrCreatePrefetchQueue();
    const selectedMeta = files.find((file) => file.path === selectedPath);
    const modeKey = `${compareMode}:${baseOverride ?? ""}`;
    const metaKey = selectedMeta
      ? `${modeKey}:${selectedMeta.additions}:${selectedMeta.deletions}:${selectedMeta.status}:${selectedMeta.binary}`
      : modeKey;
    const lastKey = lastFileMetaRef.current.get(selectedPath);
    const fileChanged = lastKey !== undefined && lastKey !== metaKey;
    lastFileMetaRef.current.set(selectedPath, metaKey);

    const items: PrefetchQueueItem[] = [];
    items.push({ path: selectedPath, priority: 0, force: fileChanged });

    const selectedIndex = files.findIndex((file) => file.path === selectedPath);
    if (selectedIndex >= 0) {
      for (let offset = 1; offset <= PATCH_PREFETCH_NEIGHBOR_RADIUS; offset += 1) {
        const previousPath = files[selectedIndex - offset]?.path;
        const nextPath = files[selectedIndex + offset]?.path;
        if (previousPath) items.push({ path: previousPath, priority: offset });
        if (nextPath) items.push({ path: nextPath, priority: offset });
      }
    }

    for (const file of files) {
      if (items.some((item) => item.path === file.path)) continue;
      const distance = Math.abs(files.indexOf(file) - (selectedIndex >= 0 ? selectedIndex : 0));
      items.push({
        path: file.path,
        priority: PATCH_PREFETCH_NEIGHBOR_RADIUS + distance,
      });
    }

    queue.enqueue(items);
  }, [selectedPath, displayFileList, files, compareMode, baseOverride, getOrCreatePrefetchQueue]);

  const refreshFiles = useCallback(() => {
    if (compareMode === "branch") setBranchFiles(null);
    else setWorkingFiles(null);
    setHasError(false);
    setRefreshCount((count) => count + 1);
  }, [compareMode]);

  return {
    displayFileList,
    files,
    hasError,
    loadPatch,
    patchCache,
    refreshFiles,
    selectedPath,
    setSelectedPath,
  };
};
