import type { GitWorktree, WorktreeOpenInCommand } from "@monotykamary/localterm-server/protocol";
import { ExternalLink, GitBranch, Lock, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { WORKTREES_LIST_ROW_HEIGHT_PX, WORKTREE_SHORT_SHA_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface WorktreeBadgeProps {
  children: ReactNode;
  tone: "muted" | "amber" | "violet" | "blue";
  title?: string;
}

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

const shortSha = (sha: string | null): string =>
  sha ? sha.slice(0, WORKTREE_SHORT_SHA_LENGTH) : "";

const WorktreeBadge = ({ children, tone, title }: WorktreeBadgeProps) => (
  <span
    title={title}
    className={cn(
      "shrink-0 rounded border px-1 font-mono text-[10px] tabular-nums",
      tone === "amber" && "border-amber-400/40 bg-amber-400/5 text-amber-300",
      tone === "violet" && "border-violet-400/40 bg-violet-400/5 text-violet-300",
      tone === "blue" && "border-blue-400/40 bg-blue-400/5 text-blue-300",
      tone === "muted" && "border-border/60 text-muted-foreground",
    )}
  >
    {children}
  </span>
);

export const WorktreeRow = ({
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
    className="group/worktree flex flex-col justify-center gap-0.5 px-3 py-2 transition-colors hover:bg-foreground/5"
    style={{ minHeight: WORKTREES_LIST_ROW_HEIGHT_PX }}
  >
    <div className="flex items-center gap-2">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-xs font-medium text-foreground">
        {worktree.branch ?? "detached"}
      </span>
      {worktree.isCurrent ? (
        <WorktreeBadge tone="violet">current</WorktreeBadge>
      ) : worktree.isMain ? (
        <WorktreeBadge tone="muted" title="the repository's main worktree — can't be removed">
          main
        </WorktreeBadge>
      ) : null}
      {worktree.isLocked ? (
        <WorktreeBadge tone="muted" title="locked — exempt from auto-pruning">
          <Lock className="size-2.5" aria-hidden="true" /> locked
        </WorktreeBadge>
      ) : null}
      {worktree.isPrunable ? (
        <WorktreeBadge tone="amber" title="git can prune this worktree">
          prunable
        </WorktreeBadge>
      ) : null}
      {!worktree.isMain && !worktree.isCurrent && worktree.activeSessionCount > 0 ? (
        <WorktreeBadge
          tone="blue"
          title={`${worktree.activeSessionCount} shell${worktree.activeSessionCount === 1 ? "" : "s"} open here — close ${worktree.activeSessionCount === 1 ? "it" : "them"} first to remove`}
        >
          {worktree.activeSessionCount === 1 ? "in use" : `${worktree.activeSessionCount} in use`}
        </WorktreeBadge>
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
          {worktree.isMain || worktree.activeSessionCount > 0 ? null : (
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
