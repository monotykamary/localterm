import { Coffee, Plus, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PANEL_ANIMATION_CLASSES, TRANSLUCENT_PANEL_CLASSES } from "@/lib/animation-classes";
import { CAFFEINATE_ACCENT_COLOR, TOOLTIP_SIDE_OFFSET_PX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CaffeinateMode } from "@monotykamary/localterm-server/protocol";

export type { CaffeinateMode };

interface KeepAwakeMenuProps {
  mode: CaffeinateMode;
  active: boolean;
  defaultCommands: readonly string[];
  commands: readonly string[];
  onModeChange: (mode: CaffeinateMode) => void;
  onCommandsChange: (commands: string[]) => void;
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

const MODE_DESCRIPTION: Record<CaffeinateMode, string> = {
  off: "Never keep the system awake.",
  on: "Always keep the system awake.",
  automatic: "Keep awake only while a recognized program is running in localterm.",
};

const isCaffeinateMode = (value: string | null): value is CaffeinateMode =>
  value === "off" || value === "on" || value === "automatic";

const CHIP_CLASSES =
  "inline-flex items-center rounded-full border border-border/60 bg-foreground/5 px-2 py-0.5 font-mono text-[11px] text-foreground/80";

export const KeepAwakeMenu = ({
  mode,
  active,
  defaultCommands,
  commands,
  onModeChange,
  onCommandsChange,
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
              <span className="translate-y-[0.5px]">A</span>
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={TOOLTIP_SIDE_OFFSET_PX}
        className={cn(
          "w-64 gap-0 overflow-hidden p-3",
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

          {mode === "automatic" ? (
            <>
              <Separator className="bg-border/40" />
              <Field orientation="vertical" className="gap-1.5">
                <FieldLabel className={SECTION_LABEL_CLASSES}>Detected automatically</FieldLabel>
                <div className="flex flex-wrap gap-1">
                  {defaultCommands.map((command) => (
                    <span key={command} className={CHIP_CLASSES}>
                      {command}
                    </span>
                  ))}
                </div>
              </Field>

              <Separator className="bg-border/40" />
              <Field orientation="vertical" className="gap-1.5">
                <FieldLabel className={SECTION_LABEL_CLASSES}>Your commands</FieldLabel>
                {commands.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {commands.map((command) => (
                      <div
                        key={command}
                        className="flex items-center justify-between gap-2 rounded-sm bg-foreground/5 py-0.5 pr-0.5 pl-2"
                      >
                        <span className="min-w-0 truncate font-mono text-[11px] text-foreground/80">
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
                    ))}
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
