import { useEffect, useLayoutEffect } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import type { TerminalFont } from "@/lib/terminal-fonts";
import { LocalEcho } from "@/lib/local-echo";
import type { TerminalTheme } from "@/lib/terminal-themes";
import { applyTerminalAppearance } from "@/utils/apply-terminal-appearance";
import { awaitFontReady } from "@/utils/await-font-ready";
import {
  createLigatureSupportProbe,
  type LigatureSupportProbe,
} from "@/utils/create-ligature-support-probe";
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
  }, [terminalReady, effectiveTheme, effectiveThemeWithExtendedPalette, terminalRef]);

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
  }, [terminalReady, effectiveFont, effectiveFontFamily, terminalRef, fitAddonRef]);

  useEffect(() => {
    webglAddonRef.current?.setEmojiColorsMuted(activeMuteEmojiColors);
  }, [activeMuteEmojiColors, webglAddonRef]);

  useEffect(() => {
    if (!terminalReady || !activeLigaturesEnabled) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    let didCancel = false;
    let ligatureJoinerId: number | undefined;
    let ligatureSupportProbe: LigatureSupportProbe | undefined;
    void awaitFontReady(effectiveFont).then(() => {
      if (didCancel || terminalRef.current !== terminal) return;
      const activeLigatureSupportProbe = createLigatureSupportProbe(
        terminal.element,
        effectiveFontFamily,
        activeFontSize,
      );
      ligatureSupportProbe = activeLigatureSupportProbe;
      ligatureJoinerId = terminal.registerCharacterJoiner((text) =>
        findLigatureRanges(text).filter((range) =>
          activeLigatureSupportProbe.supports(text.slice(range[0], range[1])),
        ),
      );
    });

    return () => {
      didCancel = true;
      if (ligatureJoinerId !== undefined) terminal.deregisterCharacterJoiner(ligatureJoinerId);
      ligatureSupportProbe?.dispose();
    };
  }, [
    terminalReady,
    activeLigaturesEnabled,
    effectiveFont,
    effectiveFontFamily,
    activeFontSize,
    terminalRef,
  ]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = activeFontSize;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activeFontSize, terminalRef, fitAddonRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.lineHeight = activeLineHeight;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activeLineHeight, terminalRef, fitAddonRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorStyle = effectiveCursorStyle;
  }, [terminalReady, effectiveCursorStyle, terminalRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorBlink = activeCursorBlink;
  }, [terminalReady, activeCursorBlink, terminalRef]);

  useEffect(() => {
    activeLocalEchoRef.current = activeLocalEcho;
    localEchoRef.current?.setEnabled(activeLocalEcho);
  }, [activeLocalEcho, activeLocalEchoRef, localEchoRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = activeScrollback;
  }, [terminalReady, activeScrollback, terminalRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollOnUserInput = activeScrollOnUserInput;
  }, [terminalReady, activeScrollOnUserInput, terminalRef]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activePaddingX, activePaddingY, terminalRef, fitAddonRef]);
};
