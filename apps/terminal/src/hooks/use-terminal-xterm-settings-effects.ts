import { useEffect, useLayoutEffect, useRef } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import type { TerminalFont } from "@/lib/terminal-fonts";
import { LocalEcho } from "@/lib/local-echo";
import type { TerminalTheme } from "@/lib/terminal-themes";
import { applyTerminalAppearance } from "@/utils/apply-terminal-appearance";
import { awaitFontReady } from "@/utils/await-font-ready";
import { findLigatureRanges } from "@/utils/ligature-joiner";
import { fitTerminalPreservingScroll } from "@/utils/fit-terminal-preserving-scroll";
import { getTerminalMinimumContrastRatio } from "@/utils/get-terminal-minimum-contrast-ratio";

interface ReadonlySettingsRef<Value> {
  readonly current: Value;
}

interface SettingsRef<Value> {
  current: Value;
}

interface UseTerminalXtermSettingsEffectsParams {
  terminalRef: ReadonlySettingsRef<XtermTerminal | null>;
  fitAddonRef: ReadonlySettingsRef<FitAddon | null>;
  webglAddonRef: ReadonlySettingsRef<WebglAddon | null>;
  terminalReady: boolean;
  localEchoRef: ReadonlySettingsRef<LocalEcho | null>;
  activeLocalEchoRef: SettingsRef<boolean>;
  effectiveTheme: TerminalTheme;
  effectiveThemeWithExtendedPalette: ITheme;
  effectiveFont: TerminalFont;
  effectiveFontFamily: string;
  activeMuteEmojiColors: boolean;
  activeLigaturesEnabled: boolean;
  activeFontSize: number;
  activeLineHeight: number;
  effectiveCursorStyle: TerminalCursorStyle;
  activeCursorBlink: boolean;
  activeLocalEcho: boolean;
  activeScrollback: number;
  activeScrollOnUserInput: boolean;
  activePaddingX: number;
  activePaddingY: number;
}

export const useTerminalXtermSettingsEffects = ({
  terminalRef,
  fitAddonRef,
  webglAddonRef,
  terminalReady,
  localEchoRef,
  activeLocalEchoRef,
  effectiveTheme,
  effectiveThemeWithExtendedPalette,
  effectiveFont,
  effectiveFontFamily,
  activeMuteEmojiColors,
  activeLigaturesEnabled,
  activeFontSize,
  activeLineHeight,
  effectiveCursorStyle,
  activeCursorBlink,
  activeLocalEcho,
  activeScrollback,
  activeScrollOnUserInput,
  activePaddingX,
  activePaddingY,
}: UseTerminalXtermSettingsEffectsParams): void => {
  const ligatureJoinerIdRef = useRef<number | null>(null);

  useLayoutEffect(
    () => applyTerminalAppearance(effectiveTheme, effectiveFontFamily),
    [effectiveTheme, effectiveFontFamily],
  );

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const minimumContrastRatio = getTerminalMinimumContrastRatio(effectiveTheme);
    if (terminal.options.minimumContrastRatio !== minimumContrastRatio) {
      terminal.options.minimumContrastRatio = minimumContrastRatio;
    }
    // Theme changes rebuild the glyph model, so the redraw must see the new contrast floor.
    terminal.options.theme = effectiveThemeWithExtendedPalette;
  }, [terminalReady, effectiveTheme, effectiveThemeWithExtendedPalette]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    let cancelled = false;
    void awaitFontReady(effectiveFont).then(() => {
      if (cancelled) return;
      const liveTerminal = terminalRef.current;
      if (!liveTerminal) return;
      liveTerminal.options.fontFamily = effectiveFontFamily;
      liveTerminal.clearTextureAtlas();
      const liveFitAddon = fitAddonRef.current;
      if (liveFitAddon) fitTerminalPreservingScroll(liveTerminal, liveFitAddon);
    });
    return () => {
      cancelled = true;
    };
  }, [terminalReady, effectiveFont, effectiveFontFamily]);

  useEffect(() => {
    webglAddonRef.current?.setEmojiColorsMuted(activeMuteEmojiColors);
  }, [activeMuteEmojiColors, webglAddonRef]);

  // registerCharacterJoiner/deregisterCharacterJoiner each refresh the whole
  // viewport in xterm core, so toggling re-rasters joined spans without an
  // explicit refresh. The id guards keep the register/deregister idempotent
  // across effect re-runs.
  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (activeLigaturesEnabled) {
      if (ligatureJoinerIdRef.current === null) {
        ligatureJoinerIdRef.current = terminal.registerCharacterJoiner(findLigatureRanges);
      }
    } else if (ligatureJoinerIdRef.current !== null) {
      terminal.deregisterCharacterJoiner(ligatureJoinerIdRef.current);
      ligatureJoinerIdRef.current = null;
    }
  }, [terminalReady, activeLigaturesEnabled]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = activeFontSize;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activeFontSize]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.lineHeight = activeLineHeight;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activeLineHeight]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorStyle = effectiveCursorStyle;
  }, [terminalReady, effectiveCursorStyle]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorBlink = activeCursorBlink;
  }, [terminalReady, activeCursorBlink]);

  useEffect(() => {
    activeLocalEchoRef.current = activeLocalEcho;
    localEchoRef.current?.setEnabled(activeLocalEcho);
  }, [activeLocalEcho]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = activeScrollback;
  }, [terminalReady, activeScrollback]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollOnUserInput = activeScrollOnUserInput;
  }, [terminalReady, activeScrollOnUserInput]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activePaddingX, activePaddingY]);
};
