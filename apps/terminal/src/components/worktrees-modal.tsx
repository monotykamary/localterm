import type {
  GitWorktree,
  GitWorktreeBaseRef,
  GitWorktreeListResponse,
  WorktreeIncludeFile,
  WorktreeOpenInCommand,
  WorktreeRepoConfig,
} from "@monotykamary/localterm-server/protocol";
import {
  AlertTriangle,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { WorktreeIncludeFileEditor } from "@/components/worktree-include-file-editor";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { WORKTREES_LIST_ROW_HEIGHT_PX, WORKTREES_MODAL_CLOSE_TRANSITION_MS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  fetchGitWorktrees,
  fetchWorktreeConfig,
  fetchWorktreeIncludeFile,
  launchCommand,
  removeGitWorktree,
  sweepWorktrees,
  updateWorktreeConfig,
  updateWorktreeIncludeFile,
  type CreateWorktreeOptions,
} from "@/utils/fetch-git-worktrees";

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
  openInCommands: WorktreeOpenInCommand[];
  isRemoving: boolean;
  isArmedRemove: boolean;
  isLaunching: boolean;
  onOpen: () => void;
  onArmRemove: () => void;
  onConfirmRemove: () => void;
  onLaunch: (command: string, label: string) => void;
}

const WorktreeRow = ({
  worktree,
  openInCommands,
  isRemoving,
  isArmedRemove,
  isLaunching,
  onOpen,
  onArmRemove,
  onConfirmRemove,
  onLaunch,
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
          {isLaunching ? (
            <Spinner className="size-3" aria-label="launching" />
          ) : (
            openInCommands.map((command) => (
              <Button
                key={command.id}
                variant="ghost"
                size="xs"
                aria-label={`open in ${command.label}`}
                title={`open in ${command.label}`}
                className="h-5 px-1.5 text-[10px] hover:text-foreground"
                onClick={() => onLaunch(command.command, command.label)}
              >
                {command.label}
              </Button>
            ))
          )}
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

const BASE_REF_OPTIONS: ReadonlyArray<{ value: GitWorktreeBaseRef; label: string; hint: string }> =
  [
    { value: "fresh", label: "Remote default", hint: "origin/HEAD (fetches first)" },
    { value: "head", label: "Local HEAD", hint: "current branch + unpushed work" },
  ];

const freshId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [config, setConfig] = useState<WorktreeRepoConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [includeFile, setIncludeFile] = useState<WorktreeIncludeFile | null>(null);
  const [includeFileError, setIncludeFileError] = useState(false);
  const [view, setView] = useState<"list" | "settings">("list");
  const [sweepInFlight, setSweepInFlight] = useState(false);
  const [sweepRemovedCount, setSweepRemovedCount] = useState<number | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [prValue, setPrValue] = useState("");
  const [prError, setPrError] = useState<string | null>(null);
  const [isPrCreating, setIsPrCreating] = useState(false);
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

  const refreshConfig = useCallback(async () => {
    if (!cwd) return;
    const fetched = await fetchWorktreeConfig(cwd);
    if (!fetched) {
      setConfigError(true);
      return;
    }
    setConfigError(false);
    setConfig(fetched);
  }, [cwd]);

  const refreshIncludeFile = useCallback(async () => {
    if (!cwd) return;
    const fetched = await fetchWorktreeIncludeFile(cwd);
    if (!fetched) {
      setIncludeFileError(true);
      return;
    }
    setIncludeFileError(false);
    setIncludeFile(fetched);
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
      setView("list");
      setPrOpen(false);
      setPrValue("");
      setPrError(null);
      setSweepRemovedCount(null);
      return;
    }
    void refresh();
    void refreshConfig();
    void refreshIncludeFile();
  }, [open, refresh, refreshConfig, refreshIncludeFile, refreshCount]);

  // Reset everything when the project changes so stale worktrees from another
  // repo never flash in on open.
  useEffect(() => {
    setData(null);
    setHasError(false);
    setArmedRemovePath(null);
    setRemoveError(null);
    setConfig(null);
    setConfigError(false);
    setIncludeFile(null);
    setIncludeFileError(false);
    setView("list");
  }, [cwd]);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (prOpen) {
        setPrOpen(false);
        setPrError(null);
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
  }, [open, mounted, onClose, prOpen, view]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  const handleCreate = async () => {
    if (!cwd) return;
    setIsCreating(true);
    onDismissCreateError();
    const ok = await onCreate({}, false);
    setIsCreating(false);
    if (ok) await refresh();
  };

  const handlePrCreate = async () => {
    if (!cwd) return;
    const trimmed = prValue.trim();
    if (!/^\d+$/.test(trimmed)) {
      setPrError("Enter a PR number");
      return;
    }
    const pullRequestNumber = Number(trimmed);
    if (pullRequestNumber <= 0) {
      setPrError("PR number must be positive");
      return;
    }
    setIsPrCreating(true);
    onDismissCreateError();
    const ok = await onCreate({ pullRequestNumber }, true);
    setIsPrCreating(false);
    if (ok) {
      setPrOpen(false);
      setPrValue("");
      setPrError(null);
      return;
    }
    // The create error is surfaced in the footer via createError; keep the PR
    // input open so the user can correct a bad number.
    setPrError(null);
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

  const handleLaunch = async (worktree: GitWorktree, command: string) => {
    const result = await launchCommand(worktree.path, command);
    if (result.ok) return;
    setRemoveError(result.message ?? "couldn't launch command");
  };

  const handleSweep = async () => {
    if (!cwd) return;
    setSweepInFlight(true);
    setSweepRemovedCount(null);
    const result = await sweepWorktrees(cwd);
    setSweepInFlight(false);
    if (!result) {
      setRemoveError("couldn't reach the localterm daemon");
      return;
    }
    setSweepRemovedCount(result.removed.length);
    await refresh();
  };

  const isRepo = data?.isRepo ?? true;
  const worktrees = data?.worktrees ?? [];
  const openInCommands = config?.openInCommands ?? [];

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
          "relative z-10 flex h-full max-h-[40rem] w-full max-w-2xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
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
                    onClick={() => void handleSweep()}
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
                    onClick={() => setPrOpen((previous) => !previous)}
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
              await refreshConfig();
              await refreshIncludeFile();
              setView("list");
            }}
          />
        ) : (
          <>
            {prOpen ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-2">
                <GitPullRequest
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={prValue}
                  onChange={(event) => setPrValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handlePrCreate();
                    }
                  }}
                  placeholder="Open PR #1234 as a worktree"
                  inputMode="numeric"
                  autoFocus
                  className="h-6 flex-1 text-xs"
                  aria-label="pull request number"
                />
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => void handlePrCreate()}
                  disabled={isPrCreating || prValue.trim() === ""}
                >
                  {isPrCreating ? <Spinner className="size-3" aria-label="creating" /> : "Create"}
                </Button>
                {prError ? (
                  <span className="shrink-0 text-[10px] text-red-400">{prError}</span>
                ) : null}
              </div>
            ) : null}
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
                            openInCommands={openInCommands}
                            isRemoving={removingPath === worktree.path}
                            isArmedRemove={armedRemovePath === worktree.path}
                            isLaunching={launchingPath === worktree.path}
                            onOpen={() => handleOpenShell(worktree)}
                            onArmRemove={() => handleArmRemove(worktree)}
                            onConfirmRemove={() => void handleConfirmRemove(worktree)}
                            onLaunch={(command) => {
                              setLaunchingPath(worktree.path);
                              void handleLaunch(worktree, command).finally(() =>
                                setLaunchingPath(null),
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

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
                setSweepRemovedCount(null);
              }}
            >
              Dismiss
            </Button>
          </footer>
        ) : sweepMessage ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <WandSparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {sweepMessage}
            </span>
            <Button variant="ghost" size="xs" onClick={() => setSweepRemovedCount(null)}>
              Dismiss
            </Button>
          </footer>
        ) : null}
      </div>
    </div>
  );
};

interface WorktreeSettingsPanelProps {
  cwd: string | null;
  config: WorktreeRepoConfig | null;
  configError: boolean;
  includeFile: WorktreeIncludeFile | null;
  includeFileError: boolean;
  isRepo: boolean;
  onSaved: () => Promise<void>;
}

const WorktreeSettingsPanel = ({
  cwd,
  config,
  configError,
  includeFile,
  includeFileError,
  isRepo,
  onSaved,
}: WorktreeSettingsPanelProps) => {
  const [baseRef, setBaseRef] = useState<GitWorktreeBaseRef>("fresh");
  const [setupScript, setSetupScript] = useState("");
  const [openInDrafts, setOpenInDrafts] = useState<WorktreeOpenInCommand[]>([]);
  const [includeContent, setIncludeContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [includeContentInitialized, setIncludeContentInitialized] = useState(false);

  // Seed the draft from the loaded config once (and re-seed if the repo changes
  // before the user has edited anything).
  useEffect(() => {
    if (!config || initialized) return;
    setBaseRef(config.baseRef);
    setSetupScript(config.setupScript);
    setOpenInDrafts(config.openInCommands.map((entry) => ({ ...entry })));
    setInitialized(true);
  }, [config, initialized]);

  useEffect(() => {
    if (!includeFile || includeContentInitialized) return;
    setIncludeContent(includeFile.content);
    setIncludeContentInitialized(true);
  }, [includeFile, includeContentInitialized]);

  if (configError) {
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Couldn't load worktree settings from the localterm daemon.
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center">
        <Spinner aria-label="loading worktree settings" />
      </div>
    );
  }

  const addOpenIn = () =>
    setOpenInDrafts((drafts) => [...drafts, { id: freshId(), label: "", command: "" }]);

  const updateOpenIn = (id: string, patch: Partial<WorktreeOpenInCommand>) =>
    setOpenInDrafts((drafts) =>
      drafts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );

  const removeOpenIn = (id: string) =>
    setOpenInDrafts((drafts) => drafts.filter((entry) => entry.id !== id));

  const handleSave = async () => {
    if (!cwd) return;
    setIsSaving(true);
    setSaveError(null);
    const cleaned = openInDrafts
      .map((entry) => ({
        id: entry.id,
        label: entry.label.trim(),
        command: entry.command.trim(),
      }))
      .filter((entry) => entry.label && entry.command);
    const shouldUpdateIncludeFile =
      isRepo && (includeFile !== null || includeContent.trim() !== "");
    const [updatedConfig, updatedIncludeFile] = await Promise.all([
      updateWorktreeConfig(cwd, {
        baseRef,
        setupScript,
        openInCommands: cleaned,
      }),
      shouldUpdateIncludeFile
        ? updateWorktreeIncludeFile(cwd, includeContent)
        : Promise.resolve(includeFile),
    ]);
    setIsSaving(false);
    if (!updatedConfig || (shouldUpdateIncludeFile && !updatedIncludeFile)) {
      setSaveError("couldn't save settings");
      return;
    }
    setInitialized(false);
    setIncludeContentInitialized(false);
    await onSaved();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="worktree-base-ref" className="text-xs font-medium text-foreground">
            Base ref
          </label>
          <select
            id="worktree-base-ref"
            value={baseRef}
            onChange={(event) => setBaseRef(event.target.value as GitWorktreeBaseRef)}
            className="h-7 rounded border border-border/60 bg-background px-2 text-xs text-foreground outline-none focus:border-foreground/40"
          >
            {BASE_REF_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            New worktrees branch from this ref. Override per create with a PR number.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="worktree-setup-script" className="text-xs font-medium text-foreground">
            Setup script
          </label>
          <Textarea
            id="worktree-setup-script"
            value={setupScript}
            onChange={(event) => setSetupScript(event.target.value)}
            placeholder="pnpm install && cp .env.example .env"
            rows={3}
            className="text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Run as the new worktree's first command when you create + open one, so env copy,
            installs, and db migration run visibly in the right shell.
          </p>
        </div>

        {isRepo ? (
          includeFileError ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Couldn't load .worktreeinclude from the localterm daemon.
              </div>
            </div>
          ) : includeFile ? (
            <WorktreeIncludeFileEditor
              includeFile={includeFile}
              value={includeContent}
              onChange={setIncludeContent}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
              <div className="flex h-20 items-center justify-center rounded border border-dashed border-border/60">
                <Spinner className="size-4" aria-label="loading .worktreeinclude" />
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
            <p className="text-[10px] text-muted-foreground">
              Only available inside a git repository.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Open in…</span>
            <Button variant="ghost" size="xs" onClick={addOpenIn} className="gap-1">
              <Plus className="size-3" aria-hidden="true" /> Add
            </Button>
          </div>
          {openInDrafts.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No launchers. Add one like {`“code .”`} or {`“fork .”`} to open a worktree in an
              external app.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {openInDrafts.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1.5">
                  <Input
                    value={entry.label}
                    onChange={(event) => updateOpenIn(entry.id, { label: event.target.value })}
                    placeholder="label (e.g. VS Code)"
                    className="h-6 w-32 text-xs"
                    aria-label="open in label"
                  />
                  <Input
                    value={entry.command}
                    onChange={(event) => updateOpenIn(entry.id, { command: event.target.value })}
                    placeholder="command (e.g. code .)"
                    className="h-6 flex-1 text-xs"
                    aria-label="open in command"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="remove launcher"
                    onClick={() => removeOpenIn(entry.id)}
                    className="hover:text-foreground"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {saveError ? (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {saveError}
          </div>
        ) : null}
        <div className="flex justify-end gap-1.5">
          <Button variant="default" size="xs" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? (
              <Spinner className="size-3" aria-label="saving" />
            ) : (
              <Save className="size-3" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
