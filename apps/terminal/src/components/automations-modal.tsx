import {
  AUTOMATION_RUN_LIMIT_MAX,
  compileScheduleAll,
  nextCronOccurrence,
  parseCronExpression,
  type AutomationRunRecord,
  type AutomationSessionEvent,
  type AutomationWithNextRun,
  type CdpHealth,
  type SecretEntryResponse,
} from "@monotykamary/localterm-server/protocol";
import {
  CalendarClock,
  ChevronDown,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
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
} from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { EventTriggerSelector } from "@/components/event-trigger-selector";
import { SecretSelector } from "@/components/secret-selector";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect } from "@/components/settings-select";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS,
  AUTOMATIONS_RELATIVE_TIME_REFRESH_MS,
  AUTOMATIONS_SIDEBAR_COLLAPSE_WIDTH_PX,
  AUTOMATIONS_SIDEBAR_WIDTH_PX,
  AUTOMATIONS_SORT_DEFAULT,
  AUTOMATIONS_SORT_STORAGE_KEY,
  COPY_FEEDBACK_MS,
  RECENT_RUNS_LIMIT,
} from "@/lib/constants";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { computeAutomationsHeaderLayout } from "@/utils/compute-automations-header-layout";
import { createAutomation } from "@/utils/create-automation";
import { deleteAutomation } from "@/utils/delete-automation";
import { fetchAutomations } from "@/utils/fetch-automations";
import { fetchSecrets } from "@/utils/fetch-secrets";
import { fetchServerHealth, type ServerHealth } from "@/utils/fetch-server-health";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { resetAutomation } from "@/utils/reset-automation";
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
  command: string;
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

const runTimestamp = (run: AutomationRunRecord): number =>
  run.finishedAt ?? run.startedAt ?? run.scheduledFor;

const emptyForm = (defaultCwd: string | null): AutomationFormState => ({
  id: null,
  name: "",
  command: "",
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
    command: automation.command,
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

const RunRow = ({ run, nowMs }: { run: AutomationRunRecord; nowMs: number }) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 font-mono text-[10px]">
      <span className={cn("w-16 shrink-0", badge.className)}>{badge.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {run.status === "skipped"
          ? `was due ${formatClockTime(new Date(run.scheduledFor).getHours(), new Date(run.scheduledFor).getMinutes())} · machine off`
          : run.trigger === "manual"
            ? "manual run"
            : run.trigger === "watch"
              ? "on change"
              : run.trigger === "event"
                ? "on event"
                : run.trigger === "webhook"
                  ? "on webhook"
                  : "scheduled"}
      </span>
      <span className="shrink-0 text-muted-foreground/70 tabular-nums">
        {formatRelativeTime(runTimestamp(run), nowMs)}
      </span>
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
      "rounded-sm border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors",
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
        <div className="grid w-fit grid-cols-7 gap-1 justify-items-center">
          {WEEKDAY_NAMES.map((name) => (
            <div
              key={name}
              className="text-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60"
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
            />
          ))}
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
  const [form, setForm] = useState<AutomationFormState>(() => emptyForm(defaultCwd));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<"all" | "failed" | "skipped">("all");
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
    return () => window.clearInterval(tick);
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
            automation.command.toLowerCase().includes(lower),
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
      if (mode !== "view") {
        closeForm();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, mode, closeForm, onClose]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

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
    form.command.trim().length > 0 &&
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
      command: form.command.trim(),
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

  const recentRuns = useMemo(() => {
    if (!automations) return [];
    const flattened = automations.flatMap((automation) =>
      automation.runs.map((run) => ({ automation, run })),
    );
    flattened.sort((a, b) => runTimestamp(b.run) - runTimestamp(a.run));
    const filtered = flattened.filter(({ run }) => {
      if (runFilter === "failed") return run.status === "failed";
      if (runFilter === "skipped") return run.status === "skipped";
      return true;
    });
    return filtered.slice(0, RECENT_RUNS_LIMIT);
  }, [automations, runFilter]);

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
                  ["recent-runs", "Recent runs"],
                ] as const)
              : ([
                  ["automations", "A"],
                  ["recent-runs", "R"],
                ] as const)
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors",
                  tab === value
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
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

        {tab === "recent-runs" ? (
          <RecentRunsView
            runs={recentRuns}
            nowMs={nowMs}
            filter={runFilter}
            onFilterChange={setRunFilter}
            onSelect={(automationId) => {
              setSelectedId(automationId);
              setTab("automations");
              setMode("view");
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
}: {
  automation: AutomationWithNextRun;
  nowMs: number;
  armedDelete: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: () => void;
}) => {
  const finished = lifecycleBadge(automation.lifecycle);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
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
            {automation.command}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`run ${automation.name} now`}
            className="hover:text-foreground"
            onClick={onRunNow}
          >
            <Play />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`edit ${automation.name}`}
            className="hover:text-foreground"
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
              armedDelete ? "text-red-400 hover:text-red-400" : "hover:text-foreground",
            )}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
          <Switch
            size="sm"
            // The icon buttons carry their own padding; the switch doesn't, so
            // a small left margin keeps its spacing even with the buttons.
            className="ml-1.5"
            aria-label={`toggle ${automation.name}`}
            checked={automation.enabled}
            onCheckedChange={onToggleEnabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
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
        <div className="flex items-center justify-between gap-2 rounded-md border border-violet-400/30 bg-violet-400/5 px-3 py-2 text-[11px]">
          <span className="text-violet-300">
            Finished — reached its run limit. Reset to run it again.
          </span>
          <Button variant="outline" size="xs" onClick={onReset}>
            <RotateCcw aria-hidden="true" /> Reset
          </Button>
        </div>
      ) : null}

      <Separator className="bg-border/40" />

      <Collapsible defaultOpen>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-2 text-left"
            />
          }
        >
          <span className={SECTION_LABEL_CLASSES}>History · {automation.runs.length} runs</span>
          <ChevronDown
            className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {automation.runs.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="mt-1 flex flex-col divide-y divide-border/30 rounded-md border border-border/40">
              {automation.runs.map((run) => (
                <RunRow key={run.runId} run={run} nowMs={nowMs} />
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
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Name
        <Input
          value={form.name}
          autoFocus
          placeholder="nightly build"
          aria-label="automation name"
          className={FORM_INPUT_CLASSES}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Command
        <Input
          value={form.command}
          placeholder="pnpm build"
          aria-label="automation command"
          className={cn(FORM_INPUT_CLASSES, "font-mono")}
          onChange={(event) => onChange({ ...form, command: event.target.value })}
        />
      </label>
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

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASSES}>Trigger</span>
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
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASSES}>Run limit</span>
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
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        Enabled
        <Switch
          aria-label="automation enabled"
          checked={form.enabled}
          onCheckedChange={(enabled) => onChange({ ...form, enabled })}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex flex-col">
          Close tab when finished
          <span
            className={
              closeOnFinishSupported
                ? "text-[10px] text-muted-foreground/60"
                : "text-[10px] text-amber-400"
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

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASSES}>Secrets to expose</span>
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
      </div>

      {saveError ? (
        <p className="text-[10px] text-red-400">
          Couldn't save — check the schedule and that the directory exists.
        </p>
      ) : null}

      <Separator className="bg-border/40" />
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="xs" disabled={!isValid || isSaving} onClick={onSave}>
          {isSaving ? <Spinner className="size-3" aria-label="saving" /> : null}
          {form.id ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
};

const RecentRunsView = ({
  runs,
  nowMs,
  filter,
  onFilterChange,
  onSelect,
}: {
  runs: Array<{ automation: AutomationWithNextRun; run: AutomationRunRecord }>;
  nowMs: number;
  filter: "all" | "failed" | "skipped";
  onFilterChange: (filter: "all" | "failed" | "skipped") => void;
  onSelect: (automationId: string) => void;
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2">
      {(["all", "failed", "skipped"] as const).map((value) => (
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
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
      {runs.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No runs to show.</p>
      ) : (
        runs.map(({ automation, run }) => {
          const badge = runStatusBadge(run.status, run.exitCode);
          return (
            <button
              key={`${automation.id}:${run.runId}`}
              type="button"
              onClick={() => onSelect(automation.id)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-foreground/5"
            >
              <span className={cn("w-16 shrink-0 text-[10px] tabular-nums", badge.className)}>
                {badge.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
                {automation.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                {run.trigger === "manual"
                  ? "manual"
                  : run.trigger === "watch"
                    ? "watch"
                    : run.trigger === "event"
                      ? "event"
                      : run.trigger === "webhook"
                        ? "webhook"
                        : "scheduled"}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {formatRelativeTime(runTimestamp(run), nowMs)}
              </span>
            </button>
          );
        })
      )}
    </div>
  </div>
);

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
            automation.command.toLowerCase().includes(lower),
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
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
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
                    "flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
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
