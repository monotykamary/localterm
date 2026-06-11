import { useEffect, useState } from "react";
import type { GitDiffSummary } from "@monotykamary/localterm-server/protocol";
import { GIT_DIFF_SUMMARY_POLL_INTERVAL_MS } from "@/lib/constants";
import { fetchGitDiffSummary } from "@/utils/fetch-git-diff";

/**
 * Poll the daemon for working-tree diff stats of the session's cwd.
 *
 * Polls on an interval while the tab is visible, immediately on cwd change
 * and on the tab becoming visible again. Fetch failures keep the last known
 * summary (a network blip shouldn't blink the indicator); a cwd change
 * resets it so one repo's stats never show over another's.
 */
export const useGitDiffSummary = (cwd: string | null): GitDiffSummary | null => {
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    if (!cwd) return;

    let disposed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (disposed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(tick, GIT_DIFF_SUMMARY_POLL_INTERVAL_MS);
    };

    const tick = () => {
      // Also reachable outside the timeout (visibility change), so clear any
      // pending timer to avoid forking parallel poll chains.
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (disposed) return;
      if (document.hidden) {
        schedule();
        return;
      }
      controller?.abort();
      controller = new AbortController();
      void fetchGitDiffSummary(cwd, controller.signal).then((next) => {
        if (disposed) return;
        if (next) setSummary(next);
        schedule();
      });
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    tick();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [cwd]);

  return summary;
};
