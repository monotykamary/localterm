import type {
  GitBranchInfo,
  GitDiffMode,
  GitDiffSummary,
} from "@monotykamary/localterm-server/protocol";
import type { SyntaxHighlightColorScheme } from "@/utils/syntax-highlight";
import { ChevronDown, ExternalLink, GitBranch, RefreshCw, Send, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileDiffPane } from "@/components/diff-viewer-file-diff-pane";
import { FileListPopover, FileListSidebar } from "@/components/diff-viewer-file-picker";
import {
  DIFF_ADDITIONS_CLASSES,
  DIFF_DELETIONS_CLASSES,
} from "@/components/diff-viewer-file-status";
import { DiffViewerPrBadge } from "@/components/diff-viewer-pr-badge";
import type { FileListVirtualizerHandle } from "@/components/diff-viewer-types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useDiffReviewAnnotations } from "@/hooks/use-diff-review-annotations";
import { useDiffViewerData } from "@/hooks/use-diff-viewer-data";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  DIFF_VIEWER_CLOSE_TRANSITION_MS,
  DIFF_VIEWER_COMPACT_HEADER_PADDING_PX,
  DIFF_VIEWER_SIDEBAR_WIDTH_PX,
  SIDEBAR_COLLAPSE_WIDTH_PX,
} from "@/lib/constants";
import { resolvePrDisplayState } from "@/lib/pr-state";
import { cn } from "@/lib/utils";
import { computeHeaderLayout } from "@/utils/compute-header-layout";
import { resolveOpenDiffFileAction } from "@/utils/resolve-open-diff-file-action";
import { splitFilePath } from "@/utils/split-file-path";
import {
  loadStoredDiffViewMode,
  storeDiffViewMode,
  type DiffViewMode,
} from "@/utils/stored-diff-view-mode";

interface DiffViewerProps {
  open: boolean;
  cwd: string | null;
  syntaxHighlightColorScheme?: SyntaxHighlightColorScheme;
  // Ambient branch/PR metadata leased from the parent (fetched once per cwd), so
  // the viewer opens straight into branch mode when a PR exists — no gh wait.
  // Null while the lease is still loading or unavailable.
  branchInfo: GitBranchInfo | null;
  // Bumps whenever the server emits a git-diff-summary from a real git-dirty
  // signal. The viewer debounces and refreshes in near-realtime while open.
  gitDirtyVersion?: number;
  onClose: () => void;
  // Open a fresh browser tab running `nvim <path>` at the repo cwd, so the
  // user can edit the file in place. Mirrors openShellAt from the worktrees
  // modal — same ExternalLink icon, same new-tab mechanism.
  onOpenInEditor?: (filePath: string) => void;
  // Open a working-tree image in a new browser tab. The server's /api/file
  // route serves image bytes directly, so Chrome renders it natively — unlike
  // text files, which need a PTY running nvim.
  onOpenImage?: (filePath: string) => void;
  onSendToTerminal?: (text: string) => void;
  // Ask the parent to re-fetch the leased branch info (wired to the refresh
  // button alongside re-fetching the diff).
  onRefreshBranchInfo?: () => void;
  // Push a derived working-tree summary back to the parent so the ambient
  // indicator stays in sync with the diff viewer's latest fetch instead of
  // waiting on the (throttled) WebSocket push.
  onDiffSummaryUpdate?: (summary: GitDiffSummary) => void;
}

interface ComparisonOption {
  mode: GitDiffMode;
  label: string;
}

const FULL_COMPARISON_OPTIONS: readonly ComparisonOption[] = [
  { mode: "working", label: "Working" },
  { mode: "branch", label: "Branch" },
];

const COMPACT_COMPARISON_OPTIONS: readonly ComparisonOption[] = [
  { mode: "working", label: "W" },
  { mode: "branch", label: "B" },
];

const DIFF_VIEW_MODES: readonly DiffViewMode[] = ["unified", "split"];

export const DiffViewer = ({
  open,
  cwd,
  syntaxHighlightColorScheme = "dark",
  branchInfo,
  gitDirtyVersion,
  onClose,
  onOpenInEditor,
  onOpenImage,
  onSendToTerminal,
  onRefreshBranchInfo,
  onDiffSummaryUpdate,
}: DiffViewerProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadStoredDiffViewMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [headerWidth, setHeaderWidth] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const contentRowRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  // Comparison mode is EPHEMERAL, not persisted: it defaults to working, and to
  // branch when the branch has a PR. `userPickedMode` (null = follow that
  // default) holds an explicit per-open toggle so the user can override; it's
  // reset on open and repo change.
  const [userPickedMode, setUserPickedMode] = useState<GitDiffMode | null>(null);
  // User-picked base ref for branch mode; null falls back to the server's
  // locally-resolved default branch. Reset per repo.
  const [baseOverride, setBaseOverride] = useState<string | null>(null);

  // Effective PR for this open: the detected branch PR, unless it's a stale
  // merged PR (older than the overlay TTL) — in which case it's treated as no
  // PR, so branch-mode auto-open, the base-picker default, and the header chip
  // all drop it instead of surfacing merge noise.
  const detectedPr = branchInfo?.pr ?? null;
  const pr =
    detectedPr && resolvePrDisplayState(detectedPr, branchInfo?.currentBranch ?? null)
      ? detectedPr
      : null;

  const compareMode: GitDiffMode = userPickedMode ?? (pr ? "branch" : "working");
  // Base ref shown in the picker. Prefers the PR's resolved base (a fork PR's
  // upstream ref, a same-repo PR's origin ref) over the repo default so the
  // picker matches the comparison the server actually runs. The DIFF fetch,
  // however, only sends an explicit base when the user overrode one — otherwise
  // it sends none and the server resolves from the same PR cache, so the branch
  // diff never waits on the (slower, gh-backed) branch metadata.
  const displayBase =
    compareMode === "branch"
      ? (baseOverride ?? pr?.baseRef ?? branchInfo?.defaultBase ?? null)
      : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileListVirtualizerRef = useRef<FileListVirtualizerHandle | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Each open re-derives the mode from PR presence (ephemeral) unless the
      // user toggles during this session.
      setUserPickedMode(null);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    const timer = window.setTimeout(() => setMounted(false), DIFF_VIEWER_CLOSE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Switching repos resets mode overrides, file-list state, and patches.
  useEffect(() => {
    setBaseOverride(null);
    setUserPickedMode(null);
  }, [cwd]);

  const {
    displayFileList,
    files,
    hasError,
    loadPatch,
    patchCache,
    refreshFiles,
    selectedPath,
    setSelectedPath,
  } = useDiffViewerData({
    open,
    cwd,
    compareMode,
    baseOverride,
    gitDirtyVersion,
    currentBranch: branchInfo?.currentBranch ?? null,
    syntaxHighlightColorScheme,
    onDiffSummaryUpdate,
  });

  const {
    annotationCounts,
    annotationList,
    annotations,
    cancelAnnotationEditor,
    clearAnnotations,
    deleteAnnotation,
    dragCancelRef,
    editingKey,
    handleSendToTerminal,
    openAnnotationEditor,
    pendingRange,
    saveAnnotation,
  } = useDiffReviewAnnotations({ onClose, onSendToTerminal });

  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  const selectedIndex = selectedFile ? files.indexOf(selectedFile) : -1;
  const openFileAction = selectedFile
    ? resolveOpenDiffFileAction(selectedFile, onOpenInEditor, onOpenImage)
    : null;
  const selectedFileParts = selectedFile
    ? splitFilePath(selectedFile.path)
    : { directory: "", basename: "" };

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let binaries = 0;
    for (const file of files) {
      additions += file.additions;
      deletions += file.deletions;
      if (file.binary) binaries += 1;
    }
    return { additions, deletions, binaries };
  }, [files]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (files.length === 0) return;
      const nextIndex = Math.min(
        files.length - 1,
        Math.max(0, (selectedIndex === -1 ? 0 : selectedIndex) + delta),
      );
      setSelectedPath(files[nextIndex].path);
      fileListVirtualizerRef.current?.scrollToIndex(nextIndex, { align: "auto" });
    },
    [files, selectedIndex, setSelectedPath],
  );

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      // The annotation editor's textarea handles Escape itself (closes just the
      // editor) and owns all typing.
      const isTextArea = target instanceof HTMLElement && target.tagName === "TEXTAREA";
      if (event.key === "Escape") {
        if (isTextArea) return;
        event.preventDefault();
        event.stopPropagation();
        // Mid-drag Escape abandons the range selection, not the viewer.
        if (dragCancelRef.current) {
          dragCancelRef.current();
          return;
        }
        onClose();
        return;
      }
      if (isTextArea) return;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "SELECT")
      ) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        moveSelection(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose, moveSelection, dragCancelRef]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  const handleViewModeChange = useCallback((nextMode: DiffViewMode) => {
    setViewMode(nextMode);
    storeDiffViewMode(nextMode);
  }, []);

  useLayoutEffect(() => {
    const row = contentRowRef.current;
    if (!row) return;
    const update = (width: number) => {
      if (width === 0) return;
      setSidebarCollapsed(width < SIDEBAR_COLLAPSE_WIDTH_PX);
    };
    update(row.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        update(width);
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [displayFileList, mounted]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = (width: number) => {
      if (width === 0) return;
      setHeaderWidth(width);
    };
    update(header.offsetWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? header.offsetWidth;
        update(width);
      }
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [mounted]);

  // An explicit toggle overrides the PR-derived default for the rest of this open
  // (cleared on close/reopen — the mode is intentionally not persisted).
  const handleCompareModeChange = useCallback((nextMode: GitDiffMode) => {
    setUserPickedMode(nextMode);
  }, []);

  // Refresh both the diff and the leased branch/PR metadata.
  const handleRefresh = useCallback(() => {
    refreshFiles();
    onRefreshBranchInfo?.();
  }, [refreshFiles, onRefreshBranchInfo]);

  // Options for the base picker: the candidate refs, plus the active base if it
  // somehow isn't among them (e.g. a detached default), so the select can show it.
  const baseOptions = useMemo(() => {
    const refs = branchInfo?.branches ?? [];
    if (displayBase && !refs.includes(displayBase)) return [displayBase, ...refs];
    return refs;
  }, [branchInfo, displayBase]);

  // The picker's <select> renders more than `displayBase`: with `value=""`
  // (no base resolved — a no-remote repo whose current branch is the only
  // candidate) no option matches, so React selects the first non-disabled
  // option and the box shows a real branch name while `displayBase` is null.
  // The select width is measured from this actually-rendered text, otherwise
  // a null base sizes the box to the empty string and clips the name.
  const effectiveBaseLabel =
    branchInfo === null
      ? "Loading…"
      : baseOptions.length === 0
        ? "No branches"
        : (displayBase ?? baseOptions[0] ?? "");

  const isBranchMode = compareMode === "branch";
  const [headerConfigIndex, setHeaderConfigIndex] = useState(0);

  const headerLayout = useMemo(() => {
    const result = computeHeaderLayout({
      availableWidth: headerWidth,
      pr,
      isBranchMode,
      selectedBranch: effectiveBaseLabel,
      additions: totals.additions,
      deletions: totals.deletions,
      binaryCount: totals.binaries,
      previousConfigIndex: headerConfigIndex,
    });
    return result;
  }, [headerWidth, pr, isBranchMode, effectiveBaseLabel, totals, headerConfigIndex]);

  useLayoutEffect(() => {
    setHeaderConfigIndex(headerLayout.configIndex);
  }, [headerLayout.configIndex]);

  if (!mounted) return null;

  const isVisible = open && settled;
  const isRepo = (displayFileList?.isRepo ?? true) && (branchInfo?.isRepo ?? true);
  const isEmpty = displayFileList !== null && isRepo && files.length === 0;
  // Branch metadata is leased but no plausible base branch exists (e.g. a
  // single-branch repo).
  const branchNoBase = isBranchMode && branchInfo !== null && displayBase === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="git diff viewer"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <header
          ref={headerRef}
          className={cn(
            "flex shrink-0 items-center border-b border-border/40 py-2.5",
            headerLayout.showTitle
              ? "gap-3 px-4"
              : headerLayout.headerPadding === DIFF_VIEWER_COMPACT_HEADER_PADDING_PX
                ? "gap-2 px-3"
                : "gap-3 px-4",
          )}
        >
          {headerLayout.showTitle ? (
            <h2 className="shrink-0 text-sm font-medium text-foreground">Changes</h2>
          ) : null}
          <div
            role="radiogroup"
            aria-label="diff comparison"
            className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5"
          >
            {(headerLayout.compareLabels === "full"
              ? FULL_COMPARISON_OPTIONS
              : COMPACT_COMPARISON_OPTIONS
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={compareMode === mode}
                onClick={() => handleCompareModeChange(mode)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors",
                  compareMode === mode
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isBranchMode ? (
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              {headerLayout.showVs ? <span className="shrink-0">vs</span> : null}
              <select
                aria-label="base branch"
                value={displayBase ?? ""}
                disabled={branchInfo === null}
                onChange={(event) => setBaseOverride(event.target.value || null)}
                style={{ width: headerLayout.selectWidthPx || undefined }}
                className="shrink-0 rounded-md border border-border/60 bg-background px-1.5 py-0.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50 [&>option]:bg-popover [&>option]:text-foreground"
              >
                {branchInfo === null ? (
                  <option value="">Loading…</option>
                ) : baseOptions.length === 0 ? (
                  <option value="">No branches</option>
                ) : (
                  baseOptions.map((ref) => (
                    <option key={ref} value={ref}>
                      {ref}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : null}
          {pr ? (
            <DiffViewerPrBadge
              pr={pr}
              currentBranch={branchInfo?.currentBranch ?? null}
              hideTitle={!headerLayout.prShowTitle}
            />
          ) : null}
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            <span className={DIFF_ADDITIONS_CLASSES}>+{totals.additions.toLocaleString()}</span>{" "}
            <span className={DIFF_DELETIONS_CLASSES}>−{totals.deletions.toLocaleString()}</span>
            {totals.binaries > 0 && headerLayout.showBinaryCount ? (
              <span className="text-muted-foreground/70"> · {totals.binaries} binary</span>
            ) : null}
          </span>
          {displayFileList === null ? (
            <Spinner className="size-3.5" aria-label="loading diff" />
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <div
              role="radiogroup"
              aria-label="diff layout"
              className="flex items-center rounded-md border border-border/60 p-0.5"
            >
              {DIFF_VIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={viewMode === mode}
                  onClick={() => handleViewModeChange(mode)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs transition-colors",
                    headerLayout.layoutLabels === "full" && "capitalize",
                    viewMode === mode
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {headerLayout.layoutLabels === "full" ? mode : mode[0].toUpperCase()}
                </button>
              ))}
            </div>
            {headerLayout.showRefresh ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRefresh}
                aria-label="refresh diff"
                className="hover:text-foreground"
              >
                <RefreshCw />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="close diff viewer"
              className="hover:text-foreground"
            >
              <X />
            </Button>
          </div>
        </header>

        {hasError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Couldn't load the diff from the localterm daemon.
            <Button variant="outline" size="xs" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        ) : !isRepo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Not a git repository.
          </div>
        ) : branchNoBase ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Couldn't find a base branch to compare against. Pick one once more branches exist.
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {isBranchMode
              ? `No changes between ${displayBase ?? "the base branch"} and your working tree.`
              : "Working tree clean — nothing to diff."}
          </div>
        ) : displayFileList === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner aria-label="loading diff" />
          </div>
        ) : (
          <div ref={contentRowRef} className="flex min-h-0 flex-1">
            <div
              style={{ width: sidebarCollapsed ? 0 : DIFF_VIEWER_SIDEBAR_WIDTH_PX }}
              className="h-full shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-snappy"
            >
              <div
                style={{ width: DIFF_VIEWER_SIDEBAR_WIDTH_PX }}
                className={cn(
                  "flex h-full flex-col border-r border-border/40 opacity-100 transition-opacity duration-200 ease-snappy",
                  sidebarCollapsed && "opacity-0",
                )}
              >
                <FileListSidebar
                  files={files}
                  selectedPath={selectedPath}
                  annotationCounts={annotationCounts}
                  onSelect={setSelectedPath}
                  virtualizerRef={fileListVirtualizerRef}
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {selectedFile ? (
                <>
                  <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-1.5 font-mono text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "min-w-0 truncate transition-opacity duration-200 ease-snappy",
                        sidebarCollapsed ? "opacity-0 absolute pointer-events-none" : "opacity-100",
                      )}
                      dir="rtl"
                      aria-hidden={sidebarCollapsed}
                    >
                      <bdi>
                        {selectedFile.oldPath ? (
                          <>
                            {selectedFile.oldPath}
                            <span className="text-muted-foreground/50"> → </span>
                            <span className="text-foreground">{selectedFile.path}</span>
                          </>
                        ) : (
                          <span className="text-foreground">{selectedFile.path}</span>
                        )}
                      </bdi>
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 transition-opacity duration-200 ease-snappy",
                        sidebarCollapsed ? "opacity-100" : "opacity-0 absolute pointer-events-none",
                      )}
                      aria-hidden={!sidebarCollapsed}
                    >
                      <Popover>
                        <PopoverTrigger
                          className="flex w-full min-w-0 items-center gap-1 rounded-sm border border-border/50 px-1.5 py-0.5 text-foreground outline-none hover:bg-foreground/5"
                          aria-label="select file"
                        >
                          <span className="min-w-0 flex-1 truncate" dir="rtl">
                            <bdi>
                              <span className="text-muted-foreground/60">
                                {selectedFileParts.directory}
                              </span>
                              <span className="text-foreground">{selectedFileParts.basename}</span>
                            </bdi>
                          </span>
                          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                        </PopoverTrigger>
                        <PopoverContent align="start" side="bottom" className="w-72 p-0">
                          <FileListPopover
                            files={files}
                            selectedPath={selectedPath}
                            onSelect={setSelectedPath}
                          />
                        </PopoverContent>
                      </Popover>
                    </span>
                    {openFileAction ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => openFileAction.handler(selectedFile.path)}
                        aria-label={openFileAction.ariaLabel(selectedFile.path)}
                        title={openFileAction.label}
                        className="shrink-0 hover:text-foreground"
                      >
                        <ExternalLink />
                      </Button>
                    ) : null}
                    {!selectedFile.binary ? (
                      <span className="ml-auto shrink-0 tabular-nums">
                        <span className={DIFF_ADDITIONS_CLASSES}>+{selectedFile.additions}</span>{" "}
                        <span className={DIFF_DELETIONS_CLASSES}>−{selectedFile.deletions}</span>
                      </span>
                    ) : null}
                  </div>
                  <div
                    ref={scrollAreaRef}
                    className="min-h-0 flex-1 overflow-auto overscroll-contain"
                  >
                    <FileDiffPane
                      key={selectedFile.path}
                      file={selectedFile}
                      cwd={cwd}
                      payload={patchCache[selectedFile.path] ?? { state: "loading" }}
                      syntaxHighlightColorScheme={syntaxHighlightColorScheme}
                      viewMode={viewMode}
                      annotations={annotations}
                      editingKey={editingKey}
                      pendingRange={pendingRange}
                      dragCancelRef={dragCancelRef}
                      onOpenEditor={openAnnotationEditor}
                      onSaveAnnotation={saveAnnotation}
                      onCancelEditor={cancelAnnotationEditor}
                      onDeleteAnnotation={deleteAnnotation}
                      onRetry={() => loadPatch(selectedFile.path)}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Select a file to view its diff.
                </div>
              )}
            </div>
          </div>
        )}

        {annotationList.length > 0 ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {annotationList.length} pending comment{annotationList.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="xs" onClick={clearAnnotations}>
                Clear all
              </Button>
              {onSendToTerminal ? (
                <Button size="xs" onClick={handleSendToTerminal}>
                  <Send aria-hidden="true" />
                  Send to terminal
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
};
