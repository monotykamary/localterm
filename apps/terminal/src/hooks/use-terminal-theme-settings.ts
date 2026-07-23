import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_THEME_ID,
  DEFAULT_DARK_TERMINAL_THEME_ID,
  DEFAULT_LIGHT_TERMINAL_THEME_ID,
  DEFAULT_TERMINAL_THEME_ID,
  findTerminalThemeById,
  resolveAutoTheme,
  type TerminalTheme,
} from "@/lib/terminal-themes";
import {
  fetchThemes,
  importTheme,
  migrateThemes,
  setActiveTheme as pushActiveTheme,
  setSystemThemes as pushSystemThemes,
  deleteTheme as removeRemoteTheme,
} from "@/utils/fetch-themes";
import { loadStoredCustomThemes, storeCustomThemes } from "@/utils/stored-custom-themes";
import { loadStoredTerminalThemeId, storeTerminalThemeId } from "@/utils/stored-terminal-theme-id";
import {
  loadStoredTerminalLightThemeId,
  storeTerminalLightThemeId,
} from "@/utils/stored-terminal-light-theme-id";
import {
  loadStoredTerminalDarkThemeId,
  storeTerminalDarkThemeId,
} from "@/utils/stored-terminal-dark-theme-id";
import { generateExtendedPalette } from "@/utils/generate-extended-palette";
import { useLatestRef } from "@/utils/use-latest-ref";

interface TerminalThemesState {
  activeThemeId: string;
  lightThemeId: string;
  darkThemeId: string;
  customThemes: readonly TerminalTheme[];
}

export const useTerminalThemeSettings = () => {
  const [activeThemeId, setActiveThemeId] = useState(loadStoredTerminalThemeId);
  const [activeLightThemeId, setActiveLightThemeId] = useState(loadStoredTerminalLightThemeId);
  const [activeDarkThemeId, setActiveDarkThemeId] = useState(loadStoredTerminalDarkThemeId);
  const [activeCustomThemes, setActiveCustomThemes] = useState(loadStoredCustomThemes);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [initialEffectiveTheme] = useState<TerminalTheme>(() =>
    activeThemeId === AUTO_THEME_ID
      ? resolveAutoTheme(
          typeof window !== "undefined" &&
            Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches),
          activeLightThemeId,
          activeDarkThemeId,
          activeCustomThemes,
        )
      : findTerminalThemeById(activeThemeId, activeCustomThemes),
  );
  const initialEffectiveThemeRef = useRef(initialEffectiveTheme);
  // The daemon is the source of truth for the active theme + the custom library
  // (~/.localterm/themes.json); localStorage is a cache for instant initial
  // render. These refs mirror the state so the stable `applyThemesState` (called
  // from the WS dispatcher) reads the latest without re-creating per change.
  const activeThemeIdRef = useLatestRef(activeThemeId);
  const activeCustomThemesRef = useLatestRef(activeCustomThemes);
  // The host color scheme selects the configured light or dark theme and updates
  // live when the desktop appearance changes.
  const [prefersDark, setPrefersDark] = useState<boolean>(
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );
  const effectiveTheme = useMemo(() => {
    if (previewThemeId) return findTerminalThemeById(previewThemeId, activeCustomThemes);
    if (activeThemeId !== AUTO_THEME_ID) {
      return findTerminalThemeById(activeThemeId, activeCustomThemes);
    }
    return resolveAutoTheme(prefersDark, activeLightThemeId, activeDarkThemeId, activeCustomThemes);
  }, [
    previewThemeId,
    activeThemeId,
    activeLightThemeId,
    activeDarkThemeId,
    prefersDark,
    activeCustomThemes,
  ]);
  const effectiveThemeWithExtendedPalette = useMemo(
    () => ({
      ...effectiveTheme.colors,
      extendedAnsi: generateExtendedPalette(effectiveTheme.colors),
    }),
    [effectiveTheme],
  );

  const handleThemeChange = useCallback((nextThemeId: string) => {
    setActiveThemeId(nextThemeId);
    setPreviewThemeId(null);
    storeTerminalThemeId(nextThemeId);
    void pushActiveTheme(nextThemeId);
  }, []);

  const handleSystemThemeEnabledChange = useCallback(
    (enabled: boolean) => {
      handleThemeChange(
        enabled ? AUTO_THEME_ID : prefersDark ? activeDarkThemeId : activeLightThemeId,
      );
    },
    [handleThemeChange, prefersDark, activeDarkThemeId, activeLightThemeId],
  );

  const handleLightThemeChange = useCallback(
    (nextThemeId: string) => {
      setActiveLightThemeId(nextThemeId);
      setPreviewThemeId(null);
      storeTerminalLightThemeId(nextThemeId);
      void pushSystemThemes(nextThemeId, activeDarkThemeId);
    },
    [activeDarkThemeId],
  );

  const handleDarkThemeChange = useCallback(
    (nextThemeId: string) => {
      setActiveDarkThemeId(nextThemeId);
      setPreviewThemeId(null);
      storeTerminalDarkThemeId(nextThemeId);
      void pushSystemThemes(activeLightThemeId, nextThemeId);
    },
    [activeLightThemeId],
  );

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
      const nextLightThemeId =
        activeLightThemeId === id ? DEFAULT_LIGHT_TERMINAL_THEME_ID : activeLightThemeId;
      const nextDarkThemeId =
        activeDarkThemeId === id ? DEFAULT_DARK_TERMINAL_THEME_ID : activeDarkThemeId;
      if (nextLightThemeId !== activeLightThemeId) {
        setActiveLightThemeId(nextLightThemeId);
        storeTerminalLightThemeId(nextLightThemeId);
      }
      if (nextDarkThemeId !== activeDarkThemeId) {
        setActiveDarkThemeId(nextDarkThemeId);
        storeTerminalDarkThemeId(nextDarkThemeId);
      }
      if (previewThemeId === id) setPreviewThemeId(null);
      void removeRemoteTheme(id);
    },
    [activeCustomThemes, activeThemeId, activeLightThemeId, activeDarkThemeId, previewThemeId],
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
    (state: TerminalThemesState) => {
      if (state.activeThemeId !== activeThemeIdRef.current) {
        setActiveThemeId(state.activeThemeId);
        storeTerminalThemeId(state.activeThemeId);
      }
      setActiveLightThemeId(state.lightThemeId);
      storeTerminalLightThemeId(state.lightThemeId);
      setActiveDarkThemeId(state.darkThemeId);
      storeTerminalDarkThemeId(state.darkThemeId);
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
    [activeThemeIdRef, activeCustomThemesRef],
  );

  // One-shot on mount: fetch the server state so the cache reconciles, and push
  // the legacy localStorage themes once on first contact with an uninitialized
  // store (an upgrade from the localStorage era). No poll — the daemon pushes
  // {type:"themes"} on every change.
  const reconcileThemes = useCallback(async (): Promise<void> => {
    const data = await fetchThemes();
    if (data === null) return; // daemon down / non-2xx → keep the cache
    if (!data.initialized) {
      await migrateThemes(
        loadStoredTerminalThemeId(),
        loadStoredCustomThemes(),
        loadStoredTerminalLightThemeId(),
        loadStoredTerminalDarkThemeId(),
      );
      return;
    }
    applyThemesState(data);
  }, [applyThemesState]);

  useEffect(() => {
    void reconcileThemes();
  }, [reconcileThemes]);

  // Re-resolve the "Auto (system)" theme when the desktop color-scheme changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return {
    initialEffectiveThemeRef,
    activeThemeId,
    activeLightThemeId,
    activeDarkThemeId,
    systemThemeEnabled: activeThemeId === AUTO_THEME_ID,
    activeCustomThemes,
    effectiveTheme,
    effectiveThemeWithExtendedPalette,
    setActiveThemeId,
    setActiveLightThemeId,
    setActiveDarkThemeId,
    setActiveCustomThemes,
    setPreviewThemeId,
    handleThemeChange,
    handleSystemThemeEnabledChange,
    handleLightThemeChange,
    handleDarkThemeChange,
    handleImportTheme,
    handleDeleteCustomTheme,
    applyThemesState,
  };
};
