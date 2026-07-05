import { Coffee, Plus, X } from "lucide-react";
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PANEL_ANIMATION_CLASSES, TRANSLUCENT_PANEL_CLASSES } from "@/lib/animation-classes";
import { CAFFEINATE_ACCENT_COLOR, TOOLTIP_SIDE_OFFSET_PX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CaffeinateMode } from "@monotykamary/localterm-server/protocol";

export type { CaffeinateMode };

interface KeepAwakeMenuProps {
  mode: CaffeinateMode;
  active: boolean;
  activityGate: boolean;
  peerKeepAwake: boolean;
  peerActive: boolean;
  batteryThreshold: number | null;
  defaultCommands: readonly string[];
  commands: readonly string[];
  activeTrigger: string | null;
  onModeChange: (mode: CaffeinateMode) => void;
  onCommandsChange: (commands: string[]) => void;
  onActivityGateChange: (enabled: boolean) => void;
  onPeerKeepAwakeChange: (enabled: boolean) => void;
  onBatteryThresholdChange: (percent: number | null) => void;
  onPopoverOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

const SECTION_LABEL_CLASSES =
  "text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase";

const MODE_ITEMS: readonly SettingsSelectItem[] = [
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
  { id: "automatic", label: "Automatic" },
];

// Battery floor choices. `off` maps to null (guard disabled); the rest are
// literal percents the daemon refuses to keep awake below while on battery
// power. Picked to cover the realistic range without an open numeric field.
const BATTERY_THRESHOLD_ITEMS: readonly SettingsSelectItem[] = [
  { id: "off", label: "Off" },
  { id: "10", label: "10%" },
  { id: "15", label: "15%" },
  { id: "20", label: "20%" },
  { id: "30", label: "30%" },
  { id: "50", label: "50%" },
];
const BATTERY_THRESHOLD_VALUE_OFF = "off";

const thresholdToItemId = (percent: number | null): string =>
  percent === null ? BATTERY_THRESHOLD_VALUE_OFF : String(percent);

const itemIdToThreshold = (id: string | null): number | null =>
  id === null || id === BATTERY_THRESHOLD_VALUE_OFF ? null : Number(id);

const MODE_DESCRIPTION: Record<CaffeinateMode, string> = {
  off: "Never keep the system awake.",
  on: "Always keep the system awake.",
  automatic: "Keep awake only while a recognized program is running in localterm.",
};

const isCaffeinateMode = (value: string | null): value is CaffeinateMode =>
  value === "off" || value === "on" || value === "automatic";

const CHIP_BASE_CLASSES =
  "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors duration-200";
const CHIP_IDLE_CLASSES = "border-border/60 bg-foreground/5 text-foreground/80";
const CHIP_ACTIVE_CLASSES = "border-foreground/25 text-background";
// Tints a setting row's Switch to the caffeinate accent while checked. The
// literal class is in source so Tailwind generates it; the `--keep-awake-accent`
// var is set on the row (inline style, from the JS constant) so the color has a
// single source of truth. Applied only while the row's trigger is active.
const ACCENT_CHECKED_CLASS = "data-checked:bg-[var(--keep-awake-accent)]";
const accentVarStyle = { "--keep-awake-accent": CAFFEINATE_ACCENT_COLOR } as CSSProperties;

export const KeepAwakeMenu = ({
  mode,
  active,
  activityGate,
  peerKeepAwake,
  peerActive,
  batteryThreshold,
  defaultCommands,
  commands,
  activeTrigger,
  onModeChange,
  onCommandsChange,
  onActivityGateChange,
  onPeerKeepAwakeChange,
  onBatteryThresholdChange,
  onPopoverOpenChange,
  onClose,
}: KeepAwakeMenuProps) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [draftCommand, setDraftCommand] = useState("");

  const handlePopoverOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    onPopoverOpenChange?.(open);
    if (!open) {
      setDraftCommand("");
      onClose?.();
    }
  };

  const handleModeChange = (next: string | null) => {
    if (isCaffeinateMode(next)) onModeChange(next);
  };

  const handleBatteryThresholdChange = (next: string | null) => {
    const parsed = itemIdToThreshold(next);
    if (parsed === null || Number.isFinite(parsed)) {
      onBatteryThresholdChange(parsed);
    }
  };

  const addDraftCommand = () => {
    const trimmed = draftCommand.trim();
    if (!trimmed) return;
    const lowered = trimmed.toLowerCase();
    // Silently skip a default (already covered) or an existing custom entry so
    // the list never shows a redundant duplicate.
    const isDefault = defaultCommands.some((command) => command.toLowerCase() === lowered);
    const isExisting = commands.some((command) => command.toLowerCase() === lowered);
    if (isDefault || isExisting) {
      setDraftCommand("");
      return;
    }
    onCommandsChange([...commands, trimmed]);
    setDraftCommand("");
  };

  const removeCommand = (command: string) => {
    onCommandsChange(commands.filter((entry) => entry !== command));
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addDraftCommand();
    }
  };

  // Active = the keep-awake process is running right now (always in "on",
  // detection-driven in "automatic"). Tint the icon to match the old toggle.
  const triggerStyle = active ? { color: CAFFEINATE_ACCENT_COLOR } : undefined;
  // A recognized program is the active trigger right now. The activity-gate row
  // glows when its gate is on AND a program is holding; the peer row glows when
  // a peer is holding (`peerActive`, independent of the program trigger so both
  // rows can glow at once). Each setting's label + switch tint to the caffeinate
  // accent to show which trigger is keeping the machine awake.
  const programActive = active && activeTrigger !== null;
  const activityGateRowActive = activityGate && programActive;
  const title =
    mode === "off"
      ? "Keep awake: off"
      : mode === "on"
        ? "Keep awake: on"
        : active
          ? "Keep awake: automatic (active)"
          : "Keep awake: automatic";

  return (
    <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="keep system awake"
            title={title}
            className="hover:text-foreground"
            style={triggerStyle}
          />
        }
      >
        {/* Anchor the automatic badge to the icon itself (not the padded button
            box) so it hugs the coffee cup's lower-right corner. The background
            ring cuts a clean gap so the badge reads as attached, not floating. */}
        <span className="relative inline-flex items-center justify-center">
          <Coffee />
          {mode === "automatic" ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-1 -bottom-1 flex size-[11px] items-center justify-center rounded-full text-[8px] leading-none font-bold ring-[1.5px] ring-background",
                active ? "text-background" : "bg-muted text-foreground/75",
              )}
              style={active ? { backgroundColor: CAFFEINATE_ACCENT_COLOR } : undefined}
            >
              <span className="translate-x-[0.125px] translate-y-[-0.25px]">A</span>
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={TOOLTIP_SIDE_OFFSET_PX}
        className={cn(
          "w-64 max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto p-3",
          TRANSLUCENT_PANEL_CLASSES,
          PANEL_ANIMATION_CLASSES,
        )}
      >
        <FieldGroup className="gap-3">
          <Field orientation="vertical" className="gap-1.5">
            <FieldLabel className={SECTION_LABEL_CLASSES}>Keep awake</FieldLabel>
            <SettingsSelect
              value={mode}
              items={MODE_ITEMS}
              ariaLabel="select keep-awake mode"
              placeholder="Mode"
              onValueChange={handleModeChange}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {MODE_DESCRIPTION[mode]}
            </p>
          </Field>

          <Separator className="bg-border/40" />
          <Field orientation="vertical" className="gap-1.5">
            <FieldLabel className={SECTION_LABEL_CLASSES}>Battery floor</FieldLabel>
            <SettingsSelect
              value={thresholdToItemId(batteryThreshold)}
              items={BATTERY_THRESHOLD_ITEMS}
              ariaLabel="select battery floor"
              placeholder="Floor"
              onValueChange={handleBatteryThresholdChange}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {batteryThreshold === null
                ? "Never stop on battery."
                : `Stop keeping awake at or below ${batteryThreshold}% on battery power.`}
            </p>
          </Field>

          {mode === "automatic" ? (
            <>
              <Separator className="bg-border/40" />
              <div
                className="flex items-center justify-between gap-2"
                style={activityGateRowActive ? accentVarStyle : undefined}
              >
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-[11px] font-medium text-foreground/90 transition-colors duration-200"
                    style={activityGateRowActive ? { color: CAFFEINATE_ACCENT_COLOR } : undefined}
                  >
                    Activity gate
                  </span>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Only keep awake while a recognized program is producing output.
                  </p>
                </div>
                <Switch
                  size="sm"
                  checked={activityGate}
                  onCheckedChange={onActivityGateChange}
                  aria-label="toggle activity gate"
                  className={activityGateRowActive ? ACCENT_CHECKED_CLASS : undefined}
                />
              </div>

              <Separator className="bg-border/40" />
              <div
                className="flex items-center justify-between gap-2"
                style={peerActive ? accentVarStyle : undefined}
              >
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-[11px] font-medium text-foreground/90 transition-colors duration-200"
                    style={peerActive ? { color: CAFFEINATE_ACCENT_COLOR } : undefined}
                  >
                    Keep awake for peers
                  </span>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Stay awake while another client (e.g. a phone) is attached to a session.
                  </p>
                </div>
                <Switch
                  size="sm"
                  checked={peerKeepAwake}
                  onCheckedChange={onPeerKeepAwakeChange}
                  aria-label="toggle peer keep-awake"
                  className={peerActive ? ACCENT_CHECKED_CLASS : undefined}
                />
              </div>

              <Separator className="bg-border/40" />
              <Field orientation="vertical" className="gap-1.5">
                <FieldLabel className={SECTION_LABEL_CLASSES}>Detected automatically</FieldLabel>
                <div className="flex flex-wrap gap-1">
                  {defaultCommands.map((command) => {
                    const isActive =
                      active &&
                      activeTrigger !== null &&
                      activeTrigger.toLowerCase() === command.toLowerCase();
                    return (
                      <span
                        key={command}
                        className={cn(
                          CHIP_BASE_CLASSES,
                          isActive ? CHIP_ACTIVE_CLASSES : CHIP_IDLE_CLASSES,
                        )}
                        style={isActive ? { backgroundColor: CAFFEINATE_ACCENT_COLOR } : undefined}
                      >
                        {command}
                      </span>
                    );
                  })}
                </div>
              </Field>

              <Separator className="bg-border/40" />
              <Field orientation="vertical" className="gap-1.5">
                <FieldLabel className={SECTION_LABEL_CLASSES}>Your commands</FieldLabel>
                {commands.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {commands.map((command) => {
                      const isActive =
                        active &&
                        activeTrigger !== null &&
                        activeTrigger.toLowerCase() === command.toLowerCase();
                      return (
                        <div
                          key={command}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-sm py-0.5 pr-0.5 pl-2 transition-colors duration-200",
                            isActive ? "bg-foreground/10" : "bg-foreground/5",
                          )}
                        >
                          <span
                            className={cn(
                              "min-w-0 truncate font-mono text-[11px] transition-colors duration-200",
                              isActive ? "text-foreground" : "text-foreground/80",
                            )}
                            style={isActive ? { color: CAFFEINATE_ACCENT_COLOR } : undefined}
                          >
                            {command}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`remove ${command}`}
                            className="hover:text-foreground"
                            onClick={() => removeCommand(command)}
                          >
                            <X />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Add a command to caffeinate while it runs.
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <Input
                    value={draftCommand}
                    onChange={(event) => setDraftCommand(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    placeholder="e.g. ollama"
                    aria-label="add keep-awake command"
                    className="h-7 px-2 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="add command"
                    disabled={draftCommand.trim().length === 0}
                    onClick={addDraftCommand}
                  >
                    <Plus />
                  </Button>
                </div>
              </Field>
            </>
          ) : null}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
};
