import {
  nextCronOccurrence,
  parseCronExpression,
  type AutomationLastRun,
  type AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { CalendarClock, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PANEL_ANIMATION_CLASSES, TRANSLUCENT_PANEL_CLASSES } from "@/lib/animation-classes";
import { AUTOMATIONS_RELATIVE_TIME_REFRESH_MS, TOOLTIP_SIDE_OFFSET_PX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { createAutomation } from "@/utils/create-automation";
import { deleteAutomation } from "@/utils/delete-automation";
import { fetchAutomations } from "@/utils/fetch-automations";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { triggerAutomationRun } from "@/utils/trigger-automation-run";
import { updateAutomation } from "@/utils/update-automation";

interface AutomationsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automations: AutomationWithNextRun[] | null;
  onAutomationsLoaded: (automations: AutomationWithNextRun[]) => void;
  defaultCwd: string | null;
  isMac: boolean;
}

interface AutomationFormState {
  id: string | null;
  name: string;
  schedule: string;
  cwd: string;
  command: string;
  enabled: boolean;
}

const SECTION_LABEL_CLASSES =
  "text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase";

const FORM_INPUT_CLASSES = "h-7 px-2 text-xs md:text-xs";

const lastRunBadge = (lastRun: AutomationLastRun): { label: string; className: string } => {
  if (lastRun.status === "launched") return { label: "launching…", className: "text-amber-400" };
  if (lastRun.status === "running") return { label: "running…", className: "text-sky-400" };
  if (lastRun.status === "completed") return { label: "ok", className: "text-emerald-400" };
  if (lastRun.status === "failed") {
    return {
      label: lastRun.exitCode === null ? "failed" : `exit ${lastRun.exitCode}`,
      className: "text-red-400",
    };
  }
  return { label: "missed", className: "text-muted-foreground" };
};

const emptyFormState = (defaultCwd: string | null): AutomationFormState => ({
  id: null,
  name: "",
  schedule: "",
  cwd: defaultCwd ?? "",
  command: "",
  enabled: true,
});

const formStateForAutomation = (automation: AutomationWithNextRun): AutomationFormState => ({
  id: automation.id,
  name: automation.name,
  schedule: automation.schedule,
  cwd: automation.cwd,
  command: automation.command,
  enabled: automation.enabled,
});

export const AutomationsMenu = ({
  open,
  onOpenChange,
  automations,
  onAutomationsLoaded,
  defaultCwd,
  isMac,
}: AutomationsMenuProps) => {
  const [formState, setFormState] = useState<AutomationFormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refreshAutomations = useCallback(async () => {
    const fetched = await fetchAutomations();
    if (fetched) onAutomationsLoaded(fetched);
  }, [onAutomationsLoaded]);

  useEffect(() => {
    if (!open) {
      setFormState(null);
      setSaveError(false);
      setArmedDeleteId(null);
      return;
    }
    setNowMs(Date.now());
    void refreshAutomations();
    const tick = window.setInterval(
      () => setNowMs(Date.now()),
      AUTOMATIONS_RELATIVE_TIME_REFRESH_MS,
    );
    return () => window.clearInterval(tick);
  }, [open, refreshAutomations]);

  const handleSave = async () => {
    if (!formState) return;
    setIsSaving(true);
    setSaveError(false);
    const input = {
      name: formState.name.trim(),
      schedule: formState.schedule.trim(),
      cwd: formState.cwd.trim(),
      command: formState.command.trim(),
      enabled: formState.enabled,
    };
    const saved = formState.id
      ? await updateAutomation(formState.id, input)
      : await createAutomation(input);
    setIsSaving(false);
    if (!saved) {
      setSaveError(true);
      return;
    }
    setFormState(null);
    await refreshAutomations();
  };

  const handleToggleEnabled = async (automation: AutomationWithNextRun, enabled: boolean) => {
    await updateAutomation(automation.id, { enabled });
    await refreshAutomations();
  };

  const handleRunNow = async (automation: AutomationWithNextRun) => {
    await triggerAutomationRun(automation.id);
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

  const parsedSchedule = formState ? parseCronExpression(formState.schedule.trim()) : null;
  const scheduleText = formState?.schedule.trim() ?? "";
  const nextPreviewAt = parsedSchedule
    ? (nextCronOccurrence(parsedSchedule, new Date(nowMs))?.getTime() ?? null)
    : null;
  const isFormValid =
    formState !== null &&
    formState.name.trim().length > 0 &&
    formState.command.trim().length > 0 &&
    formState.cwd.trim().length > 0 &&
    parsedSchedule !== null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="automations"
            title={`${isMac ? "⌘" : "Ctrl+"}J`}
            className="hover:text-foreground"
          />
        }
      >
        <CalendarClock />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={TOOLTIP_SIDE_OFFSET_PX}
        className={cn(
          "w-96 gap-0 overflow-hidden p-3",
          TRANSLUCENT_PANEL_CLASSES,
          PANEL_ANIMATION_CLASSES,
        )}
      >
        <div className="flex items-center justify-between">
          <span className={SECTION_LABEL_CLASSES}>Automations</span>
          {formState === null ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="new automation"
              className="hover:text-foreground"
              onClick={() => setFormState(emptyFormState(defaultCwd))}
            >
              <Plus />
            </Button>
          ) : null}
        </div>

        {formState === null ? (
          <div className="mt-2 flex max-h-80 flex-col gap-1 overflow-y-auto">
            {automations === null ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
            ) : automations.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No automations yet. Scheduled commands open a new tab when they run.
              </p>
            ) : (
              automations.map((automation) => (
                <div
                  key={automation.id}
                  className="group/automation flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs text-foreground/90",
                        !automation.enabled && "text-muted-foreground line-through",
                      )}
                      title={automation.name}
                    >
                      {automation.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`run ${automation.name} now`}
                        className="opacity-0 transition-opacity group-hover/automation:opacity-100 hover:text-foreground"
                        onClick={() => void handleRunNow(automation)}
                      >
                        <Play />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`edit ${automation.name}`}
                        className="opacity-0 transition-opacity group-hover/automation:opacity-100 hover:text-foreground"
                        onClick={() => setFormState(formStateForAutomation(automation))}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          armedDeleteId === automation.id
                            ? `confirm delete ${automation.name}`
                            : `delete ${automation.name}`
                        }
                        className={cn(
                          "opacity-0 transition-opacity group-hover/automation:opacity-100",
                          armedDeleteId === automation.id
                            ? "text-red-400 opacity-100 hover:text-red-400"
                            : "hover:text-foreground",
                        )}
                        onClick={() => void handleDelete(automation)}
                      >
                        <Trash2 />
                      </Button>
                      <Switch
                        size="sm"
                        aria-label={`toggle ${automation.name}`}
                        checked={automation.enabled}
                        onCheckedChange={(enabled) => void handleToggleEnabled(automation, enabled)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                    <span className="min-w-0 truncate" title={automation.command}>
                      {automation.command}
                    </span>
                    <span className="shrink-0 tabular-nums">{automation.schedule}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="min-w-0 truncate" title={automation.cwd}>
                      {automation.cwd}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      {automation.lastRun ? (
                        <span
                          className={lastRunBadge(automation.lastRun).className}
                          title={`last run ${formatRelativeTime(automation.lastRun.at, nowMs)}`}
                        >
                          {lastRunBadge(automation.lastRun).label}
                        </span>
                      ) : null}
                      {automation.nextRunAt !== null ? (
                        <span>{formatRelativeTime(automation.nextRunAt, nowMs)}</span>
                      ) : (
                        <span>paused</span>
                      )}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name
              <Input
                value={formState.name}
                autoFocus
                placeholder="nightly build"
                aria-label="automation name"
                className={FORM_INPUT_CLASSES}
                onChange={(event) => setFormState({ ...formState, name: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Command
              <Input
                value={formState.command}
                placeholder="pnpm build"
                aria-label="automation command"
                className={cn(FORM_INPUT_CLASSES, "font-mono")}
                onChange={(event) => setFormState({ ...formState, command: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Directory
              <Input
                value={formState.cwd}
                placeholder="/path/to/project"
                aria-label="automation directory"
                className={cn(FORM_INPUT_CLASSES, "font-mono")}
                onChange={(event) => setFormState({ ...formState, cwd: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Schedule (cron)
              <Input
                value={formState.schedule}
                placeholder="0 9 * * mon-fri"
                aria-label="automation schedule"
                className={cn(FORM_INPUT_CLASSES, "font-mono")}
                onChange={(event) => setFormState({ ...formState, schedule: event.target.value })}
              />
              <span className="text-[10px] tabular-nums">
                {scheduleText.length === 0
                  ? "minute hour day month weekday — or @hourly, @daily, @weekly"
                  : parsedSchedule === null
                    ? "invalid cron expression"
                    : nextPreviewAt !== null
                      ? `next run ${formatRelativeTime(nextPreviewAt, nowMs)}`
                      : "schedule never fires"}
              </span>
            </label>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              Enabled
              <Switch
                aria-label="automation enabled"
                checked={formState.enabled}
                onCheckedChange={(enabled) => setFormState({ ...formState, enabled })}
              />
            </div>
            {saveError ? (
              <p className="text-[10px] text-red-400">
                Couldn't save — check the schedule and that the directory exists.
              </p>
            ) : null}
            <Separator className="bg-border/40" />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFormState(null);
                  setSaveError(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="xs"
                disabled={!isFormValid || isSaving}
                onClick={() => void handleSave()}
              >
                {formState.id ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
