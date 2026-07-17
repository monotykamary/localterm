import type { GitWorktree } from "@monotykamary/localterm-server/protocol";
import { useEffect, useState } from "react";
import { MINIMUM_PULL_REQUEST_NUMBER } from "@/lib/constants";
import {
  launchCommand,
  removeGitWorktree,
  sweepWorktrees,
  type CreateWorktreeOptions,
} from "@/utils/fetch-git-worktrees";

interface UseWorktreeActionsOptions {
  open: boolean;
  cwd: string | null;
  onCreate: (options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>;
  onDismissCreateError: () => void;
  onOpenShell: (cwd: string) => void;
  refresh: () => Promise<void>;
}

interface WorktreeActions {
  isCreating: boolean;
  removeError: string | null;
  armedRemovePath: string | null;
  removingPath: string | null;
  launchingPath: string | null;
  isSweepInFlight: boolean;
  sweepRemovedCount: number | null;
  isPrOpen: boolean;
  prValue: string;
  prError: string | null;
  isPrCreating: boolean;
  create: () => Promise<void>;
  createFromPullRequest: () => Promise<void>;
  armRemove: (worktree: GitWorktree) => void;
  confirmRemove: (worktree: GitWorktree) => Promise<void>;
  openShell: (worktree: GitWorktree) => void;
  launch: (worktree: GitWorktree, command: string) => Promise<void>;
  sweep: () => Promise<void>;
  togglePullRequestForm: () => void;
  closePullRequestForm: () => void;
  setPrValue: (value: string) => void;
  dismissMessages: () => void;
  dismissSweepMessage: () => void;
}

export const useWorktreeActions = ({
  open,
  cwd,
  onCreate,
  onDismissCreateError,
  onOpenShell,
  refresh,
}: UseWorktreeActionsOptions): WorktreeActions => {
  const [isCreating, setIsCreating] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [armedRemovePath, setArmedRemovePath] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [isSweepInFlight, setIsSweepInFlight] = useState(false);
  const [sweepRemovedCount, setSweepRemovedCount] = useState<number | null>(null);
  const [isPrOpen, setIsPrOpen] = useState(false);
  const [prValue, setPrValue] = useState("");
  const [prError, setPrError] = useState<string | null>(null);
  const [isPrCreating, setIsPrCreating] = useState(false);

  const create = async () => {
    if (!cwd) return;
    setIsCreating(true);
    onDismissCreateError();
    const didCreate = await onCreate({}, false);
    setIsCreating(false);
    if (didCreate) await refresh();
  };

  const createFromPullRequest = async () => {
    if (!cwd) return;
    const trimmedPullRequest = prValue.trim();
    if (!/^\d+$/.test(trimmedPullRequest)) {
      setPrError("Enter a PR number");
      return;
    }
    const pullRequestNumber = Number(trimmedPullRequest);
    if (pullRequestNumber < MINIMUM_PULL_REQUEST_NUMBER) {
      setPrError("PR number must be positive");
      return;
    }
    setIsPrCreating(true);
    onDismissCreateError();
    const didCreate = await onCreate({ pullRequestNumber }, true);
    setIsPrCreating(false);
    if (didCreate) {
      setIsPrOpen(false);
      setPrValue("");
      setPrError(null);
      return;
    }
    // The create error is surfaced in the footer via createError; keep the PR
    // input open so the user can correct a bad number.
    setPrError(null);
  };

  const armRemove = (worktree: GitWorktree) => {
    setArmedRemovePath((currentPath) =>
      currentPath === worktree.path ? null : worktree.path,
    );
  };

  const confirmRemove = async (worktree: GitWorktree) => {
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

  const launch = async (worktree: GitWorktree, command: string) => {
    setLaunchingPath(worktree.path);
    const result = await launchCommand(worktree.path, command);
    setLaunchingPath(null);
    if (result.ok) return;
    setRemoveError(result.message ?? "couldn't launch command");
  };

  const sweep = async () => {
    if (!cwd) return;
    setIsSweepInFlight(true);
    setSweepRemovedCount(null);
    const result = await sweepWorktrees(cwd);
    setIsSweepInFlight(false);
    if (!result) {
      setRemoveError("couldn't reach the localterm daemon");
      return;
    }
    setSweepRemovedCount(result.removed.length);
    await refresh();
  };

  const closePullRequestForm = () => {
    setIsPrOpen(false);
    setPrError(null);
  };

  useEffect(() => {
    if (open) return;
    setArmedRemovePath(null);
    setIsPrOpen(false);
    setPrValue("");
    setPrError(null);
    setSweepRemovedCount(null);
  }, [open]);

  useEffect(() => {
    setArmedRemovePath(null);
    setRemoveError(null);
  }, [cwd]);

  const dismissMessages = () => {
    onDismissCreateError();
    setRemoveError(null);
    setSweepRemovedCount(null);
  };

  return {
    isCreating,
    removeError,
    armedRemovePath,
    removingPath,
    launchingPath,
    isSweepInFlight,
    sweepRemovedCount,
    isPrOpen,
    prValue,
    prError,
    isPrCreating,
    create,
    createFromPullRequest,
    armRemove,
    confirmRemove,
    openShell: (worktree) => onOpenShell(worktree.path),
    launch,
    sweep,
    togglePullRequestForm: () => setIsPrOpen((wasOpen) => !wasOpen),
    closePullRequestForm,
    setPrValue,
    dismissMessages,
    dismissSweepMessage: () => setSweepRemovedCount(null),
  };
};
