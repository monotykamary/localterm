import type { GitBranchPrState } from "@monotykamary/localterm-server/protocol";

// GitHub-flavored PR-state colors, shared by the toolbar PR indicator (compact
// icon, uses `text`) and the diff viewer's PR badge (chip, uses `badge`/`hover`):
// open = green, merged = violet, closed = red.
export const PR_STATE_STYLES: Record<
  GitBranchPrState,
  { text: string; badge: string; hover: string }
> = {
  open: {
    text: "text-emerald-400",
    badge: "border-emerald-400/50 bg-emerald-500/15 text-emerald-300",
    hover: "hover:bg-emerald-500/25 hover:text-emerald-200",
  },
  merged: {
    text: "text-violet-400",
    badge: "border-violet-400/50 bg-violet-500/15 text-violet-300",
    hover: "hover:bg-violet-500/25 hover:text-violet-200",
  },
  closed: {
    text: "text-red-400",
    badge: "border-red-400/50 bg-red-500/15 text-red-300",
    hover: "hover:bg-red-500/25 hover:text-red-200",
  },
};
