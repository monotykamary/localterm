import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitBranchInfo, GitBranchPr } from "@monotykamary/localterm-server/protocol";
import { fetchGitBranchPr, fetchGitBranches } from "@/utils/fetch-git-diff";

/**
 * Ambient branch/PR metadata for the active session's cwd — the "reusable
 * lease". Fetched once per cwd (and on explicit refresh), never polled, since PR
 * state only changes on remote events (push/merge/close), not on local edits.
 *
 * Drives the toolbar PR indicator and is handed to the diff viewer so it can
 * open straight into branch mode without waiting on `gh`.
 *
 * The branch refs / default base are pure-local and resolve instantly, so the
 * toolbar paints right away. The PR hits the GitHub REST API and is fired in
 * parallel from a separate lease; `pr` is merged into the returned branch info
 * once it resolves, so the indicator lands without blocking the toolbar.
 *
 * `setPushedPr` absorbs server-pushed `git-branch-pr` messages so a PR state
 * change one sibling tab observed (via its own refresh) propagates to every tab
 * in the same cwd — closing the gap where a remote merge produced no local
 * git-dirty signal for the siblings to refetch from.
 */
export const useGitBranchInfo = (
  cwd: string | null,
): {
  branchInfo: GitBranchInfo | null;
  refresh: () => void;
  setPushedPr: (pr: GitBranchPr | null) => void;
} => {
  const [branchData, setBranchData] = useState<GitBranchInfo | null>(null);
  const [pr, setPr] = useState<GitBranchPr | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setBranchData(null);
    setPr(null);
    if (!cwd) return;
    const controller = new AbortController();
    void fetchGitBranches(cwd, controller.signal).then((info) => {
      if (!controller.signal.aborted && info) setBranchData({ ...info, pr: null });
    });
    void fetchGitBranchPr(cwd, controller.signal).then((resolved) => {
      if (!controller.signal.aborted) setPr(resolved);
    });
    return () => controller.abort();
  }, [cwd, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const branchInfo = useMemo(() => (branchData ? { ...branchData, pr } : null), [branchData, pr]);
  return { branchInfo, refresh, setPushedPr: setPr };
};
