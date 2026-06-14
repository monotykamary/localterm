import { useCallback, useEffect, useState } from "react";
import type { GitBranchInfo } from "@monotykamary/localterm-server/protocol";
import { fetchGitBranches } from "@/utils/fetch-git-diff";

/**
 * Ambient branch/PR metadata for the active session's cwd — the "reusable
 * lease". Fetched once per cwd (and on explicit refresh), never polled, since PR
 * state only changes on remote events (push/merge/close), not on local edits.
 *
 * Drives the toolbar PR indicator and is handed to the diff viewer so it can
 * open straight into branch mode without waiting on `gh`.
 */
export const useGitBranchInfo = (
  cwd: string | null,
): { branchInfo: GitBranchInfo | null; refresh: () => void } => {
  const [branchInfo, setBranchInfo] = useState<GitBranchInfo | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setBranchInfo(null);
    if (!cwd) return;
    const controller = new AbortController();
    void fetchGitBranches(cwd, controller.signal).then((info) => {
      if (!controller.signal.aborted && info) setBranchInfo(info);
    });
    return () => controller.abort();
  }, [cwd, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { branchInfo, refresh };
};
