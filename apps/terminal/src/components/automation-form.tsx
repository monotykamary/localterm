import { AUTOMATION_RUN_LIMIT_MAX, type CdpHealth, type SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import type { ReactNode } from "react";
import { AgentComposer } from "@/components/agent-composer";
import { AutomationScheduleBuilder } from "@/components/automation-schedule-builder";
import { EventTriggerSelector } from "@/components/event-trigger-selector";
import { NumberStepper } from "@/components/number-stepper";
import { SecretSelector } from "@/components/secret-selector";
import { SettingsSelect } from "@/components/settings-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { FORM_INPUT_CLASSES, FORM_SECTION_CARD_CLASSES, SECTION_LABEL_CLASSES } from "@/lib/automation-form-styles";
import type { AutomationFormState } from "@/lib/automation-form-state";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { isHarnessKind } from "@/utils/is-harness-kind";
import { isRunnerType } from "@/utils/is-runner-type";
import { isTriggerType } from "@/utils/is-trigger-type";
import { SESSION_EVENT_DESCRIPTIONS, SESSION_EVENT_LABELS, SESSION_EVENTS } from "@/utils/schedule-builder";

interface FormSectionProps {
  label: string;
  children: ReactNode;
}

interface AutomationFormProps {
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
}

const FormSection = ({ label, children }: FormSectionProps) => (
  <section className={FORM_SECTION_CARD_CLASSES}>
    <span className={SECTION_LABEL_CLASSES}>{label}</span>
    {children}
  </section>
);

export const AutomationForm = ({
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
}: AutomationFormProps) => {
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
          className={cn(FORM_INPUT_CLASSES, "font-medium")}
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
          onValueChange={(next) => {
            if (!isRunnerType(next)) return;
            onChange({ ...form, runner: { ...form.runner, runnerType: next } });
          }}
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
                onValueChange={(next) => {
                  if (!isHarnessKind(next)) return;
                  onChange({
                    ...form,
                    runner: { ...form.runner, harnessKind: next },
                  });
                }}
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
          onValueChange={(next) => {
            if (isTriggerType(next)) onChange({ ...form, triggerType: next });
          }}
        />
        {form.triggerType === "schedule" ? (
          <>
            <AutomationScheduleBuilder
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
