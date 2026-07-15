import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import {
  familyForFont,
  findTerminalFontById,
  CUSTOM_FONT_ID,
  buildCustomTerminalFont,
} from "@/lib/terminal-fonts";
import {
  AUTO_THEME_ID,
  DEFAULT_TERMINAL_THEME_ID,
  findTerminalThemeById,
  resolveAutoTheme,
  type TerminalTheme,
} from "@/lib/terminal-themes";
import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import { LocalEcho } from "@/lib/local-echo";
import { awaitFontReady } from "@/utils/await-font-ready";
import { clampTerminalFontSize } from "@/utils/clamp-terminal-font-size";
import { clampTerminalLineHeight } from "@/utils/clamp-terminal-line-height";
import { clampTerminalPaddingX, clampTerminalPaddingY } from "@/utils/clamp-terminal-padding";
import { findLigatureRanges } from "@/utils/ligature-joiner";
import { fitTerminalPreservingScroll } from "@/utils/fit-terminal-preserving-scroll";
import { generateExtendedPalette } from "@/utils/generate-extended-palette";
import {
  fetchThemes,
  importTheme,
  migrateThemes,
  setActiveTheme as pushActiveTheme,
  deleteTheme as removeRemoteTheme,
} from "@/utils/fetch-themes";
import { fetchFonts, migrateFonts, updateFonts } from "@/utils/fetch-fonts";
import type { FontsResponse } from "@monotykamary/localterm-server/protocol";
import {
  loadStoredCustomThemes,
  storeCustomThemes,
  subscribeStoredCustomThemes,
} from "@/utils/stored-custom-themes";
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
import {
  loadStoredLigaturesEnabled,
  storeLigaturesEnabled,
  subscribeStoredLigaturesEnabled,
} from "@/utils/stored-ligatures-enabled";
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
import {
  loadStoredNerdFontEnabled,
  storeNerdFontEnabled,
  subscribeStoredNerdFontEnabled,
} from "@/utils/stored-nerd-font-enabled";
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
import {
  loadStoredTerminalFontId,
  storeTerminalFontId,
  subscribeStoredTerminalFontId,
} from "@/utils/stored-terminal-font-id";
import {
  loadStoredCustomFontFamily,
  storeCustomFontFamily,
  subscribeStoredCustomFontFamily,
} from "@/utils/stored-custom-font-family";
import {
  loadStoredTerminalFontSize,
  storeTerminalFontSize,
  subscribeStoredTerminalFontSize,
} from "@/utils/stored-terminal-font-size";
import {
  loadStoredTerminalLineHeight,
  storeTerminalLineHeight,
  subscribeStoredTerminalLineHeight,
} from "@/utils/stored-terminal-line-height";
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
import {
  loadStoredTerminalThemeId,
  storeTerminalThemeId,
  subscribeStoredTerminalThemeId,
} from "@/utils/stored-terminal-theme-id";

interface UseTerminalSettingsParams {
  terminalRef: { readonly current: XtermTerminal | null };
  fitAddonRef: { readonly current: FitAddon | null };
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
  terminalReady,
  localEchoRef,
}: UseTerminalSettingsParams) => {
  const initialThemeIdRef = useRef<string>(loadStoredTerminalThemeId());
  const initialFontIdRef = useRef<string>(loadStoredTerminalFontId());
  const initialFontSizeRef = useRef<number>(loadStoredTerminalFontSize());
  const initialLineHeightRef = useRef<number>(loadStoredTerminalLineHeight());
  const initialCursorStyleRef = useRef<TerminalCursorStyle>(loadStoredTerminalCursorStyle());
  const initialCursorBlinkRef = useRef<boolean>(loadStoredTerminalCursorBlink());
  const initialLocalEchoRef = useRef<boolean>(loadStoredLocalEcho());
  const activeLocalEchoRef = useRef<boolean>(initialLocalEchoRef.current);
  const initialMobileResumeRef = useRef<boolean>(loadStoredMobileResume());
  const initialScrollbackRef = useRef<number>(loadStoredTerminalScrollback());
  const initialScrollOnUserInputRef = useRef<boolean>(loadStoredTerminalScrollOnUserInput());
  const initialPaddingXRef = useRef<number>(loadStoredTerminalPaddingX());
  const initialPaddingYRef = useRef<number>(loadStoredTerminalPaddingY());
  const initialNerdFontEnabledRef = useRef<boolean>(loadStoredNerdFontEnabled());
  const initialLigaturesEnabledRef = useRef<boolean>(loadStoredLigaturesEnabled());
  const initialDefaultCwdRef = useRef<string>(loadStoredDefaultCwd());
  const initialDefaultShellRef = useRef<string>(loadStoredDefaultShell());
  const initialCustomFontFamilyRef = useRef<string>(loadStoredCustomFontFamily());

  const [activeThemeId, setActiveThemeId] = useState<string>(initialThemeIdRef.current);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const effectiveThemeId = previewThemeId ?? activeThemeId;
  const [activeCustomThemes, setActiveCustomThemes] =
    useState<TerminalTheme[]>(loadStoredCustomThemes);
  // The daemon is the source of truth for the active theme + the custom library
  // (~/.localterm/themes.json); localStorage is a cache for instant initial
  // render. These refs mirror the state so the stable `applyThemesState` (called
  // from the WS dispatcher) reads the latest without re-creating per change.
  const activeThemeIdRef = useRef(activeThemeId);
  activeThemeIdRef.current = activeThemeId;
  const activeCustomThemesRef = useRef(activeCustomThemes);
  activeCustomThemesRef.current = activeCustomThemes;
  // The host's color-scheme drives the "Auto (system)" theme: VESPER when dark,
  // the light default when light. Updated live via matchMedia so a desktop
  // switch re-resolves without a reload (a Linux GTK color-scheme change).
  const [prefersDark, setPrefersDark] = useState<boolean>(
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );
  const effectiveTheme = useMemo(
    () =>
      effectiveThemeId === AUTO_THEME_ID
        ? resolveAutoTheme(prefersDark)
        : findTerminalThemeById(effectiveThemeId, activeCustomThemes),
    [effectiveThemeId, prefersDark, activeCustomThemes],
  );
  const effectiveThemeWithExtendedPalette = useMemo(
    () => ({
      ...effectiveTheme.colors,
      extendedAnsi: generateExtendedPalette(effectiveTheme.colors),
    }),
    [effectiveTheme],
  );
  const [activeFontId, setActiveFontId] = useState<string>(initialFontIdRef.current);
  const [previewFontId, setPreviewFontId] = useState<string | null>(null);
  const effectiveFontId = previewFontId ?? activeFontId;
  const [activeNerdFontEnabled, setActiveNerdFontEnabled] = useState<boolean>(
    initialNerdFontEnabledRef.current,
  );
  const [activeLigaturesEnabled, setActiveLigaturesEnabled] = useState<boolean>(
    initialLigaturesEnabledRef.current,
  );
  const ligatureJoinerIdRef = useRef<number | null>(null);
  const [activeFontSize, setActiveFontSize] = useState<number>(initialFontSizeRef.current);
  const [activeLineHeight, setActiveLineHeight] = useState<number>(initialLineHeightRef.current);
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
  const [activeCustomFontFamily, setActiveCustomFontFamily] = useState<string>(
    initialCustomFontFamilyRef.current,
  );
  // The daemon is the source of truth for the font state (active id + custom
  // family + Nerd Font / ligatures toggles, kept in ~/.localterm/fonts.json);
  // localStorage is a cache for instant initial render. These refs mirror the
  // state so the stable `applyFontsState` (called from the WS dispatcher) reads
  // the latest without re-creating per change.
  const activeFontIdRef = useRef(activeFontId);
  activeFontIdRef.current = activeFontId;
  const activeCustomFontFamilyRef = useRef(activeCustomFontFamily);
  activeCustomFontFamilyRef.current = activeCustomFontFamily;
  const activeNerdFontEnabledRef = useRef(activeNerdFontEnabled);
  activeNerdFontEnabledRef.current = activeNerdFontEnabled;
  const activeLigaturesEnabledRef = useRef(activeLigaturesEnabled);
  activeLigaturesEnabledRef.current = activeLigaturesEnabled;
  const effectiveFont = useMemo(
    () =>
      effectiveFontId === CUSTOM_FONT_ID
        ? buildCustomTerminalFont(activeCustomFontFamily)
        : findTerminalFontById(effectiveFontId),
    [effectiveFontId, activeCustomFontFamily],
  );

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = effectiveThemeWithExtendedPalette;
  }, [terminalReady, effectiveThemeWithExtendedPalette]);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    let cancelled = false;
    void awaitFontReady(effectiveFont).then(() => {
      if (cancelled) return;
      const liveTerminal = terminalRef.current;
      if (!liveTerminal) return;
      liveTerminal.options.fontFamily = familyForFont(effectiveFont, activeNerdFontEnabled);
      liveTerminal.clearTextureAtlas();
      const liveFitAddon = fitAddonRef.current;
      if (liveFitAddon) fitTerminalPreservingScroll(liveTerminal, liveFitAddon);
    });
    return () => {
      cancelled = true;
    };
  }, [terminalReady, effectiveFont, activeNerdFontEnabled]);

  const handleThemeChange = useCallback((nextThemeId: string) => {
    setActiveThemeId(nextThemeId);
    setPreviewThemeId(null);
    storeTerminalThemeId(nextThemeId);
    void pushActiveTheme(nextThemeId);
  }, []);

  // Import a theme from a file: JSON (TerminalTheme/bare-colors) or iTerm
  // .itermcolors. The daemon parses (one parser, shared with `localterm theme
  // import`) and returns the stored theme with a server-minted id. Returns null
  // on success or an error string the caller surfaces; the imported theme is
  // appended to the custom list and selected immediately.
  const handleImportTheme = useCallback(
    async (file: File): Promise<string | null> => {
      const text = await file.text();
      const result = await importTheme(text, file.name);
      if ("error" in result) return result.error;
      const next = [...activeCustomThemes, result.theme];
      setActiveCustomThemes(next);
      storeCustomThemes(next);
      setActiveThemeId(result.theme.id);
      setPreviewThemeId(null);
      storeTerminalThemeId(result.theme.id);
      void pushActiveTheme(result.theme.id);
      return null;
    },
    [activeCustomThemes],
  );

  const handleDeleteCustomTheme = useCallback(
    (id: string) => {
      const next = activeCustomThemes.filter((theme) => theme.id !== id);
      setActiveCustomThemes(next);
      storeCustomThemes(next);
      // If the deleted theme was active (or previewed), fall back to the default.
      if (activeThemeId === id) {
        setActiveThemeId(DEFAULT_TERMINAL_THEME_ID);
        storeTerminalThemeId(DEFAULT_TERMINAL_THEME_ID);
      }
      if (previewThemeId === id) setPreviewThemeId(null);
      void removeRemoteTheme(id);
    },
    [activeCustomThemes, activeThemeId, previewThemeId],
  );

  // The daemon is the source of truth for the active theme id + the custom-theme
  // library (~/.localterm/themes.json), shared with the `localterm theme` CLI.
  // localStorage stays a cache for instant initial render (no flash of the
  // default); this reconciles it against the server on mount + a slow poll so a
  // CLI `set`/`import`/`delete` reaches open tabs. On first contact with an
  // uninitialized store (a fresh upgrade from the localStorage-only era) it
  // pushes the browser's cached themes to the server once — preserving their
  // ids — so the upgrade never loses the user's imported themes / selection.
  // Apply a theme state the daemon pushed ({type:"themes"} WS message) or that
  // the mount reconcile read — the daemon is the source of truth, localStorage a
  // cache. Stable (reads current state via refs) so the mount-once WS dispatcher
  // captures it for the tab's lifetime. No-op when the state already matches
  // (the browser's own write-through change, confirmed by the broadcast).
  const applyThemesState = useCallback(
    (state: { activeThemeId: string; customThemes: readonly TerminalTheme[] }) => {
      if (state.activeThemeId !== activeThemeIdRef.current) {
        setActiveThemeId(state.activeThemeId);
        storeTerminalThemeId(state.activeThemeId);
      }
      const local = activeCustomThemesRef.current;
      const serverIds = new Set(state.customThemes.map((theme) => theme.id));
      const customsDiffer =
        state.customThemes.length !== local.length ||
        local.some((theme) => !serverIds.has(theme.id));
      if (customsDiffer) {
        setActiveCustomThemes([...state.customThemes]);
        storeCustomThemes(state.customThemes);
      }
    },
    [],
  );

  // Apply a font state the daemon pushed ({type:"fonts"} WS message) or that the
  // mount reconcile read — the daemon is the source of truth, localStorage a
  // cache. Stable (reads current state via refs) so the mount-once WS
  // dispatcher captures it for the tab's lifetime. No-op when the state already
  // matches (the browser's own write-through change, confirmed by the
  // broadcast). `initialized` is the migrate gate, not a setting, so it's
  // ignored here.
  const applyFontsState = useCallback((state: FontsResponse) => {
    if (state.activeFontId !== activeFontIdRef.current) {
      setActiveFontId(state.activeFontId);
      storeTerminalFontId(state.activeFontId);
    }
    if (state.customFontFamily !== activeCustomFontFamilyRef.current) {
      setActiveCustomFontFamily(state.customFontFamily);
      storeCustomFontFamily(state.customFontFamily);
    }
    if (state.nerdFontEnabled !== activeNerdFontEnabledRef.current) {
      setActiveNerdFontEnabled(state.nerdFontEnabled);
      storeNerdFontEnabled(state.nerdFontEnabled);
    }
    if (state.ligaturesEnabled !== activeLigaturesEnabledRef.current) {
      setActiveLigaturesEnabled(state.ligaturesEnabled);
      storeLigaturesEnabled(state.ligaturesEnabled);
    }
  }, []);

  // One-shot on mount: fetch the server state so the cache reconciles, and push
  // the legacy localStorage themes once on first contact with an uninitialized
  // store (an upgrade from the localStorage era). No poll — the daemon pushes
  // {type:"themes"} on every change.
  const reconcileThemes = useCallback(async (): Promise<void> => {
    const data = await fetchThemes();
    if (data === null) return; // daemon down / non-2xx → keep the cache
    if (!data.initialized) {
      await migrateThemes(loadStoredTerminalThemeId(), loadStoredCustomThemes());
      return;
    }
    applyThemesState(data);
  }, [applyThemesState]);

  useEffect(() => {
    void reconcileThemes();
  }, [reconcileThemes]);

  // One-shot on mount: fetch the server font state so the cache reconciles, and
  // push the legacy localStorage font state once on first contact with an
  // uninitialized store (an upgrade from the localStorage era). No poll — the
  // daemon pushes {type:"fonts"} on every change.
  const reconcileFonts = useCallback(async (): Promise<void> => {
    const data = await fetchFonts();
    if (data === null) return; // daemon down / non-2xx → keep the cache
    if (!data.initialized) {
      await migrateFonts({
        activeFontId: loadStoredTerminalFontId(),
        customFontFamily: loadStoredCustomFontFamily(),
        nerdFontEnabled: loadStoredNerdFontEnabled(),
        ligaturesEnabled: loadStoredLigaturesEnabled(),
      });
      return;
    }
    applyFontsState(data);
  }, [applyFontsState]);

  useEffect(() => {
    void reconcileFonts();
  }, [reconcileFonts]);

  // Re-resolve the "Auto (system)" theme when the desktop color-scheme changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  const handleFontChange = useCallback((nextFontId: string) => {
    setActiveFontId(nextFontId);
    setPreviewFontId(null);
    storeTerminalFontId(nextFontId);
    void updateFonts({ activeFontId: nextFontId });
  }, []);

  const handleNerdFontEnabledChange = useCallback((nextEnabled: boolean) => {
    setActiveNerdFontEnabled(nextEnabled);
    storeNerdFontEnabled(nextEnabled);
    void updateFonts({ nerdFontEnabled: nextEnabled });
  }, []);

  const handleLigaturesEnabledChange = useCallback((nextEnabled: boolean) => {
    setActiveLigaturesEnabled(nextEnabled);
    storeLigaturesEnabled(nextEnabled);
    void updateFonts({ ligaturesEnabled: nextEnabled });
  }, []);

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

  const handleFontSizeChange = useCallback((nextFontSize: number) => {
    const clamped = clampTerminalFontSize(nextFontSize);
    setActiveFontSize(clamped);
    storeTerminalFontSize(clamped);
  }, []);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.lineHeight = activeLineHeight;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activeLineHeight]);

  const handleLineHeightChange = useCallback((nextLineHeight: number) => {
    const clamped = clampTerminalLineHeight(nextLineHeight);
    setActiveLineHeight(clamped);
    storeTerminalLineHeight(clamped);
  }, []);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorStyle = effectiveCursorStyle;
  }, [terminalReady, effectiveCursorStyle]);

  const handleCursorStyleChange = useCallback((nextCursorStyle: TerminalCursorStyle) => {
    setActiveCursorStyle(nextCursorStyle);
    setPreviewCursorStyle(null);
    storeTerminalCursorStyle(nextCursorStyle);
  }, []);

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

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = activeScrollback;
  }, [terminalReady, activeScrollback]);

  const handleScrollbackChange = useCallback((nextScrollback: number) => {
    setActiveScrollback(nextScrollback);
    storeTerminalScrollback(nextScrollback);
  }, []);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollOnUserInput = activeScrollOnUserInput;
  }, [terminalReady, activeScrollOnUserInput]);

  const handleScrollOnUserInputChange = useCallback((nextScrollOnUserInput: boolean) => {
    setActiveScrollOnUserInput(nextScrollOnUserInput);
    storeTerminalScrollOnUserInput(nextScrollOnUserInput);
  }, []);

  useEffect(() => {
    if (!terminalReady) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [terminalReady, activePaddingX, activePaddingY]);

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

  // Stored untrimmed so a family name with internal spaces (the common case —
  // "JetBrainsMono Nerd Font Mono") is preserved; only leading/trailing
  // whitespace would be trimmed, and a browser font family never has those.
  // The custom font falls back to the bundled default when this is empty.
  const handleCustomFontFamilyChange = useCallback((nextCustomFontFamily: string) => {
    setActiveCustomFontFamily(nextCustomFontFamily);
    storeCustomFontFamily(nextCustomFontFamily);
    void updateFonts({ customFontFamily: nextCustomFontFamily });
  }, []);

  // Settings persist to localStorage, so changing one in any tab fires a
  // `storage` event in every OTHER tab. Re-applying each setting there keeps
  // theme/font/cursor/padding/… in lockstep across all open tabs — the
  // terminal-option effects above already react to these setters. Each
  // subscription self-filters by its storage key.
  useEffect(() => {
    const unsubscribes = [
      subscribeStoredTerminalThemeId(setActiveThemeId),
      subscribeStoredTerminalFontId(setActiveFontId),
      subscribeStoredNerdFontEnabled(setActiveNerdFontEnabled),
      subscribeStoredLigaturesEnabled(setActiveLigaturesEnabled),
      subscribeStoredTerminalFontSize(setActiveFontSize),
      subscribeStoredTerminalLineHeight(setActiveLineHeight),
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
      subscribeStoredCustomThemes(setActiveCustomThemes),
      subscribeStoredCustomFontFamily(setActiveCustomFontFamily),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return {
    initialThemeIdRef,
    initialFontIdRef,
    initialNerdFontEnabledRef,
    initialFontSizeRef,
    initialLineHeightRef,
    initialCursorStyleRef,
    initialCursorBlinkRef,
    initialScrollbackRef,
    initialScrollOnUserInputRef,
    activeLocalEchoRef,
    activeThemeId,
    activeFontId,
    activeNerdFontEnabled,
    activeLigaturesEnabled,
    activeFontSize,
    activeLineHeight,
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
    activeCustomFontFamily,
    activeCustomThemes,
    effectiveTheme,
    setPreviewThemeId,
    setPreviewFontId,
    setPreviewCursorStyle,
    handleThemeChange,
    handleFontChange,
    handleNerdFontEnabledChange,
    handleLigaturesEnabledChange,
    handleFontSizeChange,
    handleLineHeightChange,
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
    handleCustomFontFamilyChange,
    handleImportTheme,
    handleDeleteCustomTheme,
    applyThemesState,
    applyFontsState,
  };
};
