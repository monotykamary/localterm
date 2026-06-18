import type { GitBranchPr } from "@monotykamary/localterm-server/protocol";
import {
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PrDisplayState = "open" | "draft" | "conflicting" | "closed" | "merged";

export const PR_DISPLAY_STATE_LABELS: Record<PrDisplayState, string> = {
  open: "open",
  draft: "draft",
  conflicting: "conflicted",
  closed: "closed",
  merged: "merged",
};

// GitHub-flavored PR-state colors, shared by the toolbar PR indicator (compact
// icon, uses `text`) and the diff viewer's PR badge (chip, uses `badge`/`hover`):
// open = green, draft = gray, conflicting = amber, closed = red, merged = violet.
export const PR_STATE_STYLES: Record<
  PrDisplayState,
  { text: string; badge: string; hover: string }
> = {
  open: {
    text: "text-emerald-400",
    badge: "border-emerald-400/50 bg-emerald-500/15 text-emerald-300",
    hover: "hover:bg-emerald-500/25 hover:text-emerald-200",
  },
  draft: {
    text: "text-slate-400",
    badge: "border-slate-400/50 bg-slate-500/15 text-slate-300",
    hover: "hover:bg-slate-500/25 hover:text-slate-200",
  },
  conflicting: {
    text: "text-amber-400",
    badge: "border-amber-400/50 bg-amber-500/15 text-amber-300",
    hover: "hover:bg-amber-500/25 hover:text-amber-200",
  },
  closed: {
    text: "text-red-400",
    badge: "border-red-400/50 bg-red-500/15 text-red-300",
    hover: "hover:bg-red-500/25 hover:text-red-200",
  },
  merged: {
    text: "text-violet-400",
    badge: "border-violet-400/50 bg-violet-500/15 text-violet-300",
    hover: "hover:bg-violet-500/25 hover:text-violet-200",
  },
};

export const PR_STATE_ICONS: Record<PrDisplayState, LucideIcon> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  conflicting: GitMergeConflict,
  closed: GitPullRequestClosed,
  merged: GitMerge,
};

// Map a PR's wire state (open/closed/merged), draft flag, and mergeability to a
// single display state that drives both its icon and color. Conflicts outrank
// drafts: a conflicted draft PR still surfaces as conflicted.
export const resolvePrDisplayState = (pr: GitBranchPr): PrDisplayState => {
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.mergeable === "conflicting") return "conflicting";
  if (pr.isDraft) return "draft";
  return "open";
};
