import {
  AlertTriangle,
  FolderGit2,
  GitPullRequest,
  Plus,
  RefreshCw,
  Settings,
  WandSparkles,
  X,
} from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PullRequestWorktreeForm } from "@/components/pull-request-worktree-form";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { WorktreeRow } from "@/components/worktree-row";
import { WorktreeSettingsPanel } from "@/components/worktree-settings-panel";
import { useWorktreeActions } from "@/hooks/use-worktree-actions";
import { useWorktreeResources } from "@/hooks/use-worktree-resources";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  WORKTREES_LIST_OVERSCAN_COUNT,
  WORKTREES_LIST_ROW_HEIGHT_PX,
  WORKTREES_MESSAGE_BLOCK_MIN_HEIGHT_PX,
  WORKTREES_MODAL_CLOSE_TRANSITION_MS,
  WORKTREES_MODAL_MAX_HEIGHT_REM,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";

interface WorktreesModalProps {
  open: boolean;
  cwd: string | null;
  isMac: boolean;
  createError: string | null;
  onCreate: (options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>;
  onDismissCreateError: () => void;
  onClose: () => void;
  onOpenShell: (cwd: string) => void;
}

export const WorktreesModal = ({
  open,
  cwd,
  isMac,
  createError,
  onCreate,
  onDismissCreateError,
  onClose,
  onOpenShell,
}: WorktreesModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [view, setView] = useState<"list" | "settings">("list");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const resources = useWorktreeResources(open, cwd);
  const actions = useWorktreeActions({
    open,
    cwd,
    onCreate,
    onDismissCreateError,
    onOpenShell,
    refresh: resources.refresh,
  });
  const { data, hasError, config, configError, includeFile, includeFileError } = resources;
  const {
    isCreating,
    removeError,
    armedRemovePath,
    removingPath,
    launchingPath,
    isSweepInFlight: sweepInFlight,
    sweepRemovedCount,
    isPrOpen: prOpen,
    prValue,
    prError,
    isPrCreating,
  } = actions;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    setView("list");
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), WORKTREES_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open, mounted]);

  useEffect(() => {
    setView("list");
  }, [cwd]);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (prOpen) {
        actions.closePullRequestForm();
        return;
      }
      if (view === "settings") {
        setView("list");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose, prOpen, view, actions]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  const isRepo = data?.isRepo ?? true;
  const worktrees = data?.worktrees ?? [];
  const openInCommands = config?.openInCommands ?? [];

  const virtualizer = useVirtualizer({
    count: worktrees.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => WORKTREES_LIST_ROW_HEIGHT_PX,
    overscan: WORKTREES_LIST_OVERSCAN_COUNT,
    getItemKey: (index) => worktrees[index].path,
  });

  if (!mounted) return null;

  const isVisible = open && settled;
  const listHeightPx = hasError
    ? WORKTREES_MESSAGE_BLOCK_MIN_HEIGHT_PX
    : Math.max(WORKTREES_LIST_ROW_HEIGHT_PX, virtualizer.getTotalSize());
  const actionError = createError ?? removeError;
  const sweepMessage =
    sweepRemovedCount !== null
      ? sweepRemovedCount === 0
        ? "No stale worktrees to remove"
        : `Removed ${sweepRemovedCount} stale worktree${sweepRemovedCount === 1 ? "" : "s"}`
      : null;

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
        aria-label="git worktrees"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
        style={{ maxHeight: `min(100%, ${WORKTREES_MODAL_MAX_HEIGHT_REM}rem)` }}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-2.5">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="shrink-0 text-sm font-medium text-foreground">Worktrees</h2>
          {view === "list" && data && isRepo ? (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {worktrees.length}
            </span>
          ) : null}
          {view === "list" && data && isRepo && data.displayBaseDir ? (
            <span
              className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/60"
              title={data.displayBaseDir}
            >
              {data.displayBaseDir}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-1">
            {view === "list" && data === null && !hasError ? (
              <Spinner className="size-3.5" aria-label="loading worktrees" />
            ) : null}
            {view === "list" ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void resources.refresh()}
                  aria-label="refresh worktrees"
                  title="refresh"
                  className="hover:text-foreground"
                >
                  <RefreshCw />
                </Button>
                {isRepo ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void actions.sweep()}
                    disabled={sweepInFlight}
                    aria-label="sweep stale worktrees"
                    title="sweep stale worktrees"
                    className="hover:text-foreground"
                  >
                    {sweepInFlight ? (
                      <Spinner className="size-3.5" aria-label="sweeping" />
                    ) : (
                      <WandSparkles />
                    )}
                  </Button>
                ) : null}
                {isRepo ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={actions.togglePullRequestForm}
                    aria-label="create worktree from pull request"
                    title="new from PR…"
                    className={cn(prOpen && "text-foreground", "hover:text-foreground")}
                  >
                    <GitPullRequest />
                  </Button>
                ) : null}
                {isRepo ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void actions.create()}
                    disabled={isCreating}
                    aria-label="new worktree"
                    title="new worktree"
                    className="hover:text-foreground"
                  >
                    {isCreating ? (
                      <Spinner className="size-3.5" aria-label="creating worktree" />
                    ) : (
                      <Plus />
                    )}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setView(view === "settings" ? "list" : "settings")}
              aria-label={view === "settings" ? "back to worktrees" : "worktree settings"}
              title={view === "settings" ? "done" : "settings"}
              className={cn(view === "settings" && "text-foreground", "hover:text-foreground")}
            >
              <Settings />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="close worktrees"
              title={`${isMac ? "⌘" : "Ctrl+"}B`}
              className="hover:text-foreground"
            >
              <X />
            </Button>
          </div>
        </header>

        {view === "settings" ? (
          <WorktreeSettingsPanel
            cwd={cwd}
            config={config}
            configError={configError}
            includeFile={includeFile}
            includeFileError={includeFileError}
            isRepo={isRepo}
            onSaved={async () => {
              await resources.refreshConfig();
              await resources.refreshIncludeFile();
              setView("list");
            }}
          />
        ) : (
          <>
            {prOpen ? (
              <PullRequestWorktreeForm
                value={prValue}
                error={prError}
                isCreating={isPrCreating}
                onChange={actions.setPrValue}
                onCreate={() => void actions.createFromPullRequest()}
              />
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={listScrollRef}>
              <div
                className="relative transition-[height] duration-150 ease-snappy"
                style={{ height: listHeightPx }}
              >
                {!isRepo ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <FolderGit2 className="size-4" aria-hidden="true" />
                    Not a git repository.
                  </div>
                ) : hasError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    Couldn't load worktrees from the localterm daemon.
                    <Button variant="outline" size="xs" onClick={() => void resources.refresh()}>
                      Retry
                    </Button>
                  </div>
                ) : data === null ? null : worktrees.length === 0 ? (
                  <div className="animate-in fade-in-0 duration-150 ease-snappy absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    No worktrees. Create one to get started.
                  </div>
                ) : (
                  <div
                    role="list"
                    aria-label="git worktrees"
                    className="animate-in fade-in-0 duration-150 ease-snappy"
                  >
                    <div
                      style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
                        const worktree = worktrees[virtualRow.index];
                        return (
                          <div
                            key={worktree.path}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                            style={
                              {
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${virtualRow.start}px)`,
                              } satisfies CSSProperties
                            }
                          >
                            <WorktreeRow
                              worktree={worktree}
                              openInCommands={openInCommands}
                              isRemoving={removingPath === worktree.path}
                              isArmedRemove={armedRemovePath === worktree.path}
                              isLaunching={launchingPath === worktree.path}
                              onOpen={() => actions.openShell(worktree)}
                              onArmRemove={() => actions.armRemove(worktree)}
                              onConfirmRemove={() => void actions.confirmRemove(worktree)}
                              onLaunch={(command) => void actions.launch(worktree, command)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {actionError ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <AlertTriangle className="size-3.5 shrink-0 text-red-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-red-400">{actionError}</span>
            <Button variant="ghost" size="xs" onClick={actions.dismissMessages}>
              Dismiss
            </Button>
          </footer>
        ) : sweepMessage ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <WandSparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {sweepMessage}
            </span>
            <Button variant="ghost" size="xs" onClick={actions.dismissSweepMessage}>
              Dismiss
            </Button>
          </footer>
        ) : null}
      </div>
    </div>
  );
};
