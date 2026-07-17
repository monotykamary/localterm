import type { GitBranchPr } from "@monotykamary/localterm-server/protocol";
import {
  PR_DISPLAY_STATE_LABELS,
  PR_STATE_ICONS,
  PR_STATE_STYLES,
  resolvePrDisplayState,
} from "@/lib/pr-state";
import { cn } from "@/lib/utils";

interface DiffViewerPrBadgeProps {
  pr: GitBranchPr;
  currentBranch: string | null;
  hideTitle: boolean;
}

// "This branch has a GitHub PR" chip — color-coded by state and set apart from
// the add/delete greens and reds so a detected PR is obvious at a glance. Links
// to the PR when gh gave us a URL.
export const DiffViewerPrBadge = ({
  pr,
  currentBranch,
  hideTitle,
}: DiffViewerPrBadgeProps) => {
  const displayState = resolvePrDisplayState(pr, currentBranch);
  if (!displayState) return null;
  const PrIcon = PR_STATE_ICONS[displayState];
  const stateLabel = PR_DISPLAY_STATE_LABELS[displayState];
  const style = PR_STATE_STYLES[displayState];
  const className = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
    style.badge,
  );
  const label = `PR #${pr.number} (${stateLabel})${pr.title ? ` — ${pr.title}` : ""}`;
  const content = (
    <>
      <PrIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0">#{pr.number}</span>
      {displayState !== "open" ? (
        <span className="shrink-0 uppercase opacity-70">{stateLabel}</span>
      ) : null}
      {!hideTitle && pr.title ? <span className="opacity-80">{pr.title}</span> : null}
    </>
  );
  return pr.url ? (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={`open ${label}`}
      className={cn(className, style.hover)}
    >
      {content}
    </a>
  ) : (
    <span title={label} aria-label={label} className={className}>
      {content}
    </span>
  );
};
