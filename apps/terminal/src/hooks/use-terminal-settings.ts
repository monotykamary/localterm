import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import type { LocalEcho } from "@/lib/local-echo";
import { useTerminalFontSettings } from "@/hooks/use-terminal-font-settings";
import { useTerminalThemeSettings } from "@/hooks/use-terminal-theme-settings";
import { useTerminalXtermSettingsEffects } from "@/hooks/use-terminal-xterm-settings-effects";
import { clampTerminalPaddingX, clampTerminalPaddingY } from "@/utils/clamp-terminal-padding";
import {
  loadStoredDefaultCwd,
  storeDefaultCwd,
  subscribeStoredDefaultCwd,
} from "@/utils/stored-default-cwd";
import {
  loadStoredDefaultShell,
  storeDefaultShell,
  subscribeStoredDefaultShell,
} from "@/utils/stored-default-shell";
import { subscribeStoredLigaturesEnabled } from "@/utils/stored-ligatures-enabled";
import { subscribeStoredMuteEmojiColors } from "@/utils/stored-mute-emoji-colors";
import {
  loadStoredLocalEcho,
  storeStoredLocalEcho,
  subscribeStoredLocalEcho,
} from "@/utils/stored-local-echo-enabled";
import {
  loadStoredMobileResume,
  storeMobileResume,
  subscribeStoredMobileResume,
} from "@/utils/stored-mobile-resume";
import { subscribeStoredNerdFontEnabled } from "@/utils/stored-nerd-font-enabled";
import {
  loadStoredTerminalCursorBlink,
  storeTerminalCursorBlink,
  subscribeStoredTerminalCursorBlink,
} from "@/utils/stored-terminal-cursor-blink";
import {
  loadStoredTerminalCursorStyle,
  storeTerminalCursorStyle,
  subscribeStoredTerminalCursorStyle,
} from "@/utils/stored-terminal-cursor-style";
import { subscribeStoredTerminalFontId } from "@/utils/stored-terminal-font-id";
import { subscribeStoredCustomFontFamily } from "@/utils/stored-custom-font-family";
import { subscribeStoredTerminalFontSize } from "@/utils/stored-terminal-font-size";
import { subscribeStoredTerminalLineHeight } from "@/utils/stored-terminal-line-height";
import {
  loadStoredTerminalPaddingX,
  storeTerminalPaddingX,
  subscribeStoredTerminalPaddingX,
} from "@/utils/stored-terminal-padding-x";
import {
  loadStoredTerminalPaddingY,
  storeTerminalPaddingY,
  subscribeStoredTerminalPaddingY,
} from "@/utils/stored-terminal-padding-y";
import {
  loadStoredTerminalScrollOnUserInput,
  storeTerminalScrollOnUserInput,
  subscribeStoredTerminalScrollOnUserInput,
} from "@/utils/stored-terminal-scroll-on-user-input";
import {
  loadStoredTerminalScrollback,
  storeTerminalScrollback,
  subscribeStoredTerminalScrollback,
} from "@/utils/stored-terminal-scrollback";
import { subscribeStoredTerminalThemeId } from "@/utils/stored-terminal-theme-id";
import { subscribeStoredCustomThemes } from "@/utils/stored-custom-themes";

interface UseTerminalSettingsParams {
  terminalRef: { readonly current: XtermTerminal | null };
  fitAddonRef: { readonly current: FitAddon | null };
  webglAddonRef: { readonly current: WebglAddon | null };
  terminalReady: boolean;
  localEchoRef: { readonly current: LocalEcho | null };
}

// All terminal appearance/behavior settings — theme, font, cursor, scrollback,
// padding, predictive typing, default cwd — plus their xterm apply-effects and
// the cross-tab `storage` subscription that keeps every open tab in lockstep.
// The initial-value refs are returned because the connection hook reads them
// once when it constructs the xterm instance; everything else is consumed by
// the settings menu and the command palette.
export const useTerminalSettings = ({
  terminalRef,
  fitAddonRef,
  webglAddonRef,
  terminalReady,
  localEchoRef,
}: UseTerminalSettingsParams) => {
  const themeSettings = useTerminalThemeSettings();
  const fontSettings = useTerminalFontSettings();
  const initialCursorStyleRef = useRef<TerminalCursorStyle>(loadStoredTerminalCursorStyle());
  const initialCursorBlinkRef = useRef<boolean>(loadStoredTerminalCursorBlink());
  const initialLocalEchoRef = useRef<boolean>(loadStoredLocalEcho());
  const activeLocalEchoRef = useRef<boolean>(initialLocalEchoRef.current);
  const initialMobileResumeRef = useRef<boolean>(loadStoredMobileResume());
  const initialScrollbackRef = useRef<number>(loadStoredTerminalScrollback());
  const initialScrollOnUserInputRef = useRef<boolean>(loadStoredTerminalScrollOnUserInput());
  const initialPaddingXRef = useRef<number>(loadStoredTerminalPaddingX());
  const initialPaddingYRef = useRef<number>(loadStoredTerminalPaddingY());
  const initialDefaultCwdRef = useRef<string>(loadStoredDefaultCwd());
  const initialDefaultShellRef = useRef<string>(loadStoredDefaultShell());
  const [activeCursorStyle, setActiveCursorStyle] = useState<TerminalCursorStyle>(
    initialCursorStyleRef.current,
  );
  const [previewCursorStyle, setPreviewCursorStyle] = useState<TerminalCursorStyle | null>(null);
  const effectiveCursorStyle = previewCursorStyle ?? activeCursorStyle;
  const [activeCursorBlink, setActiveCursorBlink] = useState<boolean>(
    initialCursorBlinkRef.current,
  );
  const [activeLocalEcho, setActiveLocalEcho] = useState<boolean>(initialLocalEchoRef.current);
  const [activeMobileResume, setActiveMobileResume] = useState<boolean>(
    initialMobileResumeRef.current,
  );
  const [activeScrollback, setActiveScrollback] = useState<number>(initialScrollbackRef.current);
  const [activeScrollOnUserInput, setActiveScrollOnUserInput] = useState<boolean>(
    initialScrollOnUserInputRef.current,
  );
  const [activePaddingX, setActivePaddingX] = useState<number>(initialPaddingXRef.current);
  const [activePaddingY, setActivePaddingY] = useState<number>(initialPaddingYRef.current);
  const [activeDefaultCwd, setActiveDefaultCwd] = useState<string>(initialDefaultCwdRef.current);
  const [activeDefaultShell, setActiveDefaultShell] = useState<string>(
    initialDefaultShellRef.current,
  );

  const handleCursorStyleChange = useCallback((nextCursorStyle: TerminalCursorStyle) => {
    setActiveCursorStyle(nextCursorStyle);
    setPreviewCursorStyle(null);
    storeTerminalCursorStyle(nextCursorStyle);
  }, []);

  const handleLocalEchoChange = useCallback((nextLocalEcho: boolean) => {
    setActiveLocalEcho(nextLocalEcho);
    storeStoredLocalEcho(nextLocalEcho);
  }, []);

  const handleMobileResumeChange = useCallback((nextMobileResume: boolean) => {
    setActiveMobileResume(nextMobileResume);
    storeMobileResume(nextMobileResume);
  }, []);

  const handleCursorBlinkChange = useCallback((nextCursorBlink: boolean) => {
    setActiveCursorBlink(nextCursorBlink);
    storeTerminalCursorBlink(nextCursorBlink);
  }, []);

  const handleScrollbackChange = useCallback((nextScrollback: number) => {
    setActiveScrollback(nextScrollback);
    storeTerminalScrollback(nextScrollback);
  }, []);

  const handleScrollOnUserInputChange = useCallback((nextScrollOnUserInput: boolean) => {
    setActiveScrollOnUserInput(nextScrollOnUserInput);
    storeTerminalScrollOnUserInput(nextScrollOnUserInput);
  }, []);

  const handlePaddingXChange = useCallback((nextPaddingX: number) => {
    const clamped = clampTerminalPaddingX(nextPaddingX);
    setActivePaddingX(clamped);
    storeTerminalPaddingX(clamped);
  }, []);

  const handlePaddingYChange = useCallback((nextPaddingY: number) => {
    const clamped = clampTerminalPaddingY(nextPaddingY);
    setActivePaddingY(clamped);
    storeTerminalPaddingY(clamped);
  }, []);

  // The default launch directory is trimmed before storing so a path with
  // accidental leading/trailing whitespace never becomes a cwd the server
  // rejects (it would silently fall back to the home directory). Mid-path
  // spaces are preserved. Empty clears the default back to home.
  const handleDefaultCwdChange = useCallback((nextDefaultCwd: string) => {
    const trimmed = nextDefaultCwd.trim();
    setActiveDefaultCwd(trimmed);
    storeDefaultCwd(trimmed);
  }, []);

  // Trimmed before storing so a path with accidental whitespace is never sent
  // as `?shell=` (the server would reject a non-executable path on the REST
  // surface and silently fall back on the WS surface). Empty clears the
  // override back to the daemon's detected default shell.
  const handleDefaultShellChange = useCallback((nextDefaultShell: string) => {
    const trimmed = nextDefaultShell.trim();
    setActiveDefaultShell(trimmed);
    storeDefaultShell(trimmed);
  }, []);

  useTerminalXtermSettingsEffects({
    terminalRef,
    fitAddonRef,
    webglAddonRef,
    terminalReady,
    localEchoRef,
    activeLocalEchoRef,
    effectiveTheme: themeSettings.effectiveTheme,
    effectiveThemeWithExtendedPalette: themeSettings.effectiveThemeWithExtendedPalette,
    effectiveFont: fontSettings.effectiveFont,
    effectiveFontFamily: fontSettings.effectiveFontFamily,
    activeMuteEmojiColors: fontSettings.activeMuteEmojiColors,
    activeLigaturesEnabled: fontSettings.activeLigaturesEnabled,
    activeFontSize: fontSettings.activeFontSize,
    activeLineHeight: fontSettings.activeLineHeight,
    effectiveCursorStyle,
    activeCursorBlink,
    activeLocalEcho,
    activeScrollback,
    activeScrollOnUserInput,
    activePaddingX,
    activePaddingY,
  });

  // Settings persist to localStorage, so changing one in any tab fires a
  // `storage` event in every OTHER tab. Re-applying each setting there keeps
  // theme/font/cursor/padding/… in lockstep across all open tabs — the
  // terminal-option effects above already react to these setters. Each
  // subscription self-filters by its storage key.
  useEffect(() => {
    const unsubscribes = [
      subscribeStoredTerminalThemeId(themeSettings.setActiveThemeId),
      subscribeStoredTerminalFontId(fontSettings.setActiveFontId),
      subscribeStoredNerdFontEnabled(fontSettings.setActiveNerdFontEnabled),
      subscribeStoredLigaturesEnabled(fontSettings.setActiveLigaturesEnabled),
      subscribeStoredMuteEmojiColors(fontSettings.setActiveMuteEmojiColors),
      subscribeStoredTerminalFontSize(fontSettings.setActiveFontSize),
      subscribeStoredTerminalLineHeight(fontSettings.setActiveLineHeight),
      subscribeStoredTerminalCursorStyle(setActiveCursorStyle),
      subscribeStoredTerminalCursorBlink(setActiveCursorBlink),
      subscribeStoredLocalEcho(setActiveLocalEcho),
      subscribeStoredMobileResume(setActiveMobileResume),
      subscribeStoredTerminalScrollback(setActiveScrollback),
      subscribeStoredTerminalScrollOnUserInput(setActiveScrollOnUserInput),
      subscribeStoredTerminalPaddingX(setActivePaddingX),
      subscribeStoredTerminalPaddingY(setActivePaddingY),
      subscribeStoredDefaultCwd(setActiveDefaultCwd),
      subscribeStoredDefaultShell(setActiveDefaultShell),
      subscribeStoredCustomThemes(themeSettings.setActiveCustomThemes),
      subscribeStoredCustomFontFamily(fontSettings.setActiveCustomFontFamily),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return {
    initialThemeIdRef: themeSettings.initialThemeIdRef,
    initialCustomThemesRef: themeSettings.initialCustomThemesRef,
    initialFontIdRef: fontSettings.initialFontIdRef,
    initialCustomFontFamilyRef: fontSettings.initialCustomFontFamilyRef,
    initialNerdFontEnabledRef: fontSettings.initialNerdFontEnabledRef,
    initialMuteEmojiColorsRef: fontSettings.initialMuteEmojiColorsRef,
    initialFontSizeRef: fontSettings.initialFontSizeRef,
    initialLineHeightRef: fontSettings.initialLineHeightRef,
    initialCursorStyleRef,
    initialCursorBlinkRef,
    initialScrollbackRef,
    initialScrollOnUserInputRef,
    activeLocalEchoRef,
    activeThemeId: themeSettings.activeThemeId,
    activeFontId: fontSettings.activeFontId,
    activeNerdFontEnabled: fontSettings.activeNerdFontEnabled,
    activeLigaturesEnabled: fontSettings.activeLigaturesEnabled,
    activeMuteEmojiColors: fontSettings.activeMuteEmojiColors,
    activeFontSize: fontSettings.activeFontSize,
    activeLineHeight: fontSettings.activeLineHeight,
    activeCursorStyle,
    activeCursorBlink,
    activeLocalEcho,
    activeMobileResume,
    activeScrollback,
    activeScrollOnUserInput,
    activePaddingX,
    activePaddingY,
    activeDefaultCwd,
    activeDefaultShell,
    activeCustomFontFamily: fontSettings.activeCustomFontFamily,
    activeCustomThemes: themeSettings.activeCustomThemes,
    effectiveTheme: themeSettings.effectiveTheme,
    setPreviewThemeId: themeSettings.setPreviewThemeId,
    setPreviewFontId: fontSettings.setPreviewFontId,
    setPreviewCursorStyle,
    handleThemeChange: themeSettings.handleThemeChange,
    handleFontChange: fontSettings.handleFontChange,
    handleNerdFontEnabledChange: fontSettings.handleNerdFontEnabledChange,
    handleLigaturesEnabledChange: fontSettings.handleLigaturesEnabledChange,
    handleMuteEmojiColorsChange: fontSettings.handleMuteEmojiColorsChange,
    handleFontSizeChange: fontSettings.handleFontSizeChange,
    handleLineHeightChange: fontSettings.handleLineHeightChange,
    handleCursorStyleChange,
    handleCursorBlinkChange,
    handleLocalEchoChange,
    handleMobileResumeChange,
    handleScrollbackChange,
    handleScrollOnUserInputChange,
    handlePaddingXChange,
    handlePaddingYChange,
    handleDefaultCwdChange,
    handleDefaultShellChange,
    handleCustomFontFamilyChange: fontSettings.handleCustomFontFamilyChange,
    handleImportTheme: themeSettings.handleImportTheme,
    handleDeleteCustomTheme: themeSettings.handleDeleteCustomTheme,
    applyThemesState: themeSettings.applyThemesState,
    applyFontsState: fontSettings.applyFontsState,
  };
};
