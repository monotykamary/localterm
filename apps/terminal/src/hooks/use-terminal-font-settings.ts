import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FontsResponse } from "@monotykamary/localterm-server/protocol";
import {
  buildCustomTerminalFont,
  CUSTOM_FONT_ID,
  familyForFont,
  findTerminalFontById,
} from "@/lib/terminal-fonts";
import { clampTerminalFontSize } from "@/utils/clamp-terminal-font-size";
import { clampTerminalLineHeight } from "@/utils/clamp-terminal-line-height";
import { useLatestRef } from "@/utils/use-latest-ref";
import { fetchFonts, migrateFonts, updateFonts } from "@/utils/fetch-fonts";
import {
  loadStoredCustomFontFamily,
  storeCustomFontFamily,
} from "@/utils/stored-custom-font-family";
import {
  loadStoredLigaturesEnabled,
  storeLigaturesEnabled,
} from "@/utils/stored-ligatures-enabled";
import { loadStoredMuteEmojiColors, storeMuteEmojiColors } from "@/utils/stored-mute-emoji-colors";
import { loadStoredNerdFontEnabled, storeNerdFontEnabled } from "@/utils/stored-nerd-font-enabled";
import { loadStoredTerminalFontId, storeTerminalFontId } from "@/utils/stored-terminal-font-id";
import {
  loadStoredTerminalFontSize,
  storeTerminalFontSize,
} from "@/utils/stored-terminal-font-size";
import {
  loadStoredTerminalLineHeight,
  storeTerminalLineHeight,
} from "@/utils/stored-terminal-line-height";

export const useTerminalFontSettings = () => {
  const initialFontIdRef = useRef<string>(loadStoredTerminalFontId());
  const initialFontSizeRef = useRef<number>(loadStoredTerminalFontSize());
  const initialLineHeightRef = useRef<number>(loadStoredTerminalLineHeight());
  const initialNerdFontEnabledRef = useRef<boolean>(loadStoredNerdFontEnabled());
  const initialLigaturesEnabledRef = useRef<boolean>(loadStoredLigaturesEnabled());
  const initialMuteEmojiColorsRef = useRef<boolean>(loadStoredMuteEmojiColors());
  const initialCustomFontFamilyRef = useRef<string>(loadStoredCustomFontFamily());
  const [activeFontId, setActiveFontId] = useState<string>(initialFontIdRef.current);
  const [previewFontId, setPreviewFontId] = useState<string | null>(null);
  const effectiveFontId = previewFontId ?? activeFontId;
  const [activeNerdFontEnabled, setActiveNerdFontEnabled] = useState<boolean>(
    initialNerdFontEnabledRef.current,
  );
  const [activeLigaturesEnabled, setActiveLigaturesEnabled] = useState<boolean>(
    initialLigaturesEnabledRef.current,
  );
  const [activeMuteEmojiColors, setActiveMuteEmojiColors] = useState<boolean>(
    initialMuteEmojiColorsRef.current,
  );
  const [activeFontSize, setActiveFontSize] = useState<number>(initialFontSizeRef.current);
  const [activeLineHeight, setActiveLineHeight] = useState<number>(initialLineHeightRef.current);
  const [activeCustomFontFamily, setActiveCustomFontFamily] = useState<string>(
    initialCustomFontFamilyRef.current,
  );
  // The daemon is the source of truth for the font state (active id + custom
  // family + Nerd Font / ligatures toggles, kept in ~/.localterm/fonts.json);
  // localStorage is a cache for instant initial render. These refs mirror the
  // state so the stable `applyFontsState` (called from the WS dispatcher) reads
  // the latest without re-creating per change.
  const activeFontIdRef = useLatestRef(activeFontId);
  const activeCustomFontFamilyRef = useLatestRef(activeCustomFontFamily);
  const activeNerdFontEnabledRef = useLatestRef(activeNerdFontEnabled);
  const activeLigaturesEnabledRef = useLatestRef(activeLigaturesEnabled);
  const effectiveFont = useMemo(
    () =>
      effectiveFontId === CUSTOM_FONT_ID
        ? buildCustomTerminalFont(activeCustomFontFamily)
        : findTerminalFontById(effectiveFontId),
    [effectiveFontId, activeCustomFontFamily],
  );
  const effectiveFontFamily = useMemo(
    () => familyForFont(effectiveFont, activeNerdFontEnabled),
    [effectiveFont, activeNerdFontEnabled],
  );

  // Apply a font state the daemon pushed ({type:"fonts"} WS message) or that the
  // mount reconcile read — the daemon is the source of truth, localStorage a
  // cache. Stable (reads current state via refs) so the mount-once WS
  // dispatcher captures it for the tab's lifetime. No-op when the state already
  // matches (the browser's own write-through change, confirmed by the
  // broadcast). `initialized` is the migrate gate, not a setting, so it's
  // ignored here.
  const applyFontsState = useCallback(
    (state: FontsResponse) => {
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
    },
    [
      activeFontIdRef,
      activeCustomFontFamilyRef,
      activeNerdFontEnabledRef,
      activeLigaturesEnabledRef,
    ],
  );

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

  const handleMuteEmojiColorsChange = useCallback((nextMuted: boolean) => {
    setActiveMuteEmojiColors(nextMuted);
    storeMuteEmojiColors(nextMuted);
  }, []);

  const handleFontSizeChange = useCallback((nextFontSize: number) => {
    const clamped = clampTerminalFontSize(nextFontSize);
    setActiveFontSize(clamped);
    storeTerminalFontSize(clamped);
  }, []);

  const handleLineHeightChange = useCallback((nextLineHeight: number) => {
    const clamped = clampTerminalLineHeight(nextLineHeight);
    setActiveLineHeight(clamped);
    storeTerminalLineHeight(clamped);
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

  return {
    initialFontIdRef,
    initialCustomFontFamilyRef,
    initialNerdFontEnabledRef,
    initialMuteEmojiColorsRef,
    initialFontSizeRef,
    initialLineHeightRef,
    activeFontId,
    activeNerdFontEnabled,
    activeLigaturesEnabled,
    activeMuteEmojiColors,
    activeFontSize,
    activeLineHeight,
    activeCustomFontFamily,
    effectiveFont,
    effectiveFontFamily,
    setActiveFontId,
    setActiveNerdFontEnabled,
    setActiveLigaturesEnabled,
    setActiveMuteEmojiColors,
    setActiveFontSize,
    setActiveLineHeight,
    setActiveCustomFontFamily,
    setPreviewFontId,
    handleFontChange,
    handleNerdFontEnabledChange,
    handleLigaturesEnabledChange,
    handleMuteEmojiColorsChange,
    handleFontSizeChange,
    handleLineHeightChange,
    handleCustomFontFamilyChange,
    applyFontsState,
  };
};
