import type {
  AutomationRunRecord,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import {
  ChevronDown,
  Eraser,
  Minimize2,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { AutomationRunRow } from "@/components/automation-run-row";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SECTION_LABEL_CLASSES } from "@/lib/automation-form-styles";
import { COPY_FEEDBACK_MS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { lifecycleBadge, runStatusBadge } from "@/utils/run-status-badge";
import { runnerSummary, runnerTypeLabel } from "@/utils/runner-form";
import { triggerLabel } from "@/utils/schedule-builder";

interface AutomationDetailProps {
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
}

export const AutomationDetail = ({
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
}: AutomationDetailProps) => {
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
          <h3 className="truncate text-xs font-medium text-foreground">{automation.name}</h3>
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
                <AutomationRunRow key={run.runId} run={run} nowMs={nowMs} onOpenLog={onOpenLog} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
