import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import {
  SETTINGS_ROW_LABEL_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
} from "@/components/settings-section-styles";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CDP_PORT_MAX,
  SESSION_GRACE_MAX_SECONDS,
  SESSION_GRACE_MIN_SECONDS,
  TERMINAL_PADDING_MAX_PX,
  TERMINAL_PADDING_MIN_PX,
  TERMINAL_PADDING_STEP_PX,
  TOOLTIP_SIDE_OFFSET_PX,
} from "@/lib/constants";
import {
  isTerminalCursorStyle,
  TERMINAL_CURSOR_STYLES,
  type TerminalCursorStyle,
} from "@/lib/terminal-cursor";
import { isTerminalScrollbackValue, TERMINAL_SCROLLBACK_PRESETS } from "@/lib/terminal-scrollback";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";
import { cn } from "@/lib/utils";

export interface SettingsCdpStatus {
  connected: boolean;
  browser?: string;
  error?: string;
}

export interface AutomationBrowserSettingsSectionProps {
  cdpPort: number | null;
  cdpStatus: SettingsCdpStatus | null;
  cdpConnecting: boolean;
  onCdpPortChange: (port: number | null) => void;
  onCdpConnect: () => void;
  onOpenInspect: () => void;
}

export interface WindowSettingsSectionProps {
  paddingX: number;
  onPaddingXChange: (paddingX: number) => void;
  paddingY: number;
  onPaddingYChange: (paddingY: number) => void;
}

export interface LaunchSettingsSectionProps {
  defaultCwd: string;
  onDefaultCwdChange: (defaultCwd: string) => void;
  defaultShell: string;
  onDefaultShellChange: (defaultShell: string) => void;
  detectedDefaultShell: string;
  mobileResume: boolean;
  onMobileResumeChange: (enabled: boolean) => void;
}

export interface SessionsSettingsSectionProps {
  graceSeconds: number | null;
  onGraceSecondsChange: (seconds: number | null) => void;
  workspaceRestore: boolean;
  onWorkspaceRestoreChange: (enabled: boolean) => void;
}

export interface NotificationsSettingsSectionProps {
  notificationsPermission: NotificationPermission | "unsupported";
  onNotificationsPermissionRequest: () => void;
}

export interface CursorSettingsSectionProps {
  cursorStyle: TerminalCursorStyle;
  onCursorStyleChange: (style: TerminalCursorStyle) => void;
  onCursorStylePreview?: (style: TerminalCursorStyle | null) => void;
  cursorBlink: boolean;
  onCursorBlinkChange: (blink: boolean) => void;
}

export interface TypingSettingsSectionProps {
  localEcho: boolean;
  onLocalEchoChange: (enabled: boolean) => void;
}

export interface ScrollbackSettingsSectionProps {
  scrollback: number;
  onScrollbackChange: (scrollback: number) => void;
  scrollOnUserInput: boolean;
  onScrollOnUserInputChange: (scrollOnUserInput: boolean) => void;
}

export interface ShellSettingsSectionProps {
  sessionInfo: TerminalSessionInfo;
}

interface SessionInfoRowProps {
  label: string;
  value: string;
  title?: string;
  valueClassName?: string;
}

interface CdpPortFieldProps {
  port: number | null;
  status: SettingsCdpStatus | null;
  connecting: boolean;
  onPortChange: (port: number | null) => void;
  onConnect: () => void;
  onOpenInspect: () => void;
}

// A daemon-global numeric value edited through /api/config (not a localStorage
// terminal pref), so the field keeps a local text buffer and commits on
// blur/Enter — avoiding a PUT per keystroke and letting an invalid edit roll
// back to the last confirmed value. An empty field commits `null` (the sentinel
// each reusing field defines: "auto-detect" for CDP, "Off" for grace).
interface ConfigNumberFieldProps {
  value: number | null;
  min: number;
  max: number;
  placeholder: string;
  ariaLabel: string;
  onCommit: (value: number | null) => void;
}

interface GracePeriodFieldProps {
  seconds: number | null;
  onSecondsChange: (seconds: number | null) => void;
}

const CURSOR_STYLE_ITEMS: readonly SettingsSelectItem[] = TERMINAL_CURSOR_STYLES.map((option) => ({
  id: option.id,
  label: option.name,
}));

const SCROLLBACK_ITEMS: readonly SettingsSelectItem[] = TERMINAL_SCROLLBACK_PRESETS.map(
  (preset) => ({
    id: String(preset.value),
    label: preset.label,
  }),
);

const SessionInfoRow = ({ label, value, title, valueClassName }: SessionInfoRowProps) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className={SETTINGS_ROW_LABEL_CLASSES}>{label}</dt>
    <dd
      title={title ?? value}
      className={cn("min-w-0 truncate text-right text-foreground/90", valueClassName)}
    >
      {value}
    </dd>
  </div>
);

const ConfigNumberField = ({
  value,
  min,
  max,
  placeholder,
  ariaLabel,
  onCommit,
}: ConfigNumberFieldProps) => {
  const [buffer, setBuffer] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setBuffer(value === null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = buffer.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= min && parsed <= max) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setBuffer(value === null ? "" : String(value));
    }
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={buffer}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-7 px-2 font-mono text-xs"
      onChange={(event) => setBuffer(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
};

// The CDP port field pairs the numeric input with a live connection status and
// an explicit Connect button (POST /api/cdp/connect) so a failure surfaces a
// reason instead of silently staying "Not connected".
const CdpPortField = ({
  port,
  status,
  connecting,
  onPortChange,
  onConnect,
  onOpenInspect,
}: CdpPortFieldProps) => {
  const connected = status?.connected === true;
  const statusText = connected
    ? `Connected — ${status?.browser ?? "debug-enabled browser"}`
    : status?.error
      ? `Not connected — ${status.error}`
      : "Not connected — launch a Chromium browser with remote debugging on.";

  return (
    <div className="flex flex-col gap-1.5">
      <ConfigNumberField
        value={port}
        min={1}
        max={CDP_PORT_MAX}
        placeholder="Auto-detect"
        ariaLabel="CDP remote debugging port"
        onCommit={onPortChange}
      />
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 text-[10px] leading-tight",
            connected ? "text-muted-foreground/60" : "text-amber-400",
          )}
          title={statusText}
        >
          {statusText}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="secondary"
                  size="xs"
                  aria-label="open chrome://inspect"
                  onClick={onOpenInspect}
                />
              }
            >
              <ExternalLink className="size-3" />
              Inspect
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
              Open chrome://inspect to toggle “Discover network targets” and enable remote debugging
              in your browser.
            </TooltipContent>
          </Tooltip>
          <Button
            variant="secondary"
            size="xs"
            aria-label="connect to CDP endpoint"
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
    </div>
  );
};

const GracePeriodField = ({ seconds, onSecondsChange }: GracePeriodFieldProps) => (
  <div className="flex flex-col gap-1.5">
    <ConfigNumberField
      value={seconds}
      min={SESSION_GRACE_MIN_SECONDS}
      max={SESSION_GRACE_MAX_SECONDS}
      placeholder="Off"
      ariaLabel="grace period in seconds"
      onCommit={onSecondsChange}
    />
    <span className="min-w-0 truncate text-[10px] text-muted-foreground/60">
      {seconds === null
        ? "Off — dormant shells linger until killed from the switcher"
        : `${seconds}s after the last viewer leaves`}
    </span>
  </div>
);

export const AutomationBrowserSettingsSection = ({
  cdpPort,
  cdpStatus,
  cdpConnecting,
  onCdpPortChange,
  onCdpConnect,
  onOpenInspect,
}: AutomationBrowserSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Automation browser</FieldLabel>
    <Tooltip>
      <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
        Remote debugging port
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
        Automation run tabs open in the background over the DevTools Protocol. Leave empty to
        auto-detect a Chromium browser launched with
        {" --remote-debugging-port"}; set a port to target a specific debug endpoint (e.g. Aside on
        52860). Saved to the daemon and used by every tab.
      </TooltipContent>
    </Tooltip>
    <CdpPortField
      port={cdpPort}
      status={cdpStatus}
      connecting={cdpConnecting}
      onPortChange={onCdpPortChange}
      onConnect={onCdpConnect}
      onOpenInspect={onOpenInspect}
    />
  </Field>
);

export const WindowSettingsSection = ({
  paddingX,
  onPaddingXChange,
  paddingY,
  onPaddingYChange,
}: WindowSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Window</FieldLabel>
    <div className="flex items-center justify-between gap-2">
      <span className={SETTINGS_ROW_LABEL_CLASSES}>Pad X</span>
      <NumberStepper
        value={paddingX}
        min={TERMINAL_PADDING_MIN_PX}
        max={TERMINAL_PADDING_MAX_PX}
        step={TERMINAL_PADDING_STEP_PX}
        ariaLabel="terminal horizontal padding"
        decrementAriaLabel="decrease horizontal padding"
        incrementAriaLabel="increase horizontal padding"
        onValueChange={onPaddingXChange}
      />
    </div>
    <div className="flex items-center justify-between gap-2">
      <span className={SETTINGS_ROW_LABEL_CLASSES}>Pad Y</span>
      <NumberStepper
        value={paddingY}
        min={TERMINAL_PADDING_MIN_PX}
        max={TERMINAL_PADDING_MAX_PX}
        step={TERMINAL_PADDING_STEP_PX}
        ariaLabel="terminal vertical padding"
        decrementAriaLabel="decrease vertical padding"
        incrementAriaLabel="increase vertical padding"
        onValueChange={onPaddingYChange}
      />
    </div>
  </Field>
);

export const LaunchSettingsSection = ({
  defaultCwd,
  onDefaultCwdChange,
  defaultShell,
  onDefaultShellChange,
  detectedDefaultShell,
  mobileResume,
  onMobileResumeChange,
}: LaunchSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Launch</FieldLabel>
    <Tooltip>
      <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
        Default directory
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
        Directory new shells open in when launched without an explicit path — the PWA app icon, a
        fresh tab before any session connects, or a reloaded bare URL. Leave empty to use your home
        directory. The live session's directory always takes precedence once a shell is running.
      </TooltipContent>
    </Tooltip>
    <Input
      value={defaultCwd}
      placeholder="Home directory"
      aria-label="default launch directory"
      className="h-7 px-2 font-mono text-xs"
      onChange={(event) => onDefaultCwdChange(event.target.value)}
    />
    <Tooltip>
      <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
        Default shell
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
        Absolute path to the shell binary new tabs spawn. Leave empty to use the daemon's detected
        login shell (LOCALTERM_SHELL, then your passwd entry, then $SHELL). The `localterm session
        new --shell` flag and the `?shell=` query param override this per session; an address-bar
        `?shell=` wins for one tab.
      </TooltipContent>
    </Tooltip>
    <Input
      value={defaultShell}
      placeholder={
        detectedDefaultShell
          ? `Auto — detected ${detectedDefaultShell}`
          : "Auto — detected login shell"
      }
      aria-label="default shell"
      className="h-7 px-2 font-mono text-xs"
      onChange={(event) => onDefaultShellChange(event.target.value)}
    />
    <div className="flex items-center justify-between gap-2">
      <Tooltip>
        <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
          Resume last shell on mobile
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
          On phones and tablets, opening localterm attaches to your most recently active shell
          instead of starting a new one — so you land on the build or agent run you just started on
          another device. Off restores the original spawn-fresh behavior. An explicit attach (a
          shared session QR) always wins regardless.
        </TooltipContent>
      </Tooltip>
      <Switch
        aria-label="toggle resume last shell on mobile"
        checked={mobileResume}
        onCheckedChange={onMobileResumeChange}
      />
    </div>
  </Field>
);

export const SessionsSettingsSection = ({
  graceSeconds,
  onGraceSecondsChange,
  workspaceRestore,
  onWorkspaceRestoreChange,
}: SessionsSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Sessions</FieldLabel>
    <Tooltip>
      <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
        Grace period
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
        How long a shell with no viewers stays alive after you close its tab, so a transient
        disconnect or a tab switch can reattach. A shell still running a command is never reaped
        regardless. Set to Off to keep dormant shells until you kill them from the switcher (they're
        still evicted if the session cap is reached). 0 reaps an idle shell the moment its last
        viewer leaves.
      </TooltipContent>
    </Tooltip>
    <GracePeriodField seconds={graceSeconds} onSecondsChange={onGraceSecondsChange} />
    <div className="flex items-center justify-between gap-2">
      <Tooltip>
        <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
          Reopen tabs on start
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
          On start, reopen the browser tabs you had open last (in the same directories and shells)
          via the automation browser's CDP connection — a tmux-resurrect-style restore of the
          workspace layout. The shells themselves don't survive a stop; only the arrangement comes
          back. Automation-run tabs and shells you'd closed are skipped. Needs a debug-enabled
          browser so the daemon can drive tab creation.
        </TooltipContent>
      </Tooltip>
      <Switch
        aria-label="toggle reopen tabs on start"
        checked={workspaceRestore}
        onCheckedChange={onWorkspaceRestoreChange}
      />
    </div>
  </Field>
);

export const NotificationsSettingsSection = ({
  notificationsPermission,
  onNotificationsPermissionRequest,
}: NotificationsSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Notifications</FieldLabel>
    <div className="flex items-center justify-between gap-2">
      <Tooltip>
        <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
          Desktop alerts
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
          When on, OSC 9 sequences from the shell trigger browser notifications. Enable to receive
          alerts when the tab is in the background. Blocked permissions must be changed in browser
          settings.
        </TooltipContent>
      </Tooltip>
      <Switch
        aria-label="toggle desktop notifications"
        checked={notificationsPermission === "granted"}
        disabled={notificationsPermission === "unsupported" || notificationsPermission === "denied"}
        onCheckedChange={(checked) => {
          if (checked) onNotificationsPermissionRequest();
        }}
      />
    </div>
  </Field>
);

export const CursorSettingsSection = ({
  cursorStyle,
  onCursorStyleChange,
  onCursorStylePreview,
  cursorBlink,
  onCursorBlinkChange,
}: CursorSettingsSectionProps) => {
  const handleCursorStyleChange = (nextCursorStyle: string | null) => {
    if (isTerminalCursorStyle(nextCursorStyle)) onCursorStyleChange(nextCursorStyle);
  };

  const handleCursorStyleSelectOpenChange = (open: boolean) => {
    if (!open) onCursorStylePreview?.(null);
  };

  const handleCursorStyleHover = (nextCursorStyle: string) => {
    if (isTerminalCursorStyle(nextCursorStyle)) onCursorStylePreview?.(nextCursorStyle);
  };

  return (
    <Field orientation="vertical" className="gap-1.5">
      <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Cursor</FieldLabel>
      <div className="flex items-center justify-between gap-2">
        <span className={SETTINGS_ROW_LABEL_CLASSES}>Style</span>
        <SettingsSelect
          value={cursorStyle}
          items={CURSOR_STYLE_ITEMS}
          ariaLabel="select cursor style"
          placeholder="Cursor style"
          triggerClassName="w-fit min-w-[7rem]"
          onValueChange={handleCursorStyleChange}
          onOpenChange={handleCursorStyleSelectOpenChange}
          onItemHover={onCursorStylePreview ? handleCursorStyleHover : undefined}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={SETTINGS_ROW_LABEL_CLASSES}>Blink</span>
        <Switch
          aria-label="toggle cursor blink"
          checked={cursorBlink}
          onCheckedChange={onCursorBlinkChange}
        />
      </div>
    </Field>
  );
};

export const TypingSettingsSection = ({
  localEcho,
  onLocalEchoChange,
}: TypingSettingsSectionProps) => (
  <Field orientation="vertical" className="gap-1.5">
    <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Typing</FieldLabel>
    <div className="flex items-center justify-between gap-2">
      <span className={SETTINGS_ROW_LABEL_CLASSES}>Predictive typing</span>
      <Switch
        aria-label="toggle predictive typing"
        checked={localEcho}
        onCheckedChange={onLocalEchoChange}
      />
    </div>
  </Field>
);

export const ScrollbackSettingsSection = ({
  scrollback,
  onScrollbackChange,
  scrollOnUserInput,
  onScrollOnUserInputChange,
}: ScrollbackSettingsSectionProps) => {
  const handleScrollbackChange = (nextScrollback: string | null) => {
    if (nextScrollback === null) return;
    const parsedScrollback = Number(nextScrollback);
    if (isTerminalScrollbackValue(parsedScrollback)) onScrollbackChange(parsedScrollback);
  };

  return (
    <Field orientation="vertical" className="gap-1.5">
      <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Scrollback</FieldLabel>
      <SettingsSelect
        value={String(scrollback)}
        items={SCROLLBACK_ITEMS}
        ariaLabel="select scrollback"
        placeholder="Scrollback"
        onValueChange={handleScrollbackChange}
      />
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
            Pin to bottom on input
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={TOOLTIP_SIDE_OFFSET_PX} className="max-w-xs">
            When on, typing scrolls the viewport back to the bottom. When off, the viewport stays
            where you scrolled — useful for reading history while typing.
          </TooltipContent>
        </Tooltip>
        <Switch
          aria-label="toggle pin to bottom on input"
          checked={scrollOnUserInput}
          onCheckedChange={onScrollOnUserInputChange}
        />
      </div>
    </Field>
  );
};

export const ShellSettingsSection = ({ sessionInfo }: ShellSettingsSectionProps) => (
  <Collapsible defaultOpen={false}>
    <CollapsibleTrigger
      render={
        <button
          type="button"
          className="group/shell flex w-full items-center justify-between gap-2 rounded-sm py-1 text-left transition-colors outline-none hover:text-foreground/90 focus-visible:text-foreground/90"
        >
          <span className={SETTINGS_SECTION_LABEL_CLASSES}>Shell</span>
          <ChevronDown className="size-3 text-muted-foreground/60 transition-transform duration-200 ease-snappy will-change-transform group-aria-expanded/shell:rotate-180" />
        </button>
      }
    />
    <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-snappy data-closed:h-0">
      <dl className="flex flex-col gap-1 pt-2 text-xs">
        <SessionInfoRow label="Name" value={sessionInfo.shellName} />
        <SessionInfoRow label="Path" value={sessionInfo.shell} title={sessionInfo.shell} />
        <SessionInfoRow label="PID" value={String(sessionInfo.pid)} valueClassName="tabular-nums" />
        <SessionInfoRow label="Cwd" value={sessionInfo.cwd} title={sessionInfo.cwd} />
      </dl>
    </CollapsibleContent>
  </Collapsible>
);
