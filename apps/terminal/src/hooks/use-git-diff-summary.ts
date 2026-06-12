import { useState } from "react";
import type { GitDiffSummary } from "@monotykamary/localterm-server/protocol";

/**
 * Holds the most recent git diff summary pushed over the WebSocket by the
 * server. The server recomputes the summary on git-dirty signals (prompt
 * hooks, fs.watch on .git/index) and pushes it here — no HTTP polling.
 */
export const useGitDiffSummary = (): {
  summary: GitDiffSummary | null;
  setGitDiffSummary: (summary: GitDiffSummary | null) => void;
} => {
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);

  return { summary, setGitDiffSummary: setSummary };
};
