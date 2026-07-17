import type {
  AgentSessionEntry,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { ArrowUpRight, ChevronDown, ChevronLeft, ExternalLink, Sparkles } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { Markdown } from "@/components/markdown";
import { Spinner } from "@/components/ui/spinner";
import { RUN_LOG_AT_BOTTOM_THRESHOLD_PX, TOOL_OUTPUT_PREVIEW_LINES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { fetchAgentSession } from "@/utils/fetch-agent-session";
import { fetchAgentSessionUrl } from "@/utils/fetch-agent-session-url";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { getAutomationRunTimestamp } from "@/utils/get-automation-run-timestamp";
import { isScrolledToBottom } from "@/utils/is-scrolled-to-bottom";
import { runStatusBadge } from "@/utils/run-status-badge";

interface ToolLogEntryProps {
  entry: Extract<AgentSessionEntry, { type: "tool" }>;
}

interface AutomationRunLogViewProps {
  automationId: string;
  runId: string;
  automations: AutomationWithNextRun[];
  nowMs: number;
  onBack: () => void;
  onOpenAutomation: (id: string) => void;
}

// A tool entry collapses its output to a pi-like preview (first N lines) with
// an expand toggle; a short output renders in full.
const ToolLogEntry = ({ entry }: ToolLogEntryProps) => {
  const [expanded, setExpanded] = useState(false);
  const lines = entry.text.split("\n");
  const collapsible = lines.length > TOOL_OUTPUT_PREVIEW_LINES;
  const visible =
    collapsible && !expanded ? lines.slice(0, TOOL_OUTPUT_PREVIEW_LINES).join("\n") : entry.text;
  return (
    <div className="rounded-sm border border-border/60 bg-foreground/5 p-2">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-[var(--localterm-green)]">
          {entry.name}
        </span>
        {entry.input ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {entry.input}
          </span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-words text-foreground/80">{visible}</pre>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[10px] text-[var(--localterm-green)] transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
};

const BlankLine = () => <div aria-hidden="true">&nbsp;</div>;

// A full-pane log page for a single run: a back chevron + the automation name
// and run metadata, then the full log (or findings) in a scrollable block. Long
// logs scroll here instead of expanding inline, which invited bad UX.
// Colors follow pi's transcript conventions: grey for user, transparent for
// assistant, green for tool, purple for compaction.
const renderLogEntry = (
  entry: AgentSessionEntry,
  index: number,
  cwd: string | undefined,
  onOpenFile: ((filePath: string) => void) | undefined,
) => {
  if (entry.type === "compaction") {
    return (
      <div key={index} className="rounded-sm border border-border/60 bg-foreground/5 p-2">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--localterm-magenta)]">
          <Sparkles className="size-3" aria-hidden="true" />
          compaction
          {typeof entry.tokensBefore === "number"
            ? ` · ${entry.tokensBefore.toLocaleString()} tokens`
            : ""}
        </div>
        <div className="text-foreground/80">
          <Markdown cwd={cwd} onOpenFile={onOpenFile}>
            {entry.summary}
          </Markdown>
        </div>
      </div>
    );
  }
  if (entry.type === "user") {
    return (
      <div key={index} className="rounded-sm bg-foreground/5 p-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">user</span>
        <div className="whitespace-pre-wrap break-words text-foreground/90">{entry.text}</div>
      </div>
    );
  }
  if (entry.type === "assistant") {
    return (
      <div key={index} className="px-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          assistant
        </span>
        {entry.thinking ? (
          <>
            <div className="whitespace-pre-wrap break-words italic text-muted-foreground">
              {entry.thinking}
            </div>
            <BlankLine />
          </>
        ) : null}
        {entry.text.trim() ? (
          <div className="text-foreground/90">
            <Markdown cwd={cwd} onOpenFile={onOpenFile}>
              {entry.text}
            </Markdown>
          </div>
        ) : null}
      </div>
    );
  }
  return <ToolLogEntry key={index} entry={entry} />;
};

export const AutomationRunLogView = ({
  automationId,
  runId,
  automations,
  nowMs,
  onBack,
  onOpenAutomation,
}: AutomationRunLogViewProps) => {
  const [sessionEntries, setSessionEntries] = useState<AgentSessionEntry[] | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const handleOpenFile = useCallback((filePath: string) => setPreviewPath(filePath), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const automation = automations.find((candidate) => candidate.id === automationId);
  const run = automation?.runs.find((candidate) => candidate.runId === runId) ?? null;
  const runner = automation?.runner;
  const isThread = runner?.kind === "agent" && runner.sessionMode === "thread";
  const activeRunId = run?.runId ?? null;

  const recomputeAtBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setIsAtBottom(isScrolledToBottom(node, RUN_LOG_AT_BOTTOM_THRESHOLD_PX));
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  // Thread-mode runs resume a pi session file; show its transcript (the whole
  // branch up to this run's point in time, including compactions) instead of
  // just the current run's log. The transcript is truncated at the run's
  // finishedAt so an older run shows the branch as it was then, not the latest
  // state.
  useEffect(() => {
    if (!isThread) {
      setSessionEntries(null);
      return;
    }
    let cancelled = false;
    setSessionEntries(null);
    void fetchAgentSession(automationId, runId).then((entries) => {
      if (!cancelled) setSessionEntries(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [automationId, runId, isThread]);

  // Logs open at the top; a hovering "scroll to bottom" button covers the
  // rest. A scroll listener plus a ResizeObserver over the container and its
  // content keep that button's visibility in sync with manual scrolling,
  // viewport resizes, and content growth (transcript load, live poll, a tool
  // entry expanding). The active-run-id dep re-attaches after the not-found
  // branch.
  useEffect(() => {
    const container = scrollRef.current;
    const content = scrollContentRef.current;
    if (!container || !content) return;
    recomputeAtBottom();
    const handleScroll = () => recomputeAtBottom();
    container.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(() => recomputeAtBottom());
    observer.observe(container);
    observer.observe(content);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [recomputeAtBottom, activeRunId]);

  if (!automation || !run) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
          <Button variant="ghost" size="icon-sm" aria-label="back" onClick={onBack}>
            <ChevronLeft />
          </Button>
          <span className="text-xs text-muted-foreground">Run not found.</span>
        </div>
      </div>
    );
  }
  const badge = runStatusBadge(run.status, run.exitCode);
  const entries = Array.isArray(run.log) ? run.log : null;
  const textLog = typeof run.log === "string" ? run.log : run.findings;
  const displayEntries: AgentSessionEntry[] | null = isThread ? sessionEntries : entries;
  const showScrollButton = !isAtBottom;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="back to automations" onClick={onBack}>
          <ChevronLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{automation.name}</span>
        <span className={cn("shrink-0 text-[10px] tabular-nums", badge.className)}>
          {badge.label}
        </span>
        {run.exitCode !== null ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
            exit {run.exitCode}
          </span>
        ) : null}
        <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
          {formatRelativeTime(getAutomationRunTimestamp(run), nowMs)}
        </span>
        {isThread ? (
          <button
            type="button"
            aria-label="open session in pi"
            title="Open this thread in pi (new terminal tab)"
            onClick={() => {
              void fetchAgentSessionUrl(automationId).then((url) => {
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              });
            }}
            className="shrink-0 rounded-sm text-muted-foreground/70 outline-none transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="open automation"
          title="Open automation"
          onClick={() => onOpenAutomation(automation.id)}
          className="shrink-0 rounded-sm text-muted-foreground/70 outline-none transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto p-3">
        <div ref={scrollContentRef} className="min-h-full">
          {isThread && displayEntries === null ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="size-4" aria-label="loading session" />
            </div>
          ) : displayEntries !== null && displayEntries.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {isThread ? "No session history yet." : "No log recorded for this run."}
            </p>
          ) : displayEntries ? (
            <div className="flex flex-col font-mono text-[11px] leading-normal">
              {displayEntries.map((entry, index) => {
                const trailsBlank = !(entry.type === "assistant" && entry.text.trim().length === 0);
                return (
                  <Fragment key={index}>
                    {renderLogEntry(
                      entry,
                      index,
                      automation.cwd,
                      automation.cwd ? handleOpenFile : undefined,
                    )}
                    {trailsBlank ? <BlankLine /> : null}
                  </Fragment>
                );
              })}
            </div>
          ) : textLog ? (
            <pre className="whitespace-pre-wrap break-words rounded-sm bg-foreground/5 p-3 font-mono text-[11px] leading-normal text-foreground/80">
              {textLog}
            </pre>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No log recorded for this run.
            </p>
          )}
        </div>
      </div>
      {/* Sibling of the scroll container so it stays pinned while the log
          scrolls; always-mounted + transition keeps enter/exit interruptible. */}
      <button
        type="button"
        aria-label="scroll to bottom"
        title="Scroll to bottom"
        aria-hidden={!showScrollButton || undefined}
        tabIndex={showScrollButton ? 0 : -1}
        data-visible={showScrollButton || undefined}
        data-hidden={!showScrollButton || undefined}
        onClick={scrollToBottom}
        className="absolute bottom-3 right-3 z-10 flex size-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-md backdrop-blur-sm transition-[opacity,translate,color] duration-150 ease-snappy hover:text-foreground data-[hidden]:pointer-events-none data-[hidden]:translate-y-1 data-[hidden]:opacity-0 data-[visible]:translate-y-0 data-[visible]:opacity-100"
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
      {previewPath ? (
        <FilePreviewModal
          cwd={automation.cwd}
          filePath={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      ) : null}
    </div>
  );
};
