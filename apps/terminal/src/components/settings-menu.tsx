import { ChevronDown, ExternalLink, Settings, Trash2, Upload, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import { UpdateBanner } from "@/components/update-banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  CDP_PORT_MAX,
  SESSION_GRACE_MAX_SECONDS,
  SESSION_GRACE_MIN_SECONDS,
  SETTINGS_MODAL_CLOSE_TRANSITION_MS,
  SETTINGS_MODAL_MAX_HEIGHT_CSS,
  TERMINAL_FONT_SIZE_MAX_PX,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STEP_PX,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_LINE_HEIGHT_STEP,
  TERMINAL_PADDING_MAX_PX,
  TERMINAL_PADDING_MIN_PX,
  TERMINAL_PADDING_STEP_PX,
  TOOLTIP_SIDE_OFFSET_PX,
} from "@/lib/constants";
import {
  TERMINAL_CURSOR_STYLES,
  isTerminalCursorStyle,
  type TerminalCursorStyle,
} from "@/lib/terminal-cursor";
import { TERMINAL_FONTS, CUSTOM_FONT_ID, buildCustomTerminalFont } from "@/lib/terminal-fonts";
import { TERMINAL_SCROLLBACK_PRESETS, isTerminalScrollbackValue } from "@/lib/terminal-scrollback";
import { TERMINAL_THEMES, AUTO_THEME_ID, type TerminalTheme } from "@/lib/terminal-themes";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";
import { cn } from "@/lib/utils";

interface SettingsMenuProps {
  themeId: string;
  onThemeChange: (themeId: string) => void;
  onThemePreview?: (themeId: string | null) => void;
  customThemes: TerminalTheme[];
  onImportTheme: (file: File) => Promise<string | null>;
  onDeleteTheme: (id: string) => void;
  fontId: string;
  onFontChange: (fontId: string) => void;
  onFontPreview?: (fontId: string | null) => void;
  customFontFamily: string;
  onCustomFontFamilyChange: (family: string) => void;
  nerdFontEnabled: boolean;
  onNerdFontEnabledChange: (enabled: boolean) => void;
  ligaturesEnabled: boolean;
  onLigaturesEnabledChange: (enabled: boolean) => void;
  muteEmojiColors: boolean;
  onMuteEmojiColorsChange: (muted: boolean) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: number;
  onLineHeightChange: (lineHeight: number) => void;
  paddingX: number;
  onPaddingXChange: (paddingX: number) => void;
  paddingY: number;
  onPaddingYChange: (paddingY: number) => void;
  defaultCwd: string;
  onDefaultCwdChange: (defaultCwd: string) => void;
  defaultShell: string;
  onDefaultShellChange: (defaultShell: string) => void;
  detectedDefaultShell: string;
  mobileResume: boolean;
  onMobileResumeChange: (enabled: boolean) => void;
  cursorStyle: TerminalCursorStyle;
  onCursorStyleChange: (style: TerminalCursorStyle) => void;
  onCursorStylePreview?: (style: TerminalCursorStyle | null) => void;
  cursorBlink: boolean;
  onCursorBlinkChange: (blink: boolean) => void;
  localEcho: boolean;
  onLocalEchoChange: (enabled: boolean) => void;
  scrollback: number;
  onScrollbackChange: (scrollback: number) => void;
  scrollOnUserInput: boolean;
  onScrollOnUserInputChange: (scrollOnUserInput: boolean) => void;
  cdpPort: number | null;
  cdpStatus: { connected: boolean; browser?: string; error?: string } | null;
  cdpConnecting: boolean;
  onCdpPortChange: (port: number | null) => void;
  onCdpConnect: () => void;
  onOpenInspect: () => void;
  graceSeconds: number | null;
  onGraceSecondsChange: (seconds: number | null) => void;
  workspaceRestore: boolean;
  onWorkspaceRestoreChange: (enabled: boolean) => void;
  notificationsPermission: NotificationPermission | "unsupported";
  onNotificationsPermissionRequest: () => void;
  sessionInfo?: TerminalSessionInfo | null;
  updateAvailable: boolean;
  latestVersion: string | null;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

const SECTION_LABEL_CLASSES =
  "text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase";

const ROW_LABEL_CLASSES = "text-xs font-normal text-muted-foreground";

const FONT_ITEM_STYLE_BY_ID: Record<string, CSSProperties> = Object.fromEntries(
  TERMINAL_FONTS.map((font) => [font.id, { fontFamily: font.family }]),
);

const THEME_ITEMS: readonly SettingsSelectItem[] = TERMINAL_THEMES.map((theme) => ({
  id: theme.id,
  label: theme.name,
}));

const BUILTIN_FONT_ITEMS: readonly SettingsSelectItem[] = TERMINAL_FONTS.map((font) => ({
  id: font.id,
  label: font.name,
  itemStyle: FONT_ITEM_STYLE_BY_ID[font.id],
}));

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

const formatLineHeight = (value: number): string => value.toFixed(1);

interface SessionInfoRowProps {
  label: string;
  value: string;
  title?: string;
  valueClassName?: string;
}

const SessionInfoRow = ({ label, value, title, valueClassName }: SessionInfoRowProps) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className={ROW_LABEL_CLASSES}>{label}</dt>
    <dd
      title={title ?? value}
      className={cn("min-w-0 truncate text-right text-foreground/90", valueClassName)}
    >
      {value}
    </dd>
  </div>
);

interface CdpPortFieldProps {
  port: number | null;
  status: { connected: boolean; browser?: string; error?: string } | null;
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

interface GracePeriodFieldProps {
  seconds: number | null;
  onSecondsChange: (seconds: number | null) => void;
}

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

export const SettingsMenu = ({
  themeId,
  onThemeChange,
  onThemePreview,
  customThemes,
  onImportTheme,
  onDeleteTheme,
  fontId,
  onFontChange,
  onFontPreview,
  customFontFamily,
  onCustomFontFamilyChange,
  nerdFontEnabled,
  onNerdFontEnabledChange,
  ligaturesEnabled,
  onLigaturesEnabledChange,
  muteEmojiColors,
  onMuteEmojiColorsChange,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  paddingX,
  onPaddingXChange,
  paddingY,
  onPaddingYChange,
  defaultCwd,
  onDefaultCwdChange,
  defaultShell,
  onDefaultShellChange,
  detectedDefaultShell,
  mobileResume,
  onMobileResumeChange,
  cursorStyle,
  onCursorStyleChange,
  onCursorStylePreview,
  cursorBlink,
  onCursorBlinkChange,
  localEcho,
  onLocalEchoChange,
  scrollback,
  onScrollbackChange,
  scrollOnUserInput,
  onScrollOnUserInputChange,
  cdpPort,
  cdpStatus,
  cdpConnecting,
  onCdpPortChange,
  onCdpConnect,
  onOpenInspect,
  graceSeconds,
  onGraceSecondsChange,
  workspaceRestore,
  onWorkspaceRestoreChange,
  notificationsPermission,
  onNotificationsPermissionRequest,
  sessionInfo,
  updateAvailable,
  latestVersion,
  onOpenChange,
  onClose,
}: SettingsMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [isFontSelectOpen, setIsFontSelectOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The font picker appends a "Custom…" entry whose preview style uses the
  // user-entered family so the dropdown renders the item in that font (when
  // the OS resolves it). A blank custom family previews in the bundled default
  // (what an empty field falls back to) rather than a bare fallback chain.
  const customFont = buildCustomTerminalFont(customFontFamily);
  const fontItems: readonly SettingsSelectItem[] = [
    ...BUILTIN_FONT_ITEMS,
    { id: CUSTOM_FONT_ID, label: "Custom…", itemStyle: { fontFamily: customFont.family } },
  ];

  // Theme picker: the "Auto (system)" entry first (resolves to dark/light from
  // prefers-color-scheme), then the built-ins, then any user-imported custom
  // themes so they appear at the bottom with their original names.
  const themeItems: readonly SettingsSelectItem[] = [
    { id: AUTO_THEME_ID, label: "Auto (system)" },
    ...THEME_ITEMS,
    ...customThemes.map((theme) => ({ id: theme.id, label: theme.name })),
  ];
  const activeCustomTheme = customThemes.find((theme) => theme.id === themeId);

  // The overlay is portalled to document.body so the toolbar's transform
  // (translate-y on hide) can't trap the fixed-position overlay in its stacking
  // context — a fixed overlay rendered inside a transformed ancestor is
  // positioned relative to that ancestor, not the viewport.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      onOpenChange?.(open);
      if (!open) {
        setIsFontSelectOpen(false);
        onThemePreview?.(null);
        onFontPreview?.(null);
        onCursorStylePreview?.(null);
        onClose?.();
      }
    },
    [onOpenChange, onClose, onThemePreview, onFontPreview, onCursorStylePreview],
  );

  // Mount/unmount + open/close animation mirrors the ports/sessions/secrets
  // modals: CSS transitions on data-open/data-closed with a 150ms settle window.
  // The panel is focused on open so the terminal's textarea releases focus
  // before any field is interacted with (xterm otherwise steals keystrokes).
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        panelRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), SETTINGS_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  // Escape closes (mirrors the other palette overlays).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleOpenChange]);

  const handleThemeChange = (next: string | null) => {
    if (next) onThemeChange(next);
  };

  const handleFontChange = (next: string | null) => {
    if (next) onFontChange(next);
  };

  const handleCursorStyleChange = (next: string | null) => {
    if (isTerminalCursorStyle(next)) onCursorStyleChange(next);
  };

  const handleScrollbackChange = (next: string | null) => {
    if (next === null) return;
    const parsed = Number(next);
    if (isTerminalScrollbackValue(parsed)) onScrollbackChange(parsed);
  };

  const handleThemeSelectOpenChange = (open: boolean) => {
    if (!open) onThemePreview?.(null);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be re-selected after an error.
    event.target.value = "";
    if (!file) return;
    const error = await onImportTheme(file);
    setImportError(error);
  };

  const handleFontSelectOpenChange = (open: boolean) => {
    setIsFontSelectOpen(open);
    if (!open) onFontPreview?.(null);
  };

  const handleCursorStyleSelectOpenChange = (open: boolean) => {
    if (!open) onCursorStylePreview?.(null);
  };

  const handleCursorStyleHover = (next: string) => {
    if (isTerminalCursorStyle(next)) onCursorStylePreview?.(next);
  };

  const isVisible = isOpen && settled;
  const cdpDisconnected = cdpStatus !== null && !cdpStatus.connected;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="terminal settings"
        className="relative hover:text-foreground"
        onClick={() => handleOpenChange(!isOpen)}
      >
        <Settings />
        {/* The amber CDP-disconnected dot yields to the sky update dot when both
            apply so the gear shows a single, unambiguous “look here” indicator;            the CDP state is still surfaced inside the panel. */}
        {cdpDisconnected && !updateAvailable && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-400"
          />
        )}
        {updateAvailable && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-sky-400"
          />
        )}
      </Button>
      {mounted
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
              <div
                data-open={isVisible || undefined}
                data-closed={!isVisible || undefined}
                className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
                onClick={() => handleOpenChange(false)}
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-label="settings"
                aria-modal
                tabIndex={-1}
                data-open={isVisible || undefined}
                data-closed={!isVisible || undefined}
                className={cn(
                  "relative z-10 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl outline-none origin-top",
                  MODAL_PANEL_CLASSES,
                  COMMAND_PALETTE_PANEL_CLASSES,
                )}
                style={{ maxHeight: SETTINGS_MODAL_MAX_HEIGHT_CSS }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
                    Settings
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="close"
                    className="hover:text-foreground"
                    onClick={() => handleOpenChange(false)}
                  >
                    <X />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <FieldGroup className="gap-3">
                    {updateAvailable && latestVersion ? (
                      <UpdateBanner latest={latestVersion} />
                    ) : null}
                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Automation browser</FieldLabel>
                      <Tooltip>
                        <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                          Remote debugging port
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                          className="max-w-xs"
                        >
                          Automation run tabs open in the background over the DevTools Protocol.
                          Leave empty to auto-detect a Chromium browser launched with
                          {" --remote-debugging-port"}; set a port to target a specific debug
                          endpoint (e.g. Aside on 52860). Saved to the daemon and used by every tab.
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

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Theme</FieldLabel>
                      <SettingsSelect
                        value={themeId}
                        items={themeItems}
                        ariaLabel="select theme"
                        placeholder="Theme"
                        onValueChange={handleThemeChange}
                        onOpenChange={handleThemeSelectOpenChange}
                        onItemHover={onThemePreview ? (id) => onThemePreview(id) : undefined}
                      />
                      <input
                        ref={importInputRef}
                        type="file"
                        accept=".json,.itermcolors,application/json,text/xml,application/xml"
                        className="hidden"
                        onChange={handleImportFile}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          variant="secondary"
                          size="xs"
                          aria-label="import theme"
                          onClick={() => importInputRef.current?.click()}
                        >
                          <Upload className="size-3" />
                          Import theme…
                        </Button>
                        {activeCustomTheme ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label="delete custom theme"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => onDeleteTheme(activeCustomTheme.id)}
                          >
                            <Trash2 className="size-3" />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                      {importError ? (
                        <span className="min-w-0 text-[10px] leading-tight text-amber-400">
                          {importError}
                        </span>
                      ) : null}
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Font</FieldLabel>
                      <SettingsSelect
                        value={fontId}
                        items={fontItems}
                        ariaLabel="select font"
                        placeholder="Font"
                        open={isFontSelectOpen}
                        onValueChange={handleFontChange}
                        onOpenChange={handleFontSelectOpenChange}
                        onItemHover={onFontPreview ? (id) => onFontPreview(id) : undefined}
                      />
                      {fontId === CUSTOM_FONT_ID ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Custom font family
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            A font family installed on the host — most useful for a system-installed
                            Nerd Font (e.g. “JetBrainsMono Nerd Font Mono”, “MesloLGS NF”) the
                            browser resolves via fontconfig. Leave empty to fall back to the bundled
                            default.
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      {fontId === CUSTOM_FONT_ID ? (
                        <Input
                          value={customFontFamily}
                          placeholder="e.g. JetBrainsMono Nerd Font Mono"
                          aria-label="custom font family"
                          className="h-7 px-2 font-mono text-xs"
                          onChange={(event) => onCustomFontFamilyChange(event.target.value)}
                        />
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <span className={ROW_LABEL_CLASSES}>Size</span>
                        <NumberStepper
                          value={fontSize}
                          min={TERMINAL_FONT_SIZE_MIN_PX}
                          max={TERMINAL_FONT_SIZE_MAX_PX}
                          step={TERMINAL_FONT_SIZE_STEP_PX}
                          ariaLabel="terminal font size"
                          decrementAriaLabel="decrease font size"
                          incrementAriaLabel="increase font size"
                          onValueChange={onFontSizeChange}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={ROW_LABEL_CLASSES}>Line height</span>
                        <NumberStepper
                          value={lineHeight}
                          min={TERMINAL_LINE_HEIGHT_MIN}
                          max={TERMINAL_LINE_HEIGHT_MAX}
                          step={TERMINAL_LINE_HEIGHT_STEP}
                          ariaLabel="terminal line height"
                          decrementAriaLabel="decrease line height"
                          incrementAriaLabel="increase line height"
                          formatDisplay={formatLineHeight}
                          onValueChange={onLineHeightChange}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Nerd Font icons
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            Appends a Symbols Only Nerd Font to the font stack. Icon glyphs (Private
                            Use Area codepoints) are resolved by the symbols font while all other
                            characters render from the primary font above.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle nerd font icons"
                          checked={nerdFontEnabled}
                          onCheckedChange={onNerdFontEnabledChange}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Ligatures
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            Fuses multi-character operators such as {"->"}, {"=>"}, and {"!=="} into
                            single glyphs when the active font defines them (e.g. Fira Code,
                            JetBrains Mono). Joins every run of operator characters so composable
                            arrows like
                            {"-->"} and {"===>"} shape at any length, plus letter pairs (fi, www)
                            and hex/dimension literals (0xFF, 1920x1080) for full Fira Code parity.
                            On fonts without ligatures this is a no-op and characters render exactly
                            as before.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle ligatures"
                          checked={ligaturesEnabled}
                          onCheckedChange={onLigaturesEnabledChange}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Mute emoji colors
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            Tints emoji with the surrounding terminal text color so they are less
                            visually distracting. Turn this off to show their native colors.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle mute emoji colors"
                          checked={muteEmojiColors}
                          onCheckedChange={onMuteEmojiColorsChange}
                        />
                      </div>
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Window</FieldLabel>
                      <div className="flex items-center justify-between gap-2">
                        <span className={ROW_LABEL_CLASSES}>Pad X</span>
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
                        <span className={ROW_LABEL_CLASSES}>Pad Y</span>
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

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Launch</FieldLabel>
                      <Tooltip>
                        <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                          Default directory
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                          className="max-w-xs"
                        >
                          Directory new shells open in when launched without an explicit path — the
                          PWA app icon, a fresh tab before any session connects, or a reloaded bare
                          URL. Leave empty to use your home directory. The live session's directory
                          always takes precedence once a shell is running.
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
                        <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                          Default shell
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                          className="max-w-xs"
                        >
                          Absolute path to the shell binary new tabs spawn. Leave empty to use the
                          daemon's detected login shell (LOCALTERM_SHELL, then your passwd entry,
                          then $SHELL). The `localterm session new --shell` flag and the `?shell=`
                          query param override this per session; an address-bar `?shell=` wins for
                          one tab.
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
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Resume last shell on mobile
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            On phones and tablets, opening localterm attaches to your most recently
                            active shell instead of starting a new one — so you land on the build or
                            agent run you just started on another device. Off restores the original
                            spawn-fresh behavior. An explicit attach (a shared session QR) always
                            wins regardless.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle resume last shell on mobile"
                          checked={mobileResume}
                          onCheckedChange={onMobileResumeChange}
                        />
                      </div>
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Sessions</FieldLabel>
                      <Tooltip>
                        <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                          Grace period
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                          className="max-w-xs"
                        >
                          How long a shell with no viewers stays alive after you close its tab, so a
                          transient disconnect or a tab switch can reattach. A shell still running a
                          command is never reaped regardless. Set to Off to keep dormant shells
                          until you kill them from the switcher (they're still evicted if the
                          session cap is reached). 0 reaps an idle shell the moment its last viewer
                          leaves.
                        </TooltipContent>
                      </Tooltip>
                      <GracePeriodField
                        seconds={graceSeconds}
                        onSecondsChange={onGraceSecondsChange}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Reopen tabs on start
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            On start, reopen the browser tabs you had open last (in the same
                            directories and shells) via the automation browser's CDP connection — a
                            tmux-resurrect-style restore of the workspace layout. The shells
                            themselves don't survive a stop; only the arrangement comes back.
                            Automation-run tabs and shells you'd closed are skipped. Needs a
                            debug-enabled browser so the daemon can drive tab creation.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle reopen tabs on start"
                          checked={workspaceRestore}
                          onCheckedChange={onWorkspaceRestoreChange}
                        />
                      </div>
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Notifications</FieldLabel>
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Desktop alerts
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            When on, OSC 9 sequences from the shell trigger browser notifications.
                            Enable to receive alerts when the tab is in the background. Blocked
                            permissions must be changed in browser settings.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle desktop notifications"
                          checked={notificationsPermission === "granted"}
                          disabled={
                            notificationsPermission === "unsupported" ||
                            notificationsPermission === "denied"
                          }
                          onCheckedChange={(checked) => {
                            if (checked) onNotificationsPermissionRequest();
                          }}
                        />
                      </div>
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Cursor</FieldLabel>
                      <div className="flex items-center justify-between gap-2">
                        <span className={ROW_LABEL_CLASSES}>Style</span>
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
                        <span className={ROW_LABEL_CLASSES}>Blink</span>
                        <Switch
                          aria-label="toggle cursor blink"
                          checked={cursorBlink}
                          onCheckedChange={onCursorBlinkChange}
                        />
                      </div>
                    </Field>

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Typing</FieldLabel>
                      <div className="flex items-center justify-between gap-2">
                        <span className={ROW_LABEL_CLASSES}>Predictive typing</span>
                        <Switch
                          aria-label="toggle predictive typing"
                          checked={localEcho}
                          onCheckedChange={onLocalEchoChange}
                        />
                      </div>
                    </Field>

                    <Separator className="bg-border/40" />

                    <Field orientation="vertical" className="gap-1.5">
                      <FieldLabel className={SECTION_LABEL_CLASSES}>Scrollback</FieldLabel>
                      <SettingsSelect
                        value={String(scrollback)}
                        items={SCROLLBACK_ITEMS}
                        ariaLabel="select scrollback"
                        placeholder="Scrollback"
                        onValueChange={handleScrollbackChange}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<span className={ROW_LABEL_CLASSES} />}>
                            Pin to bottom on input
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
                            className="max-w-xs"
                          >
                            When on, typing scrolls the viewport back to the bottom. When off, the
                            viewport stays where you scrolled — useful for reading history while
                            typing.
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          aria-label="toggle pin to bottom on input"
                          checked={scrollOnUserInput}
                          onCheckedChange={onScrollOnUserInputChange}
                        />
                      </div>
                    </Field>

                    {sessionInfo ? (
                      <>
                        <Separator className="bg-border/40" />
                        <Collapsible defaultOpen={false}>
                          <CollapsibleTrigger
                            render={
                              <button
                                type="button"
                                className="group/shell flex w-full items-center justify-between gap-2 rounded-sm py-1 text-left transition-colors outline-none hover:text-foreground/90 focus-visible:text-foreground/90"
                              >
                                <span className={SECTION_LABEL_CLASSES}>Shell</span>
                                <ChevronDown className="size-3 text-muted-foreground/60 transition-transform duration-200 ease-snappy will-change-transform group-aria-expanded/shell:rotate-180" />
                              </button>
                            }
                          />
                          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-snappy data-closed:h-0">
                            <dl className="flex flex-col gap-1 pt-2 text-xs">
                              <SessionInfoRow label="Name" value={sessionInfo.shellName} />
                              <SessionInfoRow
                                label="Path"
                                value={sessionInfo.shell}
                                title={sessionInfo.shell}
                              />
                              <SessionInfoRow
                                label="PID"
                                value={String(sessionInfo.pid)}
                                valueClassName="tabular-nums"
                              />
                              <SessionInfoRow
                                label="Cwd"
                                value={sessionInfo.cwd}
                                title={sessionInfo.cwd}
                              />
                            </dl>
                          </CollapsibleContent>
                        </Collapsible>
                      </>
                    ) : null}
                  </FieldGroup>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
