import {
  AUTOMATION_RUN_LIMIT_MAX,
  compileScheduleAll,
  nextCronOccurrence,
  parseCronExpression,
  type AgentSessionEntry,
  type AutomationRunRecord,
  type AutomationSessionEvent,
  type AutomationWithNextRun,
  type CdpHealth,
  type SecretEntryResponse,
} from "@monotykamary/localterm-server/protocol";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  Clock,
  Eraser,
  ExternalLink,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { EventTriggerSelector } from "@/components/event-trigger-selector";
import { AgentComposer } from "@/components/agent-composer";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { SecretSelector } from "@/components/secret-selector";
import { fetchAgentSession } from "@/utils/fetch-agent-session";
import { fetchAgentSessionUrl } from "@/utils/fetch-agent-session-url";
import { Markdown } from "@/components/markdown";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect } from "@/components/settings-select";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS,
  AUTOMATIONS_LIVE_POLL_MS,
  AUTOMATIONS_RELATIVE_TIME_REFRESH_MS,
  AUTOMATIONS_SIDEBAR_COLLAPSE_WIDTH_PX,
  AUTOMATIONS_SIDEBAR_WIDTH_PX,
  AUTOMATIONS_SORT_DEFAULT,
  TOOL_OUTPUT_PREVIEW_LINES,
  AUTOMATIONS_SORT_STORAGE_KEY,
  COPY_FEEDBACK_MS,
  RECENT_RUNS_LIMIT,
  RUN_LOG_AT_BOTTOM_THRESHOLD_PX,
} from "@/lib/constants";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { computeAutomationsHeaderLayout } from "@/utils/compute-automations-header-layout";
import { clearAutomationHistory } from "@/utils/clear-automation-history";
import { clearAutomationRuns } from "@/utils/clear-automation-runs";
import { clearThreadSession } from "@/utils/clear-thread-session";
import { compactAutomation } from "@/utils/compact-automation";
import { createAutomation } from "@/utils/create-automation";
import { deleteAutomation } from "@/utils/delete-automation";
import { fetchAutomations } from "@/utils/fetch-automations";
import { fetchSecrets } from "@/utils/fetch-secrets";
import { fetchServerHealth, type ServerHealth } from "@/utils/fetch-server-health";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { isScrolledToBottom } from "@/utils/is-scrolled-to-bottom";
import { resetAutomation } from "@/utils/reset-automation";
import {
  buildRunnerFromForm,
  defaultRunnerForm,
  isRunnerFormValid,
  recognizeRunnerForm,
  runnerSummary,
  runnerTypeLabel,
  type HarnessKind,
  type RunnerFormState,
} from "@/utils/runner-form";
import { groupTriageRuns } from "@/utils/group-triage-runs";
import { markAllTriageRead } from "@/utils/mark-all-triage-read";
import { markAutomationRunRead } from "@/utils/mark-automation-run-read";
import {
  buildScheduleFromForm,
  buildTriggerFromForm,
  defaultScheduleForm,
  formatClockTime,
  FREQUENCY_LABELS,
  HOUR_STEP_OPTIONS,
  MINUTE_STEP_OPTIONS,
  recognizeTriggerForm,
  SESSION_EVENT_DESCRIPTIONS,
  SESSION_EVENT_LABELS,
  SESSION_EVENTS,
  triggerLabel,
  WEEKDAY_NAMES,
  type ScheduleFormState,
  type ScheduleFrequency,
  type TriggerType,
} from "@/utils/schedule-builder";
import { lifecycleBadge, runStatusBadge } from "@/utils/run-status-badge";
import { triggerAutomationRun } from "@/utils/trigger-automation-run";
import { updateAutomation } from "@/utils/update-automation";

interface AutomationsModalProps {
  open: boolean;
  onClose: () => void;
  automations: AutomationWithNextRun[] | null;
  onAutomationsLoaded: (automations: AutomationWithNextRun[]) => void;
  defaultCwd: string | null;
  isMac: boolean;
}

type ModalTab = "automations" | "recent-runs";
type FormMode = "view" | "create" | "edit";
type AutomationsSort = "last-run" | "created" | "name";

interface AutomationFormState {
  id: string | null;
  name: string;
  runner: RunnerFormState;
  cwd: string;
  enabled: boolean;
  triggerType: TriggerType;
  schedule: ScheduleFormState;
  watchRecursive: boolean;
  watchFilter: string;
  eventNames: AutomationSessionEvent[];
  limitMode: "forever" | "count";
  limitMax: number;
  closeOnFinish: boolean;
  requestedSecrets: string[];
}

const DEFAULT_LIMIT_MAX = 20;
const SECTION_LABEL_CLASSES =
  "text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase";
const FORM_INPUT_CLASSES = "h-7 px-2 text-xs";
const FORM_SECTION_CARD_CLASSES =
  "flex flex-col gap-2.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-3";

const FormSection = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className={FORM_SECTION_CARD_CLASSES}>
    <span className={SECTION_LABEL_CLASSES}>{label}</span>
    {children}
  </section>
);

const runTimestamp = (run: AutomationRunRecord): number =>
  run.finishedAt ?? run.startedAt ?? run.scheduledFor;

const emptyForm = (defaultCwd: string | null): AutomationFormState => ({
  id: null,
  name: "",
  runner: defaultRunnerForm(),
  cwd: defaultCwd ?? "",
  enabled: true,
  triggerType: "schedule",
  schedule: defaultScheduleForm(),
  watchRecursive: true,
  watchFilter: "",
  eventNames: ["git-commit"],
  limitMode: "forever",
  limitMax: DEFAULT_LIMIT_MAX,
  closeOnFinish: false,
  requestedSecrets: [],
});

const formForAutomation = (automation: AutomationWithNextRun): AutomationFormState => {
  const trigger = recognizeTriggerForm(automation.trigger);
  return {
    id: automation.id,
    name: automation.name,
    runner: recognizeRunnerForm(automation.runner),
    cwd: automation.cwd,
    enabled: automation.enabled,
    triggerType: trigger.triggerType,
    schedule: trigger.schedule,
    watchRecursive: trigger.watchRecursive,
    watchFilter: trigger.watchFilter,
    eventNames: trigger.eventNames,
    limitMode: automation.limit.kind === "count" ? "count" : "forever",
    limitMax: automation.limit.kind === "count" ? automation.limit.max : DEFAULT_LIMIT_MAX,
    closeOnFinish: automation.closeOnFinish,
    requestedSecrets: automation.requestedSecrets,
  };
};

const RunRow = ({
  run,
  nowMs,
  onOpenLog,
}: {
  run: AutomationRunRecord;
  nowMs: number;
  onOpenLog: (run: AutomationRunRecord) => void;
}) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  const preview = findFirstFindingsLine(run.findings);
  const hasLog = Boolean(run.log || run.findings);
  return (
    <button
      type="button"
      onClick={() => onOpenLog(run)}
      disabled={!hasLog}
      className="flex w-full items-center gap-5 px-2.5 py-1.5 text-left text-xs outline-none transition-colors enabled:hover:bg-foreground/5 disabled:cursor-default"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn("size-1.5 rounded-full", run.unread ? "bg-foreground" : "bg-transparent")}
          aria-hidden="true"
        />
        <span className={cn("font-mono text-[10px] tabular-nums", badge.className)}>
          {badge.label}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
        {run.status === "skipped"
          ? `was due ${formatClockTime(new Date(run.scheduledFor).getHours(), new Date(run.scheduledFor).getMinutes())} · machine off`
          : preview}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="min-w-[4.5rem] text-right text-[11px] text-muted-foreground/70">
          {triggerChip(run.trigger)}
        </span>
        <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {formatRelativeTime(runTimestamp(run), nowMs)}
        </span>
      </span>
    </button>
  );
};

// A tool entry collapses its output to a pi-like preview (first N lines) with
// an expand toggle; a short output renders in full.
const ToolLogEntry = ({ entry }: { entry: Extract<AgentSessionEntry, { type: "tool" }> }) => {
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
      <pre className="mt-0.5 whitespace-pre-wrap break-words text-foreground/80">{visible}</pre>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-[10px] text-[var(--localterm-green)] transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
};

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
        <div className="mt-0.5 text-foreground/80">
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
        <div className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
          {entry.text}
        </div>
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
          <div className="mb-2 mt-1 border-l-2 border-border/60 pl-2 whitespace-pre-wrap break-words italic text-muted-foreground">
            {entry.thinking}
          </div>
        ) : null}
        <div className="mt-0.5 text-foreground/90">
          <Markdown cwd={cwd} onOpenFile={onOpenFile}>
            {entry.text}
          </Markdown>
        </div>
      </div>
    );
  }
  return <ToolLogEntry key={index} entry={entry} />;
};

const RunLogView = ({
  automationId,
  runId,
  automations,
  nowMs,
  onBack,
  onOpenAutomation,
}: {
  automationId: string;
  runId: string;
  automations: AutomationWithNextRun[];
  nowMs: number;
  onBack: () => void;
  onOpenAutomation: (id: string) => void;
}) => {
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
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{automation.name}</span>
        <span className={cn("shrink-0 text-[10px] tabular-nums", badge.className)}>
          {badge.label}
        </span>
        {run.exitCode !== null ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
            exit {run.exitCode}
          </span>
        ) : null}
        <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
          {formatRelativeTime(runTimestamp(run), nowMs)}
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
            <div className="flex flex-col gap-2 font-mono text-[11px] leading-relaxed">
              {displayEntries.map((entry, index) =>
                renderLogEntry(
                  entry,
                  index,
                  automation.cwd,
                  automation.cwd ? handleOpenFile : undefined,
                ),
              )}
            </div>
          ) : textLog ? (
            <pre className="whitespace-pre-wrap break-words rounded-sm bg-foreground/5 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
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

const ToggleChip = ({
  label,
  active,
  onToggle,
  ariaLabel,
  className,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  ariaLabel: string;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={ariaLabel}
    aria-pressed={active}
    onClick={onToggle}
    className={cn(
      "flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors",
      active
        ? "border-primary/50 bg-foreground/10 text-foreground"
        : "border-border/60 text-muted-foreground hover:text-foreground",
      className,
    )}
  >
    {label}
  </button>
);

const TimePicker = ({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) => (
  <div className="flex items-center gap-1.5">
    <Clock className="size-3 text-muted-foreground/70" aria-hidden="true" />
    <NumberStepper
      value={hour}
      min={0}
      max={23}
      step={1}
      ariaLabel="hour"
      decrementAriaLabel="earlier hour"
      incrementAriaLabel="later hour"
      formatDisplay={(value) => String(value).padStart(2, "0")}
      onValueChange={(value) => onChange(Math.min(23, Math.max(0, value)), minute)}
    />
    <span className="text-muted-foreground">:</span>
    <NumberStepper
      value={minute}
      min={0}
      max={59}
      step={1}
      ariaLabel="minute"
      decrementAriaLabel="earlier minute"
      incrementAriaLabel="later minute"
      formatDisplay={(value) => String(value).padStart(2, "0")}
      onValueChange={(value) => onChange(hour, Math.min(59, Math.max(0, value)))}
    />
    <span className="text-[10px] text-muted-foreground/70">{formatClockTime(hour, minute)}</span>
  </div>
);

const ScheduleBuilder = ({
  schedule,
  onChange,
}: {
  schedule: ScheduleFormState;
  onChange: (next: ScheduleFormState) => void;
}) => {
  const frequencyItems = (Object.keys(FREQUENCY_LABELS) as ScheduleFrequency[]).map((key) => ({
    id: key,
    label: FREQUENCY_LABELS[key],
  }));
  const setTimeAt = (index: number, hour: number, minute: number) =>
    onChange({
      ...schedule,
      times: schedule.times.map((time, position) => (position === index ? { hour, minute } : time)),
    });
  return (
    <div className="flex flex-col gap-2">
      <SettingsSelect
        value={schedule.frequency}
        items={frequencyItems}
        ariaLabel="schedule frequency"
        placeholder="Frequency"
        onValueChange={(next) =>
          onChange({ ...schedule, frequency: (next as ScheduleFrequency) ?? schedule.frequency })
        }
      />

      {(schedule.frequency === "daily" ||
        schedule.frequency === "weekdays" ||
        schedule.frequency === "weekends" ||
        schedule.frequency === "weekly" ||
        schedule.frequency === "monthly") && (
        <TimePicker
          hour={schedule.hour}
          minute={schedule.minute}
          onChange={(hour, minute) => onChange({ ...schedule, hour, minute })}
        />
      )}

      {schedule.frequency === "hourly" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>At minute</span>
          <NumberStepper
            value={schedule.minute}
            min={0}
            max={59}
            step={1}
            ariaLabel="minute past the hour"
            decrementAriaLabel="earlier minute"
            incrementAriaLabel="later minute"
            formatDisplay={(value) => String(value).padStart(2, "0")}
            onValueChange={(value) =>
              onChange({ ...schedule, minute: Math.min(59, Math.max(0, value)) })
            }
          />
        </div>
      )}

      {schedule.frequency === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_NAMES.map((name, day) => (
            <ToggleChip
              key={name}
              label={name}
              ariaLabel={`toggle ${name}`}
              active={schedule.daysOfWeek.includes(day)}
              onToggle={() =>
                onChange({
                  ...schedule,
                  daysOfWeek: schedule.daysOfWeek.includes(day)
                    ? schedule.daysOfWeek.filter((value) => value !== day)
                    : [...schedule.daysOfWeek, day],
                })
              }
            />
          ))}
        </div>
      )}

      {schedule.frequency === "monthly" && (
        <div className="w-fit rounded-lg border border-border/40 bg-background/40 p-2">
          <div className="grid grid-cols-7 gap-1 justify-items-center">
            {WEEKDAY_NAMES.map((name) => (
              <div
                key={name}
                className="flex h-7 items-center justify-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60"
              >
                {name}
              </div>
            ))}
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <ToggleChip
                key={day}
                label={String(day)}
                ariaLabel={`toggle day ${day}`}
                active={schedule.daysOfMonth.includes(day)}
                onToggle={() =>
                  onChange({
                    ...schedule,
                    daysOfMonth: schedule.daysOfMonth.includes(day)
                      ? schedule.daysOfMonth.filter((value) => value !== day)
                      : [...schedule.daysOfMonth, day],
                  })
                }
                className="size-7 px-0"
              />
            ))}
          </div>
        </div>
      )}

      {schedule.frequency === "timesOfDay" && (
        <div className="flex flex-col gap-1.5">
          {schedule.times.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <TimePicker
                hour={time.hour}
                minute={time.minute}
                onChange={(hour, minute) => setTimeAt(index, hour, minute)}
              />
              {schedule.times.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`remove time ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...schedule,
                      times: schedule.times.filter((_, position) => position !== index),
                    })
                  }
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
          {schedule.times.length < 12 && (
            <Button
              variant="ghost"
              size="xs"
              className="w-fit"
              onClick={() =>
                onChange({ ...schedule, times: [...schedule.times, { hour: 12, minute: 0 }] })
              }
            >
              <Plus aria-hidden="true" /> Add time
            </Button>
          )}
        </div>
      )}

      {schedule.frequency === "everyNMinutes" && (
        <SettingsSelect
          value={String(schedule.stepMinutes)}
          items={MINUTE_STEP_OPTIONS.map((step) => ({
            id: String(step),
            label: step === 1 ? "Every minute" : `Every ${step} minutes`,
          }))}
          ariaLabel="minute interval"
          placeholder="Interval"
          onValueChange={(next) =>
            onChange({ ...schedule, stepMinutes: Number(next ?? schedule.stepMinutes) })
          }
        />
      )}

      {schedule.frequency === "everyNHours" && (
        <div className="flex flex-col gap-2">
          <SettingsSelect
            value={String(schedule.stepHours)}
            items={HOUR_STEP_OPTIONS.map((step) => ({
              id: String(step),
              label: step === 1 ? "Every hour" : `Every ${step} hours`,
            }))}
            ariaLabel="hour interval"
            placeholder="Interval"
            onValueChange={(next) =>
              onChange({ ...schedule, stepHours: Number(next ?? schedule.stepHours) })
            }
          />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>On the clock, at minute</span>
            <NumberStepper
              value={schedule.minute}
              min={0}
              max={59}
              step={1}
              ariaLabel="minute past the hour"
              decrementAriaLabel="earlier minute"
              incrementAriaLabel="later minute"
              formatDisplay={(value) => String(value).padStart(2, "0")}
              onValueChange={(value) =>
                onChange({ ...schedule, minute: Math.min(59, Math.max(0, value)) })
              }
            />
          </div>
        </div>
      )}

      {schedule.frequency === "cron" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <Input
            value={schedule.cron}
            placeholder="0 9 * * mon-fri"
            aria-label="cron expression"
            className={cn(FORM_INPUT_CLASSES, "font-mono")}
            onChange={(event) => onChange({ ...schedule, cron: event.target.value })}
          />
          <span className="text-[10px]">minute hour day month weekday — or @daily, @weekly</span>
        </label>
      )}
    </div>
  );
};

export const AutomationsModal = ({
  open,
  onClose,
  automations,
  onAutomationsLoaded,
  defaultCwd,
  isMac,
}: AutomationsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [tab, setTab] = useState<ModalTab>("automations");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<FormMode>("view");
  // A run whose log is shown full-pane (a dedicated log page with a back
  // chevron), or null for the normal tab/detail content. Set by clicking a
  // Triage row or a per-automation history row; cleared by the back chevron.
  const [logView, setLogView] = useState<{ automationId: string; runId: string } | null>(null);
  const [form, setForm] = useState<AutomationFormState>(() => emptyForm(defaultCwd));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [armedClearId, setArmedClearId] = useState<string | null>(null);
  const [armedClearThreadId, setArmedClearThreadId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<"all" | "unread" | "failed" | "skipped">("all");
  const loadSortFromStorage = (): AutomationsSort => {
    try {
      return (
        (localStorage.getItem(AUTOMATIONS_SORT_STORAGE_KEY) as AutomationsSort | null) ??
        AUTOMATIONS_SORT_DEFAULT
      );
    } catch {
      return AUTOMATIONS_SORT_DEFAULT;
    }
  };

  const [sortBy, setSortBy] = useState<AutomationsSort>(loadSortFromStorage);
  const [search, setSearch] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cdpHealth, setCdpHealth] = useState<ServerHealth | null>(null);
  const [secrets, setSecrets] = useState<SecretEntryResponse[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const contentRowRef = useRef<HTMLDivElement | null>(null);
  const [headerWidth, setHeaderWidth] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const headerConfigIndexRef = useRef(0);

  const refreshAutomations = useCallback(async () => {
    const fetched = await fetchAutomations();
    if (fetched) onAutomationsLoaded(fetched);
  }, [onAutomationsLoaded]);

  const refreshCdpHealth = useCallback(async () => {
    const fetched = await fetchServerHealth();
    if (fetched) setCdpHealth(fetched);
  }, []);

  const refreshSecrets = useCallback(async () => {
    const fetched = await fetchSecrets();
    if (fetched) setSecrets(fetched.secrets);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(
        () => setMounted(false),
        AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS,
      );
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMode("view");
      setSaveError(false);
      setArmedDeleteId(null);
      setArmedClearId(null);
      setArmedClearThreadId(null);
      setSearch("");
      return;
    }
    setNowMs(Date.now());
    void refreshAutomations();
    void refreshCdpHealth();
    void refreshSecrets();
    const tick = window.setInterval(
      () => setNowMs(Date.now()),
      AUTOMATIONS_RELATIVE_TIME_REFRESH_MS,
    );
    // Re-fetch automations on a short cadence so a run that finishes shows its
    // final status even if the WS broadcast was missed (dropped/reconnecting
    // socket). The fetch is cheap + only runs while the modal is open.
    const poll = window.setInterval(() => {
      void refreshAutomations();
    }, AUTOMATIONS_LIVE_POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [open, refreshAutomations, refreshCdpHealth, refreshSecrets]);

  // Keep a valid selection across refreshes, falling back to the first item.
  useEffect(() => {
    if (!automations) return;
    if (selectedId && automations.some((automation) => automation.id === selectedId)) return;
    setSelectedId(automations[0]?.id ?? null);
  }, [automations, selectedId]);

  const selected = useMemo(
    () => automations?.find((automation) => automation.id === selectedId) ?? null,
    [automations, selectedId],
  );

  const filteredAutomations = useMemo(() => {
    if (!automations) return null;
    const lower = search.toLowerCase();
    const filtered = lower
      ? automations.filter(
          (automation) =>
            automation.name.toLowerCase().includes(lower) ||
            runnerSummary(automation.runner).toLowerCase().includes(lower),
        )
      : automations;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === "last-run") {
        const aAt = a.lastRun?.at ?? 0;
        const bAt = b.lastRun?.at ?? 0;
        return bAt - aAt;
      }
      if (sortBy === "created") {
        return b.createdAt - a.createdAt;
      }
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [automations, sortBy, search]);

  const handleSortChange = useCallback((value: AutomationsSort) => {
    setSortBy(value);
    try {
      localStorage.setItem(AUTOMATIONS_SORT_STORAGE_KEY, value);
    } catch {}
  }, []);

  const closeForm = useCallback(() => {
    setMode("view");
    setSaveError(false);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (logView) {
        setLogView(null);
        return;
      }
      if (mode !== "view") {
        closeForm();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, mode, logView, closeForm, onClose]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  // Drop the log page when the modal closes so reopening lands on the normal
  // tab/detail content instead of a stale (possibly deleted) run.
  useEffect(() => {
    if (!open) setLogView(null);
  }, [open]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = (width: number) => {
      if (width === 0) return;
      setHeaderWidth(width);
    };
    update(header.offsetWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? header.offsetWidth;
        update(width);
      }
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [mounted]);

  useLayoutEffect(() => {
    const row = contentRowRef.current;
    if (!row) return;
    const update = (width: number) => {
      if (width === 0) return;
      setSidebarCollapsed(width < AUTOMATIONS_SIDEBAR_COLLAPSE_WIDTH_PX);
    };
    update(row.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        update(width);
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [mounted, tab, mode]);

  const headerLayout = useMemo(() => {
    const result = computeAutomationsHeaderLayout({
      availableWidth: headerWidth,
      showCreateButton: tab === "automations" && mode === "view",
      previousConfigIndex: headerConfigIndexRef.current,
    });
    headerConfigIndexRef.current = result.configIndex;
    return result;
  }, [headerWidth, tab, mode]);

  const openCreate = () => {
    setForm(emptyForm(defaultCwd));
    setMode("create");
    setSaveError(false);
  };

  const openEdit = (automation: AutomationWithNextRun) => {
    setForm(formForAutomation(automation));
    setMode("edit");
    setSaveError(false);
  };

  const builtSchedule = useMemo(() => buildScheduleFromForm(form.schedule), [form.schedule]);
  const compiledCrons = useMemo(() => compileScheduleAll(builtSchedule), [builtSchedule]);
  const isScheduleValid = useMemo(
    () =>
      compiledCrons.length > 0 && compiledCrons.every((cron) => parseCronExpression(cron) !== null),
    [compiledCrons],
  );
  const nextPreviewAt = useMemo(() => {
    if (!isScheduleValid) return null;
    const from = new Date(nowMs);
    const candidates = compiledCrons
      .map((cron) => parseCronExpression(cron))
      .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null)
      .map((parsed) => nextCronOccurrence(parsed, from)?.getTime() ?? null)
      .filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }, [compiledCrons, isScheduleValid, nowMs]);

  const isFormValid =
    form.name.trim().length > 0 &&
    isRunnerFormValid(form.runner) &&
    form.cwd.trim().length > 0 &&
    (form.triggerType === "watch" ||
      form.triggerType === "event" ||
      form.triggerType === "webhook" ||
      isScheduleValid) &&
    (form.limitMode === "forever" ||
      (form.limitMax >= 1 && form.limitMax <= AUTOMATION_RUN_LIMIT_MAX));

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(false);
    const input = {
      name: form.name.trim(),
      trigger: buildTriggerFromForm(form),
      cwd: form.cwd.trim(),
      runner: buildRunnerFromForm(form.runner),
      enabled: form.enabled,
      limit:
        form.limitMode === "count"
          ? ({ kind: "count", max: form.limitMax } as const)
          : ({ kind: "forever" } as const),
      closeOnFinish: form.closeOnFinish,
      requestedSecrets: form.requestedSecrets,
    };
    const saved = form.id ? await updateAutomation(form.id, input) : await createAutomation(input);
    setIsSaving(false);
    if (!saved) {
      setSaveError(true);
      return;
    }
    setSelectedId(saved.id);
    setMode("view");
    await refreshAutomations();
  };

  const handleRunNow = async (automation: AutomationWithNextRun) => {
    await triggerAutomationRun(automation.id);
    await refreshAutomations();
  };

  const handleToggleEnabled = async (automation: AutomationWithNextRun, enabled: boolean) => {
    await updateAutomation(automation.id, { enabled });
    await refreshAutomations();
  };

  const handleDelete = async (automation: AutomationWithNextRun) => {
    if (armedDeleteId !== automation.id) {
      setArmedDeleteId(automation.id);
      return;
    }
    setArmedDeleteId(null);
    await deleteAutomation(automation.id);
    await refreshAutomations();
  };

  const handleReset = async (automation: AutomationWithNextRun) => {
    await resetAutomation(automation.id);
    await refreshAutomations();
  };

  const handleClearRuns = async (automation: AutomationWithNextRun) => {
    if (armedClearId !== automation.id) {
      setArmedClearId(automation.id);
      return;
    }
    setArmedClearId(null);
    await clearAutomationRuns(automation.id);
    await refreshAutomations();
  };

  const handleCompact = async (automation: AutomationWithNextRun) => {
    await compactAutomation(automation.id);
    await refreshAutomations();
  };

  // Drop a thread session's accumulated context so the next fire starts a
  // fresh branch (compaction keeps context; this clears it). Two-click
  // confirm like delete/clear-history — clearing throws away the whole thread.
  const handleClearThread = async (automation: AutomationWithNextRun) => {
    if (armedClearThreadId !== automation.id) {
      setArmedClearThreadId(automation.id);
      return;
    }
    setArmedClearThreadId(null);
    await clearThreadSession(automation.id);
    await refreshAutomations();
  };

  // Open the full-pane log page for a run, marking it read first so opening
  // from either the Triage inbox or the per-automation history clears the
  // unread badge (it's the same log entry).
  const openRunLog = async (automationId: string, run: AutomationRunRecord) => {
    setLogView({ automationId, runId: run.runId });
    if (run.unread) {
      await markAutomationRunRead(automationId, run.runId);
      await refreshAutomations();
    }
  };

  const recentRuns = useMemo(() => {
    if (!automations) return [];
    const flattened = automations.flatMap((automation) =>
      automation.runs.map((run) => ({ automation, run })),
    );
    flattened.sort((a, b) => runTimestamp(b.run) - runTimestamp(a.run));
    const filtered = flattened.filter(({ run }) => {
      if (runFilter === "unread") return run.unread;
      if (runFilter === "failed") return run.status === "failed";
      if (runFilter === "skipped") return run.status === "skipped";
      return true;
    });
    return filtered.slice(0, RECENT_RUNS_LIMIT);
  }, [automations, runFilter]);

  const unreadCount = useMemo(
    () =>
      automations?.reduce(
        (total, automation) => total + automation.runs.filter((run) => run.unread).length,
        0,
      ) ?? 0,
    [automations],
  );

  if (!mounted) return null;

  const isVisible = open && settled;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="automations"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex h-full max-h-[44rem] w-full max-w-5xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <header
          ref={headerRef}
          className={cn(
            "flex shrink-0 items-center border-b border-border/40 py-2.5",
            headerLayout.showTitle
              ? "gap-3 px-4"
              : headerLayout.headerPadding === 24
                ? "gap-2 px-3"
                : "gap-3 px-4",
          )}
        >
          {headerLayout.showIcon ? (
            <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          {headerLayout.showTitle ? (
            <h2 className="shrink-0 text-sm font-medium text-foreground">Automations</h2>
          ) : null}
          <div
            role="tablist"
            aria-label="automations view"
            className="shrink-0 flex items-center rounded-md border border-border/60 p-0.5"
          >
            {(headerLayout.tabLabels === "full"
              ? ([
                  ["automations", "Automations"],
                  ["recent-runs", "Triage"],
                ] as const)
              : ([
                  ["automations", "A"],
                  ["recent-runs", "T"],
                ] as const)
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setLogView(null);
                  setTab(value);
                }}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors",
                  tab === value
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {value === "recent-runs" && unreadCount > 0 ? (
                  <span className="ml-1 inline-flex items-center rounded-full bg-foreground/15 px-1.5 text-[10px] tabular-nums text-foreground">
                    {unreadCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {tab === "automations" && mode === "view" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="new automation"
                className="hover:text-foreground"
                onClick={openCreate}
              >
                <Plus />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="close automations"
              title={`${isMac ? "⌘" : "Ctrl+"}J`}
              className="hover:text-foreground"
            >
              <X />
            </Button>
          </div>
        </header>

        {logView ? (
          <RunLogView
            automationId={logView.automationId}
            runId={logView.runId}
            automations={automations ?? []}
            nowMs={nowMs}
            onBack={() => setLogView(null)}
            onOpenAutomation={(id) => {
              setLogView(null);
              setSelectedId(id);
              setTab("automations");
              setMode("view");
            }}
          />
        ) : tab === "recent-runs" ? (
          <RecentRunsView
            runs={recentRuns}
            nowMs={nowMs}
            filter={runFilter}
            onFilterChange={setRunFilter}
            onSelect={async (automationId, run) => {
              if (run.unread) {
                await markAutomationRunRead(automationId, run.runId);
                await refreshAutomations();
              }
              setSelectedId(automationId);
              setTab("automations");
              setMode("view");
            }}
            onOpenLog={(automationId, run) => void openRunLog(automationId, run)}
            onMarkAllRead={async () => {
              await markAllTriageRead();
              await refreshAutomations();
            }}
            onClearHistory={async () => {
              await clearAutomationHistory();
              await refreshAutomations();
            }}
          />
        ) : (
          <div ref={contentRowRef} className="flex min-h-0 flex-1">
            <div
              style={{ width: sidebarCollapsed ? 0 : AUTOMATIONS_SIDEBAR_WIDTH_PX }}
              className="h-full shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-snappy"
            >
              <div
                style={{ width: AUTOMATIONS_SIDEBAR_WIDTH_PX }}
                className={cn(
                  "flex h-full flex-col border-r border-border/40 opacity-100 transition-opacity duration-200 ease-snappy",
                  sidebarCollapsed && "opacity-0",
                )}
              >
                <AutomationSidebar
                  automations={filteredAutomations}
                  sortBy={sortBy}
                  search={search}
                  selectedId={selectedId}
                  nowMs={nowMs}
                  onSortChange={handleSortChange}
                  onSearchChange={setSearch}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setMode("view");
                  }}
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 font-mono text-xs text-muted-foreground transition-opacity duration-200 ease-snappy",
                  sidebarCollapsed && mode === "view"
                    ? "opacity-100"
                    : "opacity-0 absolute pointer-events-none",
                )}
                aria-hidden={!(sidebarCollapsed && mode === "view")}
              >
                <Popover>
                  <PopoverTrigger
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-border/50 px-1.5 py-0.5 text-foreground outline-none hover:bg-foreground/5"
                    aria-label="select automation"
                  >
                    <span className="min-w-0 flex-1 truncate">{selected?.name ?? "Select…"}</span>
                    <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent align="start" side="bottom" className="w-72 p-0">
                    <AutomationListPopover
                      automations={filteredAutomations}
                      selectedId={selectedId}
                      nowMs={nowMs}
                      onSelect={(id) => {
                        setSelectedId(id);
                        setMode("view");
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                {mode !== "view" ? (
                  <AutomationForm
                    form={form}
                    onChange={setForm}
                    onCancel={closeForm}
                    onSave={() => void handleSave()}
                    isSaving={isSaving}
                    isValid={isFormValid}
                    saveError={saveError}
                    cronCaption={compiledCrons.join(", ")}
                    scheduleValid={isScheduleValid}
                    nextPreviewAt={nextPreviewAt}
                    nowMs={nowMs}
                    cdp={cdpHealth?.cdp ?? null}
                    secrets={secrets}
                  />
                ) : selected ? (
                  <AutomationDetail
                    automation={selected}
                    nowMs={nowMs}
                    armedDelete={armedDeleteId === selected.id}
                    onRunNow={() => void handleRunNow(selected)}
                    onEdit={() => openEdit(selected)}
                    onDelete={() => void handleDelete(selected)}
                    onToggleEnabled={(enabled) => void handleToggleEnabled(selected, enabled)}
                    onReset={() => void handleReset(selected)}
                    onCompact={() => void handleCompact(selected)}
                    onClearThread={() => void handleClearThread(selected)}
                    armedClearThread={armedClearThreadId === selected.id}
                    onClearHistory={() => void handleClearRuns(selected)}
                    armedClear={armedClearId === selected.id}
                    onOpenLog={(run) => void openRunLog(selected.id, run)}
                  />
                ) : filteredAutomations !== null && filteredAutomations.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    No automations yet. Create one to get started.
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    Select an automation, or create one.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AutomationDetail = ({
  automation,
  nowMs,
  armedDelete,
  onRunNow,
  onEdit,
  onDelete,
  onToggleEnabled,
  onReset,
  onCompact,
  onClearThread,
  armedClearThread,
  onClearHistory,
  armedClear,
  onOpenLog,
}: {
  automation: AutomationWithNextRun;
  nowMs: number;
  armedDelete: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: () => void;
  onCompact?: () => void;
  onClearThread?: () => void;
  armedClearThread: boolean;
  onClearHistory: () => void;
  armedClear: boolean;
  onOpenLog: (run: AutomationRunRecord) => void;
}) => {
  const finished = lifecycleBadge(automation.lifecycle);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const compactable =
    automation.runner.kind === "agent" && automation.runner.sessionMode === "thread";
  const webhookUrl =
    automation.trigger.kind === "webhook" && typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/${automation.trigger.id}`
      : null;
  const copyWebhookUrl = useCallback(() => {
    if (!webhookUrl) return;
    void navigator.clipboard
      .writeText(webhookUrl)
      .then(() => {
        setCopiedWebhook(true);
        window.setTimeout(() => setCopiedWebhook(false), COPY_FEEDBACK_MS);
      })
      .catch(() => {
        /* clipboard permission denied; user can still select + copy manually */
      });
  }, [webhookUrl]);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{automation.name}</h3>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {runnerTypeLabel(automation.runner)}: {runnerSummary(automation.runner)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-foreground/[0.02] p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`run ${automation.name} now`}
              className="rounded-full hover:bg-foreground/10 hover:text-foreground"
              onClick={onRunNow}
            >
              <Play />
            </Button>
            {compactable && onCompact ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`compact ${automation.name} thread`}
                title="Compact the thread session now"
                className="rounded-full hover:bg-foreground/10 hover:text-foreground"
                onClick={onCompact}
              >
                <Minimize2 />
              </Button>
            ) : null}
            {compactable && onClearThread ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  armedClearThread
                    ? `confirm clear ${automation.name} thread`
                    : `clear ${automation.name} thread`
                }
                title={
                  armedClearThread
                    ? "Click again to confirm — drops the whole thread"
                    : "Restart the thread from fresh (drops its context)"
                }
                className={cn(
                  "rounded-full",
                  armedClearThread
                    ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                    : "hover:bg-foreground/10 hover:text-foreground",
                )}
                onClick={onClearThread}
              >
                <RefreshCw />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`edit ${automation.name}`}
              className="rounded-full hover:bg-foreground/10 hover:text-foreground"
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                armedDelete ? `confirm delete ${automation.name}` : `delete ${automation.name}`
              }
              className={cn(
                "rounded-full hover:bg-foreground/10",
                armedDelete ? "text-destructive hover:text-destructive" : "hover:text-foreground",
              )}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
          <Switch
            size="sm"
            aria-label={`toggle ${automation.name}`}
            checked={automation.enabled}
            onCheckedChange={onToggleEnabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border/60 bg-foreground/[0.02] p-3 text-[11px]">
        <div className="flex flex-col gap-0.5">
          <span className={SECTION_LABEL_CLASSES}>Trigger</span>
          <span className="text-foreground/90">{triggerLabel(automation.trigger)}</span>
          {automation.cron ? (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {automation.cron}
            </span>
          ) : null}
          {webhookUrl ? (
            <span className="flex items-center gap-1">
              <span
                className="min-w-0 truncate font-mono text-[10px] text-muted-foreground/70"
                title={webhookUrl}
              >
                {webhookUrl}
              </span>
              <button
                type="button"
                className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={copyWebhookUrl}
              >
                {copiedWebhook ? "copied" : "copy"}
              </button>
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={SECTION_LABEL_CLASSES}>Next run</span>
          <span className="text-foreground/90">
            {automation.lifecycle === "finished"
              ? "Finished"
              : automation.trigger.kind === "watch"
                ? automation.enabled
                  ? "On change"
                  : "Paused"
                : automation.trigger.kind === "event"
                  ? automation.enabled
                    ? "On event"
                    : "Paused"
                  : automation.trigger.kind === "webhook"
                    ? automation.enabled
                      ? "On webhook"
                      : "Paused"
                    : automation.nextRunAt !== null
                      ? formatRelativeTime(automation.nextRunAt, nowMs)
                      : "Paused"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={SECTION_LABEL_CLASSES}>Directory</span>
          <span
            className="truncate font-mono text-[10px] text-muted-foreground"
            title={automation.cwd}
          >
            {automation.cwd}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={SECTION_LABEL_CLASSES}>Limit</span>
          <span className="text-foreground/90">
            {automation.limit.kind === "count"
              ? `${automation.runCount} / ${automation.limit.max} runs`
              : `Runs forever (${automation.runCount} so far)`}
          </span>
        </div>
        {automation.lastRun
          ? (() => {
              const badge = runStatusBadge(automation.lastRun.status, automation.lastRun.exitCode);
              return (
                <div className="flex flex-col gap-0.5">
                  <span className={SECTION_LABEL_CLASSES}>Last run</span>
                  <span className={cn("text-foreground/90", badge.className)}>{badge.label}</span>
                </div>
              );
            })()
          : null}
      </div>

      {finished ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-foreground/5 px-3 py-2 text-[11px]">
          <span className="text-foreground/80">
            Finished — reached its run limit. Reset to run it again.
          </span>
          <Button variant="outline" size="xs" onClick={onReset}>
            <RotateCcw aria-hidden="true" /> Reset
          </Button>
        </div>
      ) : null}

      <Separator className="bg-border/40" />

      <Collapsible defaultOpen>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="group flex flex-1 items-center justify-between gap-2 text-left"
              />
            }
          >
            <span className={SECTION_LABEL_CLASSES}>History · {automation.runs.length} runs</span>
            <ChevronDown
              className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          {automation.runs.length > 0 ? (
            <button
              type="button"
              aria-label={
                armedClear
                  ? `confirm clear ${automation.name} run history`
                  : `clear ${automation.name} run history`
              }
              title={armedClear ? "Click again to confirm" : "Clear this automation's run history"}
              className={cn(
                "shrink-0 rounded-md p-1 text-[11px] transition-colors",
                armedClear
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
              onClick={onClearHistory}
            >
              <Eraser className="size-3.5" />
            </button>
          ) : null}
        </div>
        <CollapsibleContent>
          {automation.runs.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="mt-1 flex flex-col divide-y divide-border/30 rounded-md border border-border/40">
              {automation.runs.map((run) => (
                <RunRow key={run.runId} run={run} nowMs={nowMs} onOpenLog={onOpenLog} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

const AutomationForm = ({
  form,
  onChange,
  onCancel,
  onSave,
  isSaving,
  isValid,
  saveError,
  cronCaption,
  scheduleValid,
  nextPreviewAt,
  nowMs,
  cdp,
  secrets,
}: {
  form: AutomationFormState;
  onChange: (next: AutomationFormState) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  isValid: boolean;
  saveError: boolean;
  cronCaption: string;
  scheduleValid: boolean;
  nextPreviewAt: number | null;
  nowMs: number;
  cdp: CdpHealth;
  secrets: SecretEntryResponse[] | null;
}) => {
  // closeOnFinish only takes effect over CDP (the daemon closes the run tab via
  // Target.closeTarget). With no connected browser it's a silent no-op, so the
  // toggle is locked off rather than letting the user save a setting that does
  // nothing — but a value already saved true stays editable so it can recover.
  const closeOnFinishSupported = cdp?.connected === true;
  const closeOnFinishDisabled = !closeOnFinishSupported && !form.closeOnFinish;
  return (
    <div className="flex flex-col gap-2.5 p-4">
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Name
        <Input
          value={form.name}
          autoFocus
          placeholder="nightly build"
          aria-label="automation name"
          className="h-9 px-2.5 text-sm font-medium"
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASSES}>Runner</span>
        <SettingsSelect
          value={form.runner.runnerType}
          items={[
            { id: "shell", label: "Shell command" },
            { id: "agent", label: "Agent" },
          ]}
          ariaLabel="runner type"
          placeholder="Runner"
          onValueChange={(next) =>
            onChange({ ...form, runner: { ...form.runner, runnerType: next as "shell" | "agent" } })
          }
        />
        {form.runner.runnerType === "shell" ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Command
            <Input
              value={form.runner.command}
              placeholder="pnpm build"
              aria-label="automation command"
              className={cn(FORM_INPUT_CLASSES, "font-mono")}
              onChange={(event) =>
                onChange({ ...form, runner: { ...form.runner, command: event.target.value } })
              }
            />
          </label>
        ) : (
          <div className="flex flex-col gap-2">
            <AgentComposer
              prompt={form.runner.prompt}
              onPromptChange={(prompt) => onChange({ ...form, runner: { ...form.runner, prompt } })}
              cwd={form.cwd}
              agentModel={form.runner.agentModel}
              onAgentModelChange={(agentModel) =>
                onChange({ ...form, runner: { ...form.runner, agentModel } })
              }
              agentThinking={form.runner.agentThinking}
              onAgentThinkingChange={(agentThinking) =>
                onChange({ ...form, runner: { ...form.runner, agentThinking } })
              }
              agentSessionMode={form.runner.agentSessionMode}
              onAgentSessionModeChange={(agentSessionMode) =>
                onChange({ ...form, runner: { ...form.runner, agentSessionMode } })
              }
            />
            <p className="text-[10px] text-muted-foreground/70">
              Runs the agent headlessly. Findings + a transcript log land in Triage.
            </p>
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-foreground/[0.02] p-3">
              <span className={SECTION_LABEL_CLASSES}>Harness</span>
              <SettingsSelect
                value={form.runner.harnessKind}
                items={[
                  { id: "pi", label: "pi (built-in)" },
                  { id: "custom", label: "Custom command" },
                ]}
                ariaLabel="agent harness"
                placeholder="Harness"
                onValueChange={(next) =>
                  onChange({
                    ...form,
                    runner: { ...form.runner, harnessKind: next as HarnessKind },
                  })
                }
              />
              {form.runner.harnessKind === "custom" ? (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Run command
                    <Input
                      value={form.runner.customCommand}
                      placeholder='claude -p "$LOCALTERM_AGENT_PROMPT"'
                      aria-label="custom harness command"
                      className={cn(FORM_INPUT_CLASSES, "font-mono")}
                      onChange={(event) =>
                        onChange({
                          ...form,
                          runner: { ...form.runner, customCommand: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Compact command (optional, thread only)
                    <Input
                      value={form.runner.customCompactCommand}
                      placeholder='claude --session "$LOCALTERM_AGENT_SESSION_FILE" --compact'
                      aria-label="custom harness compact command"
                      className={cn(FORM_INPUT_CLASSES, "font-mono")}
                      onChange={(event) =>
                        onChange({
                          ...form,
                          runner: { ...form.runner, customCompactCommand: event.target.value },
                        })
                      }
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground/70">
                    Your command runs in the automation's cwd with the prompt + metadata as
                    <code className="font-mono"> LOCALTERM_AGENT_*</code> env vars. stdout =
                    findings; stdout+stderr = the log.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {(
                    [
                      ["piExtensions", "extensions"],
                      ["piSkills", "skills"],
                      ["piContextFiles", "context files"],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span className="capitalize">Load {label}</span>
                      <Switch
                        aria-label={`pi ${label}`}
                        checked={form.runner[field]}
                        onCheckedChange={(value) =>
                          onChange({ ...form, runner: { ...form.runner, [field]: value } })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <FormSection label="Where & when">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Directory
          <Input
            value={form.cwd}
            placeholder="/path/to/project"
            aria-label="automation directory"
            className={cn(FORM_INPUT_CLASSES, "font-mono")}
            onChange={(event) => onChange({ ...form, cwd: event.target.value })}
          />
        </label>
        <SettingsSelect
          value={form.triggerType}
          items={[
            { id: "schedule", label: "On a schedule" },
            { id: "watch", label: "When a folder changes" },
            { id: "event", label: "On a session event" },
            { id: "webhook", label: "On a webhook" },
          ]}
          ariaLabel="trigger type"
          placeholder="Trigger"
          onValueChange={(next) => onChange({ ...form, triggerType: next as TriggerType })}
        />
        {form.triggerType === "schedule" ? (
          <>
            <ScheduleBuilder
              schedule={form.schedule}
              onChange={(schedule) => onChange({ ...form, schedule })}
            />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {!scheduleValid
                ? "invalid schedule"
                : nextPreviewAt !== null
                  ? `next run ${formatRelativeTime(nextPreviewAt, nowMs)} · cron ${cronCaption}`
                  : `schedule never fires · cron ${cronCaption}`}
            </span>
          </>
        ) : form.triggerType === "watch" ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              File filter (optional)
              <Input
                value={form.watchFilter}
                placeholder="*.mov"
                aria-label="watch file filter"
                className={cn(FORM_INPUT_CLASSES, "font-mono")}
                onChange={(event) => onChange({ ...form, watchFilter: event.target.value })}
              />
              <span className="text-[10px] text-muted-foreground/60">
                Only trigger when changed files match this glob (e.g. *.mov,
                {"*.{mov,avi}"}). Leave empty to trigger on any change.
              </span>
            </label>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex flex-col">
                Include subfolders
                <span className="text-[10px] text-muted-foreground/60">
                  Watch the directory above and everything inside it.
                </span>
              </span>
              <Switch
                aria-label="include subfolders"
                checked={form.watchRecursive}
                onCheckedChange={(watchRecursive) => onChange({ ...form, watchRecursive })}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              Runs the command when the directory changes — no polling. Won't start a new run while
              one is still going; counts toward the run limit.
            </span>
          </div>
        ) : form.triggerType === "webhook" ? (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-muted-foreground">
              Fires the command when a POST hits the automation's webhook URL. The URL is generated
              when you save — copy it from the automation's detail view. Anyone with the URL can
              fire it; won't start a new run while one is still going; counts toward the run limit.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Events</span>
            <EventTriggerSelector
              selected={form.eventNames}
              options={SESSION_EVENTS}
              labels={SESSION_EVENT_LABELS}
              descriptions={SESSION_EVENT_DESCRIPTIONS}
              onChange={(eventNames) => onChange({ ...form, eventNames })}
            />
            <span className="text-[10px] text-muted-foreground">
              {form.eventNames.length > 0
                ? SESSION_EVENT_DESCRIPTIONS[form.eventNames[0]]
                : "Select at least one event."}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Fires when any localterm session in this directory emits one of the selected events.
              Won't start a new run while one is still going; counts toward the run limit.
            </span>
          </div>
        )}
      </FormSection>

      <FormSection label="Limits">
        <div className="flex items-center gap-2">
          <SettingsSelect
            value={form.limitMode}
            items={[
              { id: "forever", label: "Runs forever" },
              { id: "count", label: "Stop after N runs" },
            ]}
            ariaLabel="run limit"
            placeholder="Limit"
            triggerClassName="w-44"
            onValueChange={(next) =>
              onChange({ ...form, limitMode: next === "count" ? "count" : "forever" })
            }
          />
          {form.limitMode === "count" ? (
            <NumberStepper
              value={form.limitMax}
              min={1}
              max={AUTOMATION_RUN_LIMIT_MAX}
              step={1}
              ariaLabel="maximum runs"
              decrementAriaLabel="fewer runs"
              incrementAriaLabel="more runs"
              onValueChange={(value) =>
                onChange({
                  ...form,
                  limitMax: Math.min(AUTOMATION_RUN_LIMIT_MAX, Math.max(1, value)),
                })
              }
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          Enabled
          <Switch
            aria-label="automation enabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => onChange({ ...form, enabled })}
          />
        </div>

        {form.runner.runnerType === "shell" ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex flex-col">
              Close tab when finished
              <span
                className={
                  closeOnFinishSupported
                    ? "text-[10px] text-muted-foreground/60"
                    : "text-[10px] text-[var(--localterm-yellow)]"
                }
              >
                {closeOnFinishSupported
                  ? "Closes the run's tab once the command exits."
                  : "Needs a Chromium browser with remote debugging enabled — run tabs won't close until it's on."}
              </span>
            </span>
            <Switch
              aria-label="close tab when finished"
              checked={form.closeOnFinish}
              disabled={closeOnFinishDisabled}
              onCheckedChange={(closeOnFinish) => onChange({ ...form, closeOnFinish })}
            />
          </div>
        ) : null}
      </FormSection>

      <FormSection label="Secrets to expose">
        {secrets === null ? (
          <span className="text-[10px] text-muted-foreground/60">Loading secrets…</span>
        ) : secrets.length === 0 ? (
          <span className="text-[10px] text-muted-foreground/60">
            No secrets configured. Add them in the secrets menu.
          </span>
        ) : (
          <SecretSelector
            selected={form.requestedSecrets}
            options={secrets}
            onChange={(requestedSecrets) => onChange({ ...form, requestedSecrets })}
          />
        )}
        <span className="text-[10px] text-muted-foreground/60">
          Selected secrets are injected as environment variables when this automation runs. Values
          are resolved from the Keychain into the run’s environment and never travel over the
          network. A secret deleted after you select it is skipped at run time.
        </span>
      </FormSection>

      {saveError ? (
        <p className="text-[10px] text-destructive">
          Couldn't save — check the schedule and that the directory exists.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" disabled={!isValid || isSaving} onClick={onSave}>
          {isSaving ? <Spinner className="size-3.5" aria-label="saving" /> : null}
          {form.id ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
};

const TRIAGE_FILTERS = ["all", "unread", "failed", "skipped"] as const;
type TriageFilter = (typeof TRIAGE_FILTERS)[number];

const findFirstFindingsLine = (findings: string | null): string => {
  if (!findings) return "";
  const line = findings.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.trim().slice(0, 140);
};

const triggerChip = (trigger: AutomationRunRecord["trigger"]): string =>
  trigger === "manual"
    ? "manual"
    : trigger === "watch"
      ? "watch"
      : trigger === "event"
        ? "event"
        : trigger === "webhook"
          ? "webhook"
          : "scheduled";

const TriageRunRow = ({
  automation,
  run,
  nowMs,
  onOpenLog,
  onSelect,
}: {
  automation: AutomationWithNextRun;
  run: AutomationRunRecord;
  nowMs: number;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
}) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  const findingsPreview = findFirstFindingsLine(run.findings);
  return (
    <div className="flex items-center gap-3 rounded-sm px-2.5 py-1.5 text-xs transition-colors hover:bg-foreground/5">
      <button
        type="button"
        aria-label={`open ${automation.name} run log`}
        title="Open run log"
        onClick={() => onOpenLog(automation.id, run)}
        className="flex min-w-0 flex-1 items-center gap-5 text-left outline-none"
      >
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn("size-1.5 rounded-full", run.unread ? "bg-foreground" : "bg-transparent")}
            aria-hidden="true"
          />
          <span className={cn("font-mono text-[10px] tabular-nums", badge.className)}>
            {badge.label}
          </span>
        </span>
        <span className="min-w-0 shrink-0 truncate text-foreground/90">{automation.name}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {findingsPreview}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="min-w-[4.5rem] text-right text-[11px] text-muted-foreground/70">
            {triggerChip(run.trigger)}
          </span>
          <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatRelativeTime(runTimestamp(run), nowMs)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`open ${automation.name} automation`}
        title="Open automation"
        onClick={() => onSelect(automation.id, run)}
        className="shrink-0 rounded-sm text-muted-foreground/60 outline-none transition-colors hover:text-foreground"
      >
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};

const TriageThreadRow = ({
  automation,
  runs,
  latestTimestamp,
  unreadCount,
  nowMs,
  onOpenLog,
  onSelect,
}: {
  automation: AutomationWithNextRun;
  runs: AutomationRunRecord[];
  latestTimestamp: number;
  unreadCount: number;
  nowMs: number;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
}) => {
  const latestRun = runs[0];
  const [open, setOpen] = useState(unreadCount > 0);
  const badge = runStatusBadge(latestRun.status, latestRun.exitCode);
  const findingsPreview = findFirstFindingsLine(latestRun.findings);
  const hasUnread = unreadCount > 0;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-sm">
      <div className="flex items-center gap-3 px-2.5 py-1.5 text-xs transition-colors hover:bg-foreground/5">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              title={open ? "Collapse thread" : "Expand thread"}
              aria-label={`${automation.name}, ${runs.length} runs${hasUnread ? `, ${unreadCount} unread` : ""}`}
              className="group flex min-w-0 flex-1 items-center gap-5 text-left outline-none"
            />
          }
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                hasUnread ? "bg-foreground" : "bg-transparent",
              )}
              aria-hidden="true"
            />
            <span className={cn("font-mono text-[10px] tabular-nums", badge.className)}>
              {badge.label}
            </span>
          </span>
          <span
            className={cn(
              "min-w-0 shrink-0 truncate",
              hasUnread ? "font-medium text-foreground" : "text-foreground/90",
            )}
          >
            {automation.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
            {findingsPreview}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-right text-[11px] tabular-nums text-muted-foreground/70">
              {runs.length} runs
              {hasUnread ? <span className="text-foreground"> · {unreadCount} unread</span> : null}
            </span>
            <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatRelativeTime(latestTimestamp, nowMs)}
            </span>
            <ChevronDown
              className="size-3 text-muted-foreground/70 transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <button
          type="button"
          aria-label={`open ${automation.name} automation`}
          title="Open automation"
          onClick={() => onSelect(automation.id, latestRun)}
          className="shrink-0 rounded-sm text-muted-foreground/60 outline-none transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <CollapsibleContent>
        <div className="ml-3 border-l border-border/40">
          {runs.map((run) => (
            <TriageRunRow
              key={`${automation.id}:${run.runId}`}
              automation={automation}
              run={run}
              nowMs={nowMs}
              onOpenLog={onOpenLog}
              onSelect={onSelect}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const RecentRunsView = ({
  runs,
  nowMs,
  filter,
  onFilterChange,
  onSelect,
  onOpenLog,
  onMarkAllRead,
  onClearHistory,
}: {
  runs: Array<{ automation: AutomationWithNextRun; run: AutomationRunRecord }>;
  nowMs: number;
  filter: TriageFilter;
  onFilterChange: (filter: TriageFilter) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onMarkAllRead: () => void;
  onClearHistory: () => void;
}) => {
  const hasUnread = runs.some(({ run }) => run.unread);
  const [armedClear, setArmedClear] = useState(false);
  const sections = useMemo(() => groupTriageRuns(runs, nowMs), [runs, nowMs]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2">
        {TRIAGE_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilterChange(value)}
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] capitalize transition-colors",
              filter === value
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
        {hasUnread ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="ml-auto rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        ) : null}
        {runs.length > 0 ? (
          <button
            type="button"
            aria-label={armedClear ? "confirm clear all run history" : "clear all run history"}
            title={
              armedClear
                ? "Click again to confirm"
                : "Clear all run history (keeps the automations)"
            }
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] transition-colors",
              armedClear
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground hover:text-foreground",
              hasUnread ? "ml-1" : "ml-auto",
            )}
            onClick={() => {
              if (!armedClear) {
                setArmedClear(true);
                return;
              }
              setArmedClear(false);
              onClearHistory();
            }}
          >
            <Eraser className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {sections.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No runs to show.</p>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <div className={cn(SECTION_LABEL_CLASSES, "px-2.5 pb-1 pt-2")}>{section.label}</div>
              {section.rows.map((row) =>
                row.kind === "thread" ? (
                  <TriageThreadRow
                    key={`thread:${row.automation.id}`}
                    automation={row.automation}
                    runs={row.runs}
                    latestTimestamp={row.latestTimestamp}
                    unreadCount={row.unreadCount}
                    nowMs={nowMs}
                    onOpenLog={onOpenLog}
                    onSelect={onSelect}
                  />
                ) : (
                  <TriageRunRow
                    key={`inline:${row.automation.id}:${row.run.runId}`}
                    automation={row.automation}
                    run={row.run}
                    nowMs={nowMs}
                    onOpenLog={onOpenLog}
                    onSelect={onSelect}
                  />
                ),
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

interface AutomationListPopoverProps {
  automations: AutomationWithNextRun[] | null;
  selectedId: string | null;
  nowMs: number;
  onSelect: (id: string) => void;
}

const AutomationListPopover = ({
  automations,
  selectedId,
  nowMs,
  onSelect,
}: AutomationListPopoverProps) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!automations) return null;
    const lower = search.toLowerCase();
    return lower
      ? automations.filter(
          (automation) =>
            automation.name.toLowerCase().includes(lower) ||
            runnerSummary(automation.runner).toLowerCase().includes(lower),
        )
      : automations;
  }, [automations, search]);

  return (
    <div className="flex max-h-72 flex-col">
      <div className="border-b border-border/40 px-2 py-1.5">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search automations…"
          autoFocus
          className="w-full rounded-sm border border-border/50 bg-transparent py-0.5 px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
        />
      </div>
      <div
        className="overflow-y-auto overscroll-contain p-1"
        role="listbox"
        aria-label="automations"
      >
        {filtered === null ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {search ? "No automations match your search." : "No automations yet."}
          </p>
        ) : (
          filtered.map((automation) => {
            const isSelected = automation.id === selectedId;
            return (
              <button
                key={automation.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(automation.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                  isSelected
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 truncate text-xs",
                    !automation.enabled && "line-through opacity-60",
                  )}
                >
                  {automation.name}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums">
                  {automation.lifecycle === "finished"
                    ? "finished"
                    : automation.trigger.kind === "watch"
                      ? automation.enabled
                        ? "watching"
                        : "paused"
                      : automation.trigger.kind === "event"
                        ? automation.enabled
                          ? "listening"
                          : "paused"
                        : automation.trigger.kind === "webhook"
                          ? automation.enabled
                            ? "on webhook"
                            : "paused"
                          : automation.nextRunAt !== null
                            ? formatRelativeTime(automation.nextRunAt, nowMs)
                            : "paused"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

const AUTOMATION_ROW_HEIGHT = 44;

interface AutomationSidebarProps {
  automations: AutomationWithNextRun[] | null;
  sortBy: AutomationsSort;
  search: string;
  selectedId: string | null;
  nowMs: number;
  onSortChange: (value: AutomationsSort) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
}

const AutomationSidebar = ({
  automations,
  sortBy,
  search,
  selectedId,
  nowMs,
  onSortChange,
  onSearchChange,
  onSelect,
}: AutomationSidebarProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: automations?.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => AUTOMATION_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => automations![index].id,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-1.5 pt-1.5 pb-0.5">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search…"
          className="w-full rounded-sm border border-border/50 bg-transparent py-1 pl-6 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border"
        />
      </div>
      <div className="flex items-center gap-1 px-2 pb-1">
        {(["last-run", "created", "name"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSortChange(value)}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] transition-colors",
              sortBy === value
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "last-run" ? "Last run" : value === "created" ? "Created" : "Name"}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="automations"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pt-0"
      >
        {automations === null ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : automations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {search
              ? "No automations match your search."
              : "No automations yet. Scheduled commands open a new tab when they run."}
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const automation = automations[virtualRow.index];
              const badge = automation.lastRun
                ? runStatusBadge(automation.lastRun.status, automation.lastRun.exitCode)
                : null;
              const isSelected = automation.id === selectedId;
              return (
                <button
                  key={automation.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(automation.id)}
                  data-index={virtualRow.index}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                    isSelected
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5",
                  )}
                  style={
                    {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    } satisfies CSSProperties
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs",
                        !automation.enabled && "line-through opacity-60",
                      )}
                    >
                      {automation.name}
                    </span>
                    {badge ? (
                      <span className={cn("shrink-0 text-[10px]", badge.className)}>
                        {badge.label}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80">
                    <span className="min-w-0 truncate">{triggerLabel(automation.trigger)}</span>
                    <span className="shrink-0 tabular-nums">
                      {automation.lifecycle === "finished"
                        ? "finished"
                        : automation.trigger.kind === "watch"
                          ? automation.enabled
                            ? "watching"
                            : "paused"
                          : automation.trigger.kind === "event"
                            ? automation.enabled
                              ? "listening"
                              : "paused"
                            : automation.trigger.kind === "webhook"
                              ? automation.enabled
                                ? "on webhook"
                                : "paused"
                              : automation.nextRunAt !== null
                                ? formatRelativeTime(automation.nextRunAt, nowMs)
                                : "paused"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
