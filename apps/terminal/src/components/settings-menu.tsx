import { Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { FontSettingsSection } from "@/components/font-settings-section";
import {
  AutomationBrowserSettingsSection,
  CursorSettingsSection,
  LaunchSettingsSection,
  NotificationsSettingsSection,
  ScrollbackSettingsSection,
  SessionsSettingsSection,
  ShellSettingsSection,
  TypingSettingsSection,
  WindowSettingsSection,
  type SettingsCdpStatus,
} from "@/components/settings-sections";
import { ThemeSettingsSection } from "@/components/theme-settings-section";
import { UpdateBanner } from "@/components/update-banner";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { SETTINGS_MODAL_CLOSE_TRANSITION_MS, SETTINGS_MODAL_MAX_HEIGHT_CSS } from "@/lib/constants";
import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import type { TerminalTheme } from "@/lib/terminal-themes";
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
  cdpStatus: SettingsCdpStatus | null;
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

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be re-selected after an error.
    event.target.value = "";
    if (!file) return;
    const error = await onImportTheme(file);
    setImportError(error);
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
                    <AutomationBrowserSettingsSection
                      cdpPort={cdpPort}
                      cdpStatus={cdpStatus}
                      cdpConnecting={cdpConnecting}
                      onCdpPortChange={onCdpPortChange}
                      onCdpConnect={onCdpConnect}
                      onOpenInspect={onOpenInspect}
                    />

                    <Separator className="bg-border/40" />

                    <ThemeSettingsSection
                      themeId={themeId}
                      onThemeChange={onThemeChange}
                      onThemePreview={onThemePreview}
                      customThemes={customThemes}
                      onDeleteTheme={onDeleteTheme}
                      importError={importError}
                      importInputRef={importInputRef}
                      onImportFile={handleImportFile}
                    />

                    <Separator className="bg-border/40" />

                    <FontSettingsSection
                      fontId={fontId}
                      onFontChange={onFontChange}
                      onFontPreview={onFontPreview}
                      customFontFamily={customFontFamily}
                      onCustomFontFamilyChange={onCustomFontFamilyChange}
                      nerdFontEnabled={nerdFontEnabled}
                      onNerdFontEnabledChange={onNerdFontEnabledChange}
                      ligaturesEnabled={ligaturesEnabled}
                      onLigaturesEnabledChange={onLigaturesEnabledChange}
                      muteEmojiColors={muteEmojiColors}
                      onMuteEmojiColorsChange={onMuteEmojiColorsChange}
                      fontSize={fontSize}
                      onFontSizeChange={onFontSizeChange}
                      lineHeight={lineHeight}
                      onLineHeightChange={onLineHeightChange}
                      isSelectOpen={isFontSelectOpen}
                      onSelectOpenChange={setIsFontSelectOpen}
                    />

                    <Separator className="bg-border/40" />

                    <WindowSettingsSection
                      paddingX={paddingX}
                      onPaddingXChange={onPaddingXChange}
                      paddingY={paddingY}
                      onPaddingYChange={onPaddingYChange}
                    />

                    <Separator className="bg-border/40" />

                    <LaunchSettingsSection
                      defaultCwd={defaultCwd}
                      onDefaultCwdChange={onDefaultCwdChange}
                      defaultShell={defaultShell}
                      onDefaultShellChange={onDefaultShellChange}
                      detectedDefaultShell={detectedDefaultShell}
                      mobileResume={mobileResume}
                      onMobileResumeChange={onMobileResumeChange}
                    />

                    <Separator className="bg-border/40" />

                    <SessionsSettingsSection
                      graceSeconds={graceSeconds}
                      onGraceSecondsChange={onGraceSecondsChange}
                      workspaceRestore={workspaceRestore}
                      onWorkspaceRestoreChange={onWorkspaceRestoreChange}
                    />

                    <Separator className="bg-border/40" />

                    <NotificationsSettingsSection
                      notificationsPermission={notificationsPermission}
                      onNotificationsPermissionRequest={onNotificationsPermissionRequest}
                    />

                    <Separator className="bg-border/40" />

                    <CursorSettingsSection
                      cursorStyle={cursorStyle}
                      onCursorStyleChange={onCursorStyleChange}
                      onCursorStylePreview={onCursorStylePreview}
                      cursorBlink={cursorBlink}
                      onCursorBlinkChange={onCursorBlinkChange}
                    />

                    <TypingSettingsSection
                      localEcho={localEcho}
                      onLocalEchoChange={onLocalEchoChange}
                    />

                    <Separator className="bg-border/40" />

                    <ScrollbackSettingsSection
                      scrollback={scrollback}
                      onScrollbackChange={onScrollbackChange}
                      scrollOnUserInput={scrollOnUserInput}
                      onScrollOnUserInputChange={onScrollOnUserInputChange}
                    />

                    {sessionInfo ? (
                      <>
                        <Separator className="bg-border/40" />
                        <ShellSettingsSection sessionInfo={sessionInfo} />
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
