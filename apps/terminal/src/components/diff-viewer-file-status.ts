import type { GitDiffFileMeta } from "@monotykamary/localterm-server/protocol";

interface DiffFileStatusLabel {
  letter: string;
  className: string;
}

export const DIFF_FILE_STATUS_LABELS: Record<GitDiffFileMeta["status"], DiffFileStatusLabel> = {
  modified: { letter: "M", className: "text-[var(--localterm-yellow)]" },
  added: { letter: "A", className: "text-[var(--localterm-green)]" },
  deleted: { letter: "D", className: "text-destructive" },
  renamed: { letter: "R", className: "text-[var(--localterm-blue)]" },
  untracked: { letter: "U", className: "text-[var(--localterm-green)]" },
};

export const DIFF_ADDITIONS_CLASSES = "text-[var(--localterm-green)]";
export const DIFF_DELETIONS_CLASSES = "text-destructive";
