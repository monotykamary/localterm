import {
  AUTOMATION_RUN_LIMIT_MAX,
  compileScheduleAll,
  nextCronOccurrence,
  parseCronExpression,
  type AutomationRunRecord,
  type AutomationWithNextRun,
  type SecretEntryResponse,
} from "@monotykamary/localterm-server/protocol";
import { CalendarClock, ChevronDown, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AutomationDetail } from "@/components/automation-detail";
import { AutomationForm } from "@/components/automation-form";
import { AutomationListPopover, AutomationSidebar } from "@/components/automation-navigation";
import { AutomationRecentRunsView } from "@/components/automation-recent-runs-view";
import { AutomationRunLogView } from "@/components/automation-run-log-view";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import type { AutomationFormState } from "@/lib/automation-form-state";
import type { AutomationsSort } from "@/lib/automations-sort";
import {
  AUTOMATIONS_LIVE_POLL_MS,
  AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS,
  AUTOMATIONS_RELATIVE_TIME_REFRESH_MS,
  AUTOMATIONS_SIDEBAR_COLLAPSE_WIDTH_PX,
  AUTOMATIONS_SIDEBAR_WIDTH_PX,
  AUTOMATIONS_SORT_DEFAULT,
  AUTOMATIONS_SORT_STORAGE_KEY,
  AUTOMATION_RUN_LIMIT_DEFAULT_COUNT,
  RECENT_RUNS_LIMIT,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { clearAutomationHistory } from "@/utils/clear-automation-history";
import { clearAutomationRuns } from "@/utils/clear-automation-runs";
import { clearThreadSession } from "@/utils/clear-thread-session";
import { compactAutomation } from "@/utils/compact-automation";
import { computeAutomationsHeaderLayout } from "@/utils/compute-automations-header-layout";
import { createAutomation } from "@/utils/create-automation";
import { deleteAutomation } from "@/utils/delete-automation";
import { fetchAutomations } from "@/utils/fetch-automations";
import { fetchSecrets } from "@/utils/fetch-secrets";
import { fetchServerHealth, type ServerHealth } from "@/utils/fetch-server-health";
import { getAutomationRunTimestamp } from "@/utils/get-automation-run-timestamp";
import { isAutomationsSort } from "@/utils/is-automations-sort";
import { markAllTriageRead } from "@/utils/mark-all-triage-read";
import { markAutomationRunRead } from "@/utils/mark-automation-run-read";
import { resetAutomation } from "@/utils/reset-automation";
import {
  buildRunnerFromForm,
  defaultRunnerForm,
  isRunnerFormValid,
  recognizeRunnerForm,
  runnerSummary,
} from "@/utils/runner-form";
import {
  buildScheduleFromForm,
  buildTriggerFromForm,
  defaultScheduleForm,
  recognizeTriggerForm,
} from "@/utils/schedule-builder";
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

interface AutomationLogViewState {
  automationId: string;
  runId: string;
}
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
  limitMax: AUTOMATION_RUN_LIMIT_DEFAULT_COUNT,
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
    limitMax:
      automation.limit.kind === "count" ? automation.limit.max : AUTOMATION_RUN_LIMIT_DEFAULT_COUNT,
    closeOnFinish: automation.closeOnFinish,
    requestedSecrets: automation.requestedSecrets,
  };
};

const loadSortFromStorage = (): AutomationsSort => {
  try {
    const storedSort = localStorage.getItem(AUTOMATIONS_SORT_STORAGE_KEY);
    return isAutomationsSort(storedSort) ? storedSort : AUTOMATIONS_SORT_DEFAULT;
  } catch {
    return AUTOMATIONS_SORT_DEFAULT;
  }
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
  const [logView, setLogView] = useState<AutomationLogViewState | null>(null);
  const [form, setForm] = useState<AutomationFormState>(() => emptyForm(defaultCwd));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [armedClearId, setArmedClearId] = useState<string | null>(null);
  const [armedClearThreadId, setArmedClearThreadId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<"all" | "unread" | "failed" | "skipped">("all");
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
  const [headerConfigIndex, setHeaderConfigIndex] = useState(0);

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
    const timer = window.setTimeout(() => setMounted(false), AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
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
      previousConfigIndex: headerConfigIndex,
    });
    return result;
  }, [headerWidth, tab, mode, headerConfigIndex]);

  useLayoutEffect(() => {
    setHeaderConfigIndex(headerLayout.configIndex);
  }, [headerLayout.configIndex]);

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
    (form.triggerType !== "event" || form.eventNames.length > 0) &&
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
    flattened.sort(
      (first, second) =>
        getAutomationRunTimestamp(second.run) - getAutomationRunTimestamp(first.run),
    );
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
          <AutomationRunLogView
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
          <AutomationRecentRunsView
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
