import type {
  GitWorktreeListResponse,
  WorktreeIncludeFile,
  WorktreeRepoConfig,
} from "@monotykamary/localterm-server/protocol";
import { useCallback, useEffect, useState } from "react";
import { WORKTREES_POLL_INTERVAL_MS } from "@/lib/constants";
import {
  fetchGitWorktrees,
  fetchWorktreeConfig,
  fetchWorktreeIncludeFile,
} from "@/utils/fetch-git-worktrees";

interface WorktreeResources {
  data: GitWorktreeListResponse | null;
  hasError: boolean;
  config: WorktreeRepoConfig | null;
  configError: boolean;
  includeFile: WorktreeIncludeFile | null;
  includeFileError: boolean;
  refresh: (silent?: boolean) => Promise<void>;
  refreshConfig: () => Promise<void>;
  refreshIncludeFile: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const useWorktreeResources = (open: boolean, cwd: string | null): WorktreeResources => {
  const [data, setData] = useState<GitWorktreeListResponse | null>(null);
  const [hasError, setHasError] = useState(false);
  const [config, setConfig] = useState<WorktreeRepoConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [includeFile, setIncludeFile] = useState<WorktreeIncludeFile | null>(null);
  const [includeFileError, setIncludeFileError] = useState(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (!cwd) return;
      const fetchedWorktrees = await fetchGitWorktrees(cwd);
      if (!fetchedWorktrees) {
        // A background poll that fails must not replace a good list with the
        // error block — only user-initiated loads (open, manual refresh) surface
        // the error. A successful poll still clears a stale error and recovers.
        if (!silent) setHasError(true);
        return;
      }
      setHasError(false);
      setData(fetchedWorktrees);
    },
    [cwd],
  );

  const refreshConfig = useCallback(async () => {
    if (!cwd) return;
    const fetchedConfig = await fetchWorktreeConfig(cwd);
    if (!fetchedConfig) {
      setConfigError(true);
      return;
    }
    setConfigError(false);
    setConfig(fetchedConfig);
  }, [cwd]);

  const refreshIncludeFile = useCallback(async () => {
    if (!cwd) return;
    const fetchedIncludeFile = await fetchWorktreeIncludeFile(cwd);
    if (!fetchedIncludeFile) {
      setIncludeFileError(true);
      return;
    }
    setIncludeFileError(false);
    setIncludeFile(fetchedIncludeFile);
  }, [cwd]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshConfig(), refreshIncludeFile()]);
  }, [refresh, refreshConfig, refreshIncludeFile]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    void refreshConfig();
    void refreshIncludeFile();
  }, [open, refresh, refreshConfig, refreshIncludeFile]);

  // Poll the worktree list while the modal is open so the per-worktree "in use"
  // count — and the trash action that depends on it — tracks shells opened or
  // closed while the modal is up, including one opened from this modal's own
  // "open in new shell" button. Silent: a transient daemon blip won't swap a
  // good list for the error block.
  useEffect(() => {
    if (!open) return;
    const tick = window.setInterval(() => void refresh(true), WORKTREES_POLL_INTERVAL_MS);
    return () => window.clearInterval(tick);
  }, [open, refresh]);

  // Reset everything when the project changes so stale worktrees from another
  // repo never flash in on open.
  useEffect(() => {
    setData(null);
    setHasError(false);
    setConfig(null);
    setConfigError(false);
    setIncludeFile(null);
    setIncludeFileError(false);
  }, [cwd]);

  return {
    data,
    hasError,
    config,
    configError,
    includeFile,
    includeFileError,
    refresh,
    refreshConfig,
    refreshIncludeFile,
    refreshAll,
  };
};
