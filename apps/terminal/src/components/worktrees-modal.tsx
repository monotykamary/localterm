import type { GitWorktree, GitWorktreeListResponse } from "@monotykamary/localterm-server/protocol";
import {
  AlertTriangle,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { WORKTREES_LIST_ROW_HEIGHT_PX, WORKTREES_MODAL_CLOSE_TRANSITION_MS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { fetchGitWorktrees, removeGitWorktree } from "@/utils/fetch-git-worktrees";

interface WorktreesModalProps {
  open: boolean;
  cwd: string | null;
  isMac: boolean;
  // Error from the last create attempt (modal `+` or the global shortcut/command
  // palette). Lifted to the parent so a create fired from outside the modal can
  // surface its failure by opening the modal with this shown.
  createError: string | null;
  onCreate: (openAfter: boolean) => Promise<boolean>;
  onDismissCreateError: () => void;
  onClose: () => void;
  onOpenShell: (cwd: string) => void;
}

const shortSha = (sha: string | null): string => (sha ? sha.slice(0, 7) : "");

const Badge = ({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "muted" | "amber" | "violet";
  title?: string;
}) => (
  <span
    title={title}
    className={cn(
      "shrink-0 rounded border px-1 font-mono text-[10px] tabular-nums",
      tone === "amber" && "border-amber-400/40 bg-amber-400/5 text-amber-300",
      tone === "violet" && "border-violet-400/40 bg-violet-400/5 text-violet-300",
      tone === "muted" && "border-border/60 text-muted-foreground",
    )}
  >
    {children}
  </span>
);

interface WorktreeRowProps {
  worktree: GitWorktree;
  isRemoving: boolean;
  isArmedRemove: boolean;
  onOpen: () => void;
  onArmRemove: () => void;
  onConfirmRemove: () => void;
}

const WorktreeRow = ({
  worktree,
  isRemoving,
  isArmedRemove,
  onOpen,
  onArmRemove,
  onConfirmRemove,
}: WorktreeRowProps) => (
  <div
    role="listitem"
    className="group/worktree flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-foreground/5"
  >
    <div className="flex items-center gap-2">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-xs font-medium text-foreground">
        {worktree.branch ?? "detached"}
      </span>
      {worktree.isCurrent ? (
        <Badge tone="violet">current</Badge>
      ) : worktree.isMain ? (
        <Badge tone="muted" title="the repository's main worktree — can't be removed">
          main
        </Badge>
      ) : null}
      {worktree.isLocked ? (
        <Badge tone="muted" title="locked — exempt from auto-pruning">
          <Lock className="size-2.5" aria-hidden="true" /> locked
        </Badge>
      ) : null}
      {worktree.isPrunable ? (
        <Badge tone="amber" title="git can prune this worktree">
          prunable
        </Badge>
      ) : null}
      {/* The main worktree is never removable (server-enforced); the current
          worktree can't be removed either (git refuses). Both hide the whole
          action cluster. A non-current main still offers "open in a new shell". */}
      {worktree.isCurrent ? null : (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/worktree:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`open ${worktree.branch ?? "detached"} in a new shell`}
            title="open in a new shell"
            className="hover:text-foreground"
            onClick={onOpen}
          >
            <ExternalLink />
          </Button>
          {worktree.isMain ? null : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={
                isArmedRemove
                  ? `confirm removing ${worktree.branch ?? "detached"}`
                  : `remove ${worktree.branch ?? "detached"}`
              }
              disabled={isRemoving}
              onClick={isArmedRemove ? onConfirmRemove : onArmRemove}
              className={cn(
                isArmedRemove ? "text-red-400 hover:text-red-400" : "hover:text-foreground",
              )}
            >
              {isRemoving ? <Spinner className="size-3" aria-label="removing" /> : <Trash2 />}
            </Button>
          )}
        </span>
      )}
    </div>
    <div className="flex items-center gap-2 pl-5.5">
      <span className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-muted-foreground">
        {worktree.displayPath}
      </span>
      {worktree.head ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {shortSha(worktree.head)}
        </span>
      ) : null}
    </div>
  </div>
);

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
  const [data, setData] = useState<GitWorktreeListResponse | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [armedRemovePath, setArmedRemovePath] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    const fetched = await fetchGitWorktrees(cwd);
    if (!fetched) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setData(fetched);
  }, [cwd]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), WORKTREES_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setArmedRemovePath(null);
      return;
    }
    void refresh();
  }, [open, refresh, refreshCount]);

  // Reset everything when the project changes so stale worktrees from another
  // repo never flash in on open.
  useEffect(() => {
    setData(null);
    setHasError(false);
    setArmedRemovePath(null);
    setRemoveError(null);
  }, [cwd]);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  const handleCreate = async () => {
    if (!cwd) return;
    setIsCreating(true);
    onDismissCreateError();
    const ok = await onCreate(false);
    setIsCreating(false);
    if (ok) await refresh();
  };

  const handleArmRemove = (worktree: GitWorktree) => {
    setArmedRemovePath((current) => (current === worktree.path ? null : worktree.path));
  };

  const handleConfirmRemove = async (worktree: GitWorktree) => {
    if (!cwd) return;
    setRemovingPath(worktree.path);
    setArmedRemovePath(null);
    const result = await removeGitWorktree(cwd, worktree.path);
    setRemovingPath(null);
    if (!result.ok) {
      setRemoveError(result.message);
      return;
    }
    await refresh();
  };

  const handleOpenShell = (worktree: GitWorktree) => {
    onOpenShell(worktree.path);
  };

  const isRepo = data?.isRepo ?? true;
  const worktrees = data?.worktrees ?? [];

  const virtualizer = useVirtualizer({
    count: worktrees.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => WORKTREES_LIST_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => worktrees[index].path,
  });

  if (!mounted) return null;

  const isVisible = open && settled;
  const actionError = createError ?? removeError;

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
          "relative z-10 flex h-full max-h-[40rem] w-full max-w-2xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-2.5">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="shrink-0 text-sm font-medium text-foreground">Worktrees</h2>
          {data && isRepo ? (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {worktrees.length}
            </span>
          ) : null}
          {data && isRepo && data.displayBaseDir ? (
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
            {data === null && !hasError ? (
              <Spinner className="size-3.5" aria-label="loading worktrees" />
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRefreshCount((count) => count + 1)}
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
                onClick={() => void handleCreate()}
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={listScrollRef}>
          {!isRepo ? (
            <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FolderGit2 className="size-4" aria-hidden="true" />
              Not a git repository.
            </div>
          ) : hasError ? (
            <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Couldn't load worktrees from the localterm daemon.
              <Button
                variant="outline"
                size="xs"
                onClick={() => setRefreshCount((count) => count + 1)}
              >
                Retry
              </Button>
            </div>
          ) : data === null ? (
            <div className="flex h-full min-h-32 items-center justify-center">
              <Spinner aria-label="loading worktrees" />
            </div>
          ) : worktrees.length === 0 ? (
            <div className="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">
              No worktrees. Create one to get started.
            </div>
          ) : (
            <div role="list" aria-label="git worktrees">
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
                        isRemoving={removingPath === worktree.path}
                        isArmedRemove={armedRemovePath === worktree.path}
                        onOpen={() => handleOpenShell(worktree)}
                        onArmRemove={() => handleArmRemove(worktree)}
                        onConfirmRemove={() => void handleConfirmRemove(worktree)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {actionError ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <AlertTriangle className="size-3.5 shrink-0 text-red-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-red-400">{actionError}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onDismissCreateError();
                setRemoveError(null);
              }}
            >
              Dismiss
            </Button>
          </footer>
        ) : null}
      </div>
    </div>
  );
};
