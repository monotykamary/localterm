import { RotateCcw, Settings, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { NumberStepper } from "@/components/number-stepper";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
  KEYBOARD_HEIGHT_SCALE_MIN_PERCENT,
  KEYBOARD_HEIGHT_SCALE_STEP_PERCENT,
  TERMINAL_FONT_SIZE_MAX_PX,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STEP_PX,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_LINE_HEIGHT_STEP,
} from "@/lib/constants";
import { MODAL_PANEL_CLASSES } from "@/lib/animation-classes";
import { cn } from "@/lib/utils";

interface KeyboardSettingsModalProps {
  readonly heightScalePercent: number;
  readonly terminalFontSize: number;
  readonly terminalLineHeight: number;
  readonly hapticsEnabled: boolean;
  readonly keyPreviewEnabled: boolean;
  readonly keyRepeatEnabled: boolean;
  readonly onHeightScaleChange: (heightScalePercent: number) => void;
  readonly onTerminalFontSizeChange: (fontSize: number) => void;
  readonly onTerminalLineHeightChange: (lineHeight: number) => void;
  readonly onHapticsEnabledChange: (enabled: boolean) => void;
  readonly onKeyPreviewEnabledChange: (enabled: boolean) => void;
  readonly onKeyRepeatEnabledChange: (enabled: boolean) => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}

const formatHeightScale = (heightScalePercent: number): string => `${heightScalePercent}%`;
const formatLineHeight = (lineHeight: number): string => lineHeight.toFixed(1);

export const KeyboardSettingsModal = ({
  heightScalePercent,
  terminalFontSize,
  terminalLineHeight,
  hapticsEnabled,
  keyPreviewEnabled,
  keyRepeatEnabled,
  onHeightScaleChange,
  onTerminalFontSizeChange,
  onTerminalLineHeightChange,
  onHapticsEnabledChange,
  onKeyPreviewEnabledChange,
  onKeyRepeatEnabledChange,
  onReset,
  onClose,
}: KeyboardSettingsModalProps) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      data-on-screen-keyboard-settings
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-xs animate-in fade-in-0 duration-150 ease-snappy"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="keyboard settings"
        aria-modal
        className={cn(
          "relative z-10 w-full max-w-sm overflow-hidden rounded-xl outline-none animate-in fade-in-0 zoom-in-95 duration-150 ease-snappy",
          MODAL_PANEL_CLASSES,
        )}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
            Keyboard settings
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon-sm"
            aria-label="close keyboard settings"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="space-y-3 p-4 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>Keyboard height</span>
            <NumberStepper
              value={heightScalePercent}
              min={KEYBOARD_HEIGHT_SCALE_MIN_PERCENT}
              max={KEYBOARD_HEIGHT_SCALE_MAX_PERCENT}
              step={KEYBOARD_HEIGHT_SCALE_STEP_PERCENT}
              ariaLabel="keyboard height"
              decrementAriaLabel="decrease keyboard height"
              incrementAriaLabel="increase keyboard height"
              formatDisplay={formatHeightScale}
              onValueChange={onHeightScaleChange}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Terminal font size</span>
            <NumberStepper
              value={terminalFontSize}
              min={TERMINAL_FONT_SIZE_MIN_PX}
              max={TERMINAL_FONT_SIZE_MAX_PX}
              step={TERMINAL_FONT_SIZE_STEP_PX}
              ariaLabel="terminal font size"
              decrementAriaLabel="decrease terminal font size"
              incrementAriaLabel="increase terminal font size"
              onValueChange={onTerminalFontSizeChange}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Terminal line spacing</span>
            <NumberStepper
              value={terminalLineHeight}
              min={TERMINAL_LINE_HEIGHT_MIN}
              max={TERMINAL_LINE_HEIGHT_MAX}
              step={TERMINAL_LINE_HEIGHT_STEP}
              ariaLabel="terminal line spacing"
              decrementAriaLabel="decrease terminal line spacing"
              incrementAriaLabel="increase terminal line spacing"
              formatDisplay={formatLineHeight}
              onValueChange={onTerminalLineHeightChange}
            />
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Smaller type keeps more columns; extra line spacing keeps rows readable.
          </p>
          <div className="flex items-center justify-between gap-3">
            <span>Haptic feedback</span>
            <Switch
              aria-label="toggle keyboard haptic feedback"
              checked={hapticsEnabled}
              onCheckedChange={onHapticsEnabledChange}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Key previews</span>
            <Switch
              aria-label="toggle keyboard key previews"
              checked={keyPreviewEnabled}
              onCheckedChange={onKeyPreviewEnabledChange}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Key repeat</span>
            <Switch
              aria-label="toggle keyboard key repeat"
              checked={keyRepeatEnabled}
              onCheckedChange={onKeyRepeatEnabledChange}
            />
          </div>
        </div>
        <div className="flex justify-end border-t border-border/40 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw />
            Reset defaults
          </Button>
        </div>
      </div>
    </div>
  );
};
