import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitBranchInfo, GitBranchPr } from "@monotykamary/localterm-server/protocol";
import { fetchGitBranchPr, fetchGitBranches } from "@/utils/fetch-git-diff";
import { GIT_PR_INLINE_FRESH_MS } from "@/lib/constants";
import { parseGitHubPrUrl } from "@/utils/parse-pr-url";

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
 * `notePrCreated` inline-sets a PR from a freshly-observed creation URL (the
 * injected `gh` wrapper, or a URL scanned from the PTY stream when an agent
 * created the PR silently) so the overlay appears with no `gh` round-trip.
 * `refreshUnlessFresh` re-leases only if an inline set didn't land very
 * recently — the foreground-exit fallback uses it to skip a redundant subprocess
 * when the inline path already caught the creation.
 */
export interface GitBranchInfoLease {
  branchInfo: GitBranchInfo | null;
  refresh: () => void;
  notePrCreated: (url: string) => void;
  refreshUnlessFresh: () => void;
}

export const useGitBranchInfo = (cwd: string | null): GitBranchInfoLease => {
  const [branchData, setBranchData] = useState<GitBranchInfo | null>(null);
  const [pr, setPr] = useState<GitBranchPr | null>(null);
  const [nonce, setNonce] = useState(0);
  const inlinePrSetAtRef = useRef(0);

  useEffect(() => {
    setBranchData(null);
    setPr(null);
    inlinePrSetAtRef.current = 0;
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

  // Inline-set a PR from a creation URL so the toolbar overlay appears right
  // away. The base ref is best-effort — the repo default branch from the fast
  // local lease — and is corrected on the next cwd/branch re-lease or when the
  // diff viewer resolves the base server-side. Falls back to a full refresh if
  // the URL can't be parsed or the lease hasn't resolved a base to seed from.
  const notePrCreated = useCallback(
    (url: string) => {
      const parsed = parseGitHubPrUrl(url);
      const defaultBase = branchData?.defaultBase ?? null;
      if (!parsed || !defaultBase) {
        setNonce((value) => value + 1);
        return;
      }
      const baseRef = defaultBase;
      const lastSlash = baseRef.lastIndexOf("/");
      const baseRefName = lastSlash === -1 ? baseRef : baseRef.slice(lastSlash + 1);
      setPr({
        number: parsed.number,
        title: "",
        baseRefName,
        baseRef,
        url,
        state: "open",
      });
      inlinePrSetAtRef.current = Date.now();
    },
    [branchData?.defaultBase],
  );

  const refreshUnlessFresh = useCallback(() => {
    if (Date.now() - inlinePrSetAtRef.current < GIT_PR_INLINE_FRESH_MS) return;
    setNonce((value) => value + 1);
  }, []);

  const branchInfo = useMemo(() => (branchData ? { ...branchData, pr } : null), [branchData, pr]);
  return { branchInfo, refresh, notePrCreated, refreshUnlessFresh };
};
