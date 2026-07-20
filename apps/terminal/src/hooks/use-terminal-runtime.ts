import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { type CaffeinateMode } from "@/components/keep-awake-menu";

import { type CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";
import {
  DEAD_SESSION_TITLE_PREFIX,
  DEFAULT_DOCUMENT_TITLE,
  HAPTIC_TAP_MS,
  RECONNECT_DELAY_MS,
  RESIZE_DEBOUNCE_MS,
} from "@/lib/constants";
import {
  AMBIENT_TAB_CLOSE_DEADLINE_MS,
  LOCALTERM_TAB_TOKEN_EVENT,
  LOCALTERM_TAB_TOKEN_PROPERTY,
  serverToClientMessageSchema,
} from "@monotykamary/localterm-server/protocol";

import {
  CUSTOM_FONT_ID,
  buildCustomTerminalFont,
  findTerminalFontById,
} from "@/lib/terminal-fonts";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";
import { findTerminalThemeById, type TerminalTheme } from "@/lib/terminal-themes";
import { awaitFontReady } from "@/utils/await-font-ready";
import {
  captureTerminalScrollAnchor,
  type TerminalScrollAnchor,
} from "@/utils/capture-terminal-scroll-anchor";
import { fitTerminalPreservingScroll } from "@/utils/fit-terminal-preserving-scroll";
import { formatShellExitMarker } from "@/utils/format-shell-exit-marker";
import { triggerHapticFeedback } from "@/utils/haptic-feedback";
import { chunkInputByCodeUnits } from "@/utils/chunk-input-by-code-units";
import { restoreTerminalScrollAnchor } from "@/utils/restore-terminal-scroll-anchor";
import { outputBatcher } from "@/utils/write-terminal-output";
import { shouldBlockTerminalScrollbackPurge } from "@/utils/should-block-terminal-scrollback-purge";
import { subscribeTerminalUserInput } from "@/utils/subscribe-terminal-user-input";

import { isBinaryMessageData } from "@/utils/is-binary-message-data";
import { removeInitialCommandQueryParam } from "@/utils/remove-initial-command-query-param";
import {
  FRESH_SESSION_QUERY_PARAM,
  removeFreshSessionQueryParam,
} from "@/utils/fresh-session-query-param";
import { removeRunQueryParam, RUN_QUERY_PARAM } from "@/utils/remove-run-query-param";
import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";
import { LocalEcho } from "@/lib/local-echo";

import { buildTerminalWebSocketUrl } from "@/utils/build-terminal-websocket-url";
import { detectDeviceTier } from "@/utils/detect-device-tier";
import { fetchSessions } from "@/utils/fetch-sessions";
import { loadStoredMobileResume } from "@/utils/stored-mobile-resume";
import { resolveResumeSession } from "@/utils/resolve-resume-session";
import { setTabFaviconState } from "@/utils/set-tab-favicon-state";

import { createTerminalSurface } from "@/lib/terminal-runtime/create-terminal-surface";
import {
  createTerminalOutputSession,
  type TerminalOutputSession,
} from "@/lib/terminal-runtime/create-terminal-output-session";
import { createTabOutputActivity } from "@/lib/terminal-runtime/create-tab-output-activity";
import { createTerminalSessionLifecycle } from "@/lib/terminal-runtime/create-terminal-session-lifecycle";
import { SHELL_CLOSE_MASK_DELAY_MS } from "@/lib/terminal-runtime/constants";
import {
  dispatchTerminalControlMessage,
  type TerminalControlMessageCallbacks,
} from "@/lib/terminal-runtime/dispatch-terminal-control-message";

import type { KeyboardShortcutMap } from "@/lib/keyboard-shortcuts";
import { detectOutputCompressMode } from "@/utils/detect-output-compress-mode";

import { installTerminalInputHandlers } from "@/utils/install-terminal-input-handlers";
import { installTerminalScrollbar } from "@/utils/install-terminal-scrollbar";
import { installTerminalTouchInteractions } from "@/utils/install-terminal-touch-interactions";
import { registerTerminalKittyKeyboardProtocol } from "@/utils/register-terminal-kitty-keyboard-protocol";

import {
  MAX_INPUT_BYTES,
  WS_CLOSE_BACKPRESSURE,
  type ClientToServerMessage,
} from "@monotykamary/localterm-server/protocol";

const titleForLiveSession = (raw: string): string => raw || DEFAULT_DOCUMENT_TITLE;
const titleForDeadSession = (raw: string): string =>
  `${DEAD_SESSION_TITLE_PREFIX}${raw || DEFAULT_DOCUMENT_TITLE}`;

// Server-side output compression: remote surfaces advertise the best browser
// decompressor and the server tags each compressed binary frame with its mode.
// Loopback surfaces stay raw: their bandwidth is effectively free, while a
// large synchronized redraw spans several batches and serially constructing a
// DecompressionStream for each batch can dominate frame time. Browsers never
// negotiate permessage-deflate, so this remains application-level.
const COMPRESS_MODE = detectOutputCompressMode(window.location.hostname);

export type TerminalExitInfo =
  | { reason: "shell-exited"; exitCode: number | null }
  | {
      reason: "connection-lost";
      closeCode: number;
      closeReason: string;
      wasClean: boolean;
    };

interface ResizeScrollRestoreState {
  anchor: TerminalScrollAnchor;
  frameId: number;
}

interface CurrentRef<Value> {
  current: Value;
}

interface TerminalPtySize {
  cols: number;
  rows: number;
}

interface TerminalSearchResultState {
  resultIndex: number;
  resultCount: number;
}

interface TerminalRuntimeRefs {
  containerRef: CurrentRef<HTMLDivElement | null>;
  terminalRef: CurrentRef<XtermTerminal | null>;
  ptySizeRef: CurrentRef<TerminalPtySize | null>;
  naturalColsRef: CurrentRef<number | null>;
  liveCwdRef: CurrentRef<string | null>;
  liveSessionIdRef: CurrentRef<string | null>;
  previousSessionIdRef: CurrentRef<string | null>;
  manualReconnectRef: CurrentRef<(() => void) | null>;
  switchSessionRef: CurrentRef<((sessionId: string) => void) | null>;
  spawnFreshSessionRef: CurrentRef<(() => void) | null>;
  refocusTerminalRef: CurrentRef<(() => void) | null>;
  pasteToTerminalRef: CurrentRef<((text: string) => void) | null>;
  localEchoRef: CurrentRef<LocalEcho | null>;
  fitAddonRef: CurrentRef<FitAddon | null>;
  webglAddonRef: CurrentRef<WebglAddon | null>;
  searchAddonRef: CurrentRef<SearchAddon | null>;
  scrollbarTrackRef: CurrentRef<HTMLDivElement | null>;
  scrollbarThumbRef: CurrentRef<HTMLDivElement | null>;
  onScreenKeyboardOpenRef: CurrentRef<boolean>;
  sendInputRef: CurrentRef<((data: string) => void) | null>;
  wsConnectedRef: CurrentRef<boolean>;
  keyboardShortcutsRef: CurrentRef<KeyboardShortcutMap>;
}

interface TerminalRuntimeActionRefs {
  openNewShellRef: CurrentRef<(() => void) | null>;
  openSearchOverlayRef: CurrentRef<(() => void) | null>;
  openDiffViewerRef: CurrentRef<(() => void) | null>;
  toggleCommandPaletteRef: CurrentRef<(() => void) | null>;
  toggleAutomationsRef: CurrentRef<(() => void) | null>;
  toggleWorktreesRef: CurrentRef<(() => void) | null>;
  togglePortsRef: CurrentRef<(() => void) | null>;
  toggleSessionsRef: CurrentRef<(() => void) | null>;
  toggleSecretsRef: CurrentRef<(() => void) | null>;
  createWorktreeRef: CurrentRef<
    ((options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>) | null
  >;
  setCaffeinateModeRef: CurrentRef<((mode: CaffeinateMode) => void) | null>;
  setCaffeinateCommandsRef: CurrentRef<((commands: string[]) => void) | null>;
  setCaffeinateActivityGateRef: CurrentRef<((enabled: boolean) => void) | null>;
  setCaffeinatePeerKeepAwakeRef: CurrentRef<((enabled: boolean) => void) | null>;
  setCaffeinateBatteryThresholdRef: CurrentRef<((percent: number | null) => void) | null>;
  qrPeerAttachedRef: CurrentRef<(() => void) | null>;
}

interface TerminalRuntimeInitialSettings {
  initialThemeIdRef: CurrentRef<string>;
  initialCustomThemesRef: CurrentRef<TerminalTheme[]>;
  initialFontIdRef: CurrentRef<string>;
  initialCustomFontFamilyRef: CurrentRef<string>;
  initialNerdFontEnabledRef: CurrentRef<boolean>;
  initialMuteEmojiColorsRef: CurrentRef<boolean>;
  initialFontSizeRef: CurrentRef<number>;
  initialLineHeightRef: CurrentRef<number>;
  initialCursorStyleRef: CurrentRef<"block" | "underline" | "bar">;
  initialCursorBlinkRef: CurrentRef<boolean>;
  initialScrollbackRef: CurrentRef<number>;
  initialScrollOnUserInputRef: CurrentRef<boolean>;
  activeLocalEchoRef: CurrentRef<boolean>;
}

interface TerminalRuntimeCallbacks extends TerminalControlMessageCallbacks {
  setPtyViewportVersion: Dispatch<SetStateAction<number>>;
  setTerminalReady: (ready: boolean) => void;
  setExitInfo: (value: TerminalExitInfo | null) => void;
  setConsecutiveFailures: Dispatch<SetStateAction<number>>;
  setSessionInfo: (value: TerminalSessionInfo | null) => void;
  setLiveCwd: (cwd: string | null) => void;
  setForegroundProcess: (process: string | null) => void;
  setSearchResults: (value: TerminalSearchResultState) => void;
}

interface UseTerminalRuntimeOptions {
  refs: TerminalRuntimeRefs;
  actionRefs: TerminalRuntimeActionRefs;
  initialSettings: TerminalRuntimeInitialSettings;
  callbacks: TerminalRuntimeCallbacks;
  isMac: boolean;
  isTouchDevice: boolean;
  openOnScreenKeyboard: () => void;
}

export const useTerminalRuntime = ({
  refs,
  actionRefs,
  initialSettings,
  callbacks,
  isMac,
  isTouchDevice,
  openOnScreenKeyboard,
}: UseTerminalRuntimeOptions): void => {
  const {
    containerRef,
    terminalRef,
    ptySizeRef,
    naturalColsRef,
    liveCwdRef,
    liveSessionIdRef,
    previousSessionIdRef,
    manualReconnectRef,
    switchSessionRef,
    spawnFreshSessionRef,
    refocusTerminalRef,
    pasteToTerminalRef,
    localEchoRef,
    fitAddonRef,
    webglAddonRef,
    searchAddonRef,
    scrollbarTrackRef,
    scrollbarThumbRef,
    onScreenKeyboardOpenRef,
    sendInputRef,
    wsConnectedRef,
    keyboardShortcutsRef,
  } = refs;
  const {
    openNewShellRef,
    openSearchOverlayRef,
    openDiffViewerRef,
    toggleCommandPaletteRef,
    toggleAutomationsRef,
    toggleWorktreesRef,
    togglePortsRef,
    toggleSessionsRef,
    toggleSecretsRef,
    createWorktreeRef,
    setCaffeinateModeRef,
    setCaffeinateCommandsRef,
    setCaffeinateActivityGateRef,
    setCaffeinatePeerKeepAwakeRef,
    setCaffeinateBatteryThresholdRef,
    qrPeerAttachedRef,
  } = actionRefs;
  const {
    initialThemeIdRef,
    initialCustomThemesRef,
    initialFontIdRef,
    initialCustomFontFamilyRef,
    initialNerdFontEnabledRef,
    initialMuteEmojiColorsRef,
    initialFontSizeRef,
    initialLineHeightRef,
    initialCursorStyleRef,
    initialCursorBlinkRef,
    initialScrollbackRef,
    initialScrollOnUserInputRef,
    activeLocalEchoRef,
  } = initialSettings;
  const {
    setPtySize,
    setPtyViewportVersion,
    setTerminalReady,
    setExitInfo,
    setConsecutiveFailures,
    setSessionInfo,
    setLiveCwd,
    setForegroundProcess,
    setSearchResults,
  } = callbacks;
  const resizeScrollRestoreRef = useRef<ResizeScrollRestoreState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reads the CDP-injected ambient tab token off `window`. Injected by the
    // daemon's CdpClient via Page.addScriptToEvaluateOnNewDocument on every
    // page-type target on our origin; the property name lives in
    // LOCALTERM_TAB_TOKEN_PROPERTY so the wire protocol stays authoritative
    // (no parallel literal). Cast unavoidable — TS can't type-index Window by
    // a runtime-constant string.
    const readTabToken = (): string | undefined =>
      (window as unknown as Record<string, string | undefined>)[LOCALTERM_TAB_TOKEN_PROPERTY];

    let disposed = false;
    let lastTitle = "";
    let socket: WebSocket | null = null;
    const sessionLifecycle = createTerminalSessionLifecycle({
      liveSessionIdRef,
      previousSessionIdRef,
    });
    const tabOutputActivity = createTabOutputActivity(
      () => disposed || sessionLifecycle.getExited(),
      setForegroundProcess,
    );
    // Suppressed-replay window. On a switch (or fresh load) the server replays
    // the PTY's scrollback ring buffer as binary frames terminated by a
    // `{type:"replay-end"}` marker. The raw bytes contain stale terminal
    // query requests (DA/DSR/OSC/DECRQM) the shell emitted once; replaying them
    // into a fresh xterm.js re-evaluates every request and makes xterm re-emit
    // its response, which the onData handler would forward to the LIVE PTY as
    // typed garbage (e.g. `62;4;9;22c` on every switch). Sanitizing the requests
    // server-side is unbounded — every query variant must be enumerated — so
    // instead the client buffers the replay frames and writes them as one
    // block with onData suppressed, dropping every response regardless of
    // sequence. `suppressOutput` gates onData; `inReplay` routes binary frames
    // to the buffer instead of the live batcher; `replayChunks` holds them
    // until `replay-end` lands.
    let reconnectTimer: number | null = null;
    let resizeTimer: number | null = null;

    const initialFont =
      initialFontIdRef.current === CUSTOM_FONT_ID
        ? buildCustomTerminalFont(initialCustomFontFamilyRef.current)
        : findTerminalFontById(initialFontIdRef.current);
    const initialTheme = findTerminalThemeById(
      initialThemeIdRef.current,
      initialCustomThemesRef.current,
    );
    void awaitFontReady(initialFont).then(() => {
      if (disposed) return;
      const liveTerminal = terminalRef.current;
      if (liveTerminal) liveTerminal.clearTextureAtlas();
      const internals = terminal as unknown as {
        _core: { _charSizeService: { measure: () => void } };
      };
      internals._core._charSizeService.measure();
      fitToContainer();
    });

    const terminalSurface = createTerminalSurface({
      container,
      initialCursorBlink: initialCursorBlinkRef.current,
      initialCursorStyle: initialCursorStyleRef.current,
      initialFont,
      initialFontSize: initialFontSizeRef.current,
      initialLineHeight: initialLineHeightRef.current,
      initialMuteEmojiColors: initialMuteEmojiColorsRef.current,
      initialNerdFontEnabled: initialNerdFontEnabledRef.current,
      initialScrollback: initialScrollbackRef.current,
      initialScrollOnUserInput: initialScrollOnUserInputRef.current,
      initialTheme,
      fitAddonRef,
      searchAddonRef,
      webglAddonRef,
      setSearchResults,
    });
    const { terminal, fitAddon } = terminalSurface;
    terminalRef.current = terminal;

    const terminalTouchInteractions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice,
      onScreenKeyboardOpenRef,
      openOnScreenKeyboard,
    });
    const { refocusTerminalQuietly } = terminalTouchInteractions;

    const terminalScrollbar = installTerminalScrollbar({
      terminal,
      fitAddon,
      naturalColsRef,
      ptySizeRef,
      scrollbarTrackRef,
      scrollbarThumbRef,
      setPtyViewportVersion,
    });
    const updateScrollbar = terminalScrollbar.update;

    terminalSurface.loadWebgl();

    const kittyKeyboardProtocol = registerTerminalKittyKeyboardProtocol(terminal);
    const getKittyFlags = kittyKeyboardProtocol.getFlags;

    // Inline TUIs should be allowed to clear and repaint the visible screen, but
    // not to delete the browser-owned scrollback. xterm implements ED3
    // (`CSI 3 J`, plus selective `CSI ? 3 J`) by trimming activeBuffer.lines and
    // rewriting ybase/ydisp, which makes Localterm jump to the top and destroys
    // history. Codex emits it after resize reflow; pi-mono and Claude Code emit
    // it on full redraws; Cursor Agent emits it on mount/width-triggered clears. A
    // parser handler is narrower and more robust than byte filtering: xterm
    // normalizes split writes, 8-bit CSI, and `03` params before this callback.
    // We intentionally still allow ED0/1/2 visible clears, alt-buffer switches
    // (`?1049h/l`, handled by xterm without deleting normal scrollback), and
    // RIS (`ESC c`), which is a full terminal reset rather than a redraw clear.
    const scrollbackPurgeDisposable = terminal.parser.registerCsiHandler(
      { final: "J" },
      shouldBlockTerminalScrollbackPurge,
    );
    const selectiveScrollbackPurgeDisposable = terminal.parser.registerCsiHandler(
      { prefix: "?", final: "J" },
      shouldBlockTerminalScrollbackPurge,
    );

    const send = (message: ClientToServerMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const sendClientFocus = (focused: boolean) => {
      send({ type: "client-focus", focused });
    };
    const sendInput = (data: string) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      outputBatcher.noteUserInput();
      send({ type: "input", data });
    };
    sendInputRef.current = sendInput;

    setCaffeinateModeRef.current = (mode: CaffeinateMode) =>
      send({ type: "caffeinate-mode", mode });
    setCaffeinateCommandsRef.current = (commands: string[]) =>
      send({ type: "caffeinate-commands", commands });
    setCaffeinateActivityGateRef.current = (enabled: boolean) =>
      send({ type: "caffeinate-activity-gate", enabled });
    setCaffeinatePeerKeepAwakeRef.current = (enabled: boolean) =>
      send({ type: "caffeinate-peer-keep-awake", enabled });
    setCaffeinateBatteryThresholdRef.current = (percent: number | null) =>
      send({ type: "caffeinate-battery-threshold", percent });

    const clearResizeScrollRestore = () => {
      const state = resizeScrollRestoreRef.current;
      if (state) cancelAnimationFrame(state.frameId);
      resizeScrollRestoreRef.current = null;
    };

    const restoreResizeScroll = () => {
      const state = resizeScrollRestoreRef.current;
      if (!state) return;
      restoreTerminalScrollAnchor(terminal, state.anchor);
    };

    const beginResizeScrollRestore = (anchor: TerminalScrollAnchor) => {
      clearResizeScrollRestore();
      const frameId = requestAnimationFrame(() => {
        restoreResizeScroll();
        resizeScrollRestoreRef.current = null;
      });
      resizeScrollRestoreRef.current = { anchor, frameId };
    };

    installTerminalInputHandlers({
      terminal,
      isMac,
      sendInput,
      getHasForegroundProcess: tabOutputActivity.getHasForegroundProcess,
      getKittyFlags,
      getKeyboardShortcuts: () => keyboardShortcutsRef.current,
      getLocalEcho: () => localEchoRef.current,
      onOpenNewShell: () => openNewShellRef.current?.(),
      onToggleCommandPalette: () => toggleCommandPaletteRef.current?.(),
      onToggleAutomations: () => toggleAutomationsRef.current?.(),
      onOpenDiffViewer: () => openDiffViewerRef.current?.(),
      onCreateWorktree: () => void createWorktreeRef.current?.({}, true),
      onToggleWorktrees: () => toggleWorktreesRef.current?.(),
      onToggleSessions: () => toggleSessionsRef.current?.(),
      onTogglePorts: () => togglePortsRef.current?.(),
      onToggleSecrets: () => toggleSecretsRef.current?.(),
      onOpenSearch: () => openSearchOverlayRef.current?.(),
    });

    const applyIncomingTitle = (rawTitle: string) => {
      if (sessionLifecycle.getExited()) return;
      const trimmed = rawTitle.trim();
      if (!trimmed) return;
      lastTitle = trimmed;
      document.title = titleForLiveSession(trimmed);
    };

    refocusTerminalRef.current = refocusTerminalQuietly;
    // Routes through the normal paste pipeline (bracketed paste when the
    // foreground app enables it), so multi-line text lands in the prompt
    // without executing.
    pasteToTerminalRef.current = (text) => terminal.paste(text);

    const sendResize = (cols: number, rows: number) => {
      const terminalInternals = terminal as unknown as {
        _core: {
          _renderService: {
            dimensions: { css: { canvas: { width: number; height: number } } };
          };
        };
      };
      const canvasWidth = terminalInternals._core._renderService?.dimensions?.css?.canvas?.width;
      const canvasHeight = terminalInternals._core._renderService?.dimensions?.css?.canvas?.height;
      // Report the viewer's natural cols, not the grid clamped to the active
      // viewer's PTY width. The server retains every client's available size
      // so a focus or input handoff can resize to it immediately. Rows are
      // unclamped, so the passed rows are already the natural height.
      send({
        type: "resize",
        cols: naturalColsRef.current ?? cols,
        rows,
        ...(canvasWidth != null && canvasHeight != null
          ? { pixelWidth: Math.round(canvasWidth), pixelHeight: Math.round(canvasHeight) }
          : {}),
      });
    };

    const fitToContainer = () => {
      const resizeScrollAnchor = captureTerminalScrollAnchor(terminal);
      // Skip the resize ping when fit() bailed out (unmeasured container) — sending
      // the previous cols/rows would briefly desync the PTY until the next observer tick.
      if (!fitTerminalPreservingScroll(terminal, fitAddon)) return;
      beginResizeScrollRestore(resizeScrollAnchor);
      sendResize(terminal.cols, terminal.rows);
    };

    const scheduleFit = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        fitToContainer();
      }, RESIZE_DEBOUNCE_MS);
    };

    const localEcho = new LocalEcho({
      terminal,
      send: sendInput,
      isSafeState: () =>
        !tabOutputActivity.getHasForegroundProcess() && terminal.buffer.active.type === "normal",
    });
    localEcho.setEnabled(activeLocalEchoRef.current);
    localEchoRef.current = localEcho;

    let activeOutputSession: TerminalOutputSession | null = null;
    const createOutputSession = (onOverflow: () => void) =>
      createTerminalOutputSession({
        onOverflow,
        onOutput: (bytes) => {
          outputBatcher.pushBytes(localEcho.hasPending() ? localEcho.reconcile(bytes) : bytes);
          tabOutputActivity.noteOutputActivity();
        },
        onReplay: (chunks, onComplete) => {
          for (let index = 0; index < chunks.length; index += 1) {
            terminal.write(chunks[index], index === chunks.length - 1 ? onComplete : undefined);
          }
        },
        onReplayComplete: updateScrollbar,
      });

    let nextTerminalDataIsUserInput = false;
    const terminalUserInputDisposable = subscribeTerminalUserInput(terminal, () => {
      nextTerminalDataIsUserInput = true;
    });
    const terminalDataDisposable = terminal.onData((data) => {
      const isUserInput = terminalUserInputDisposable === null || nextTerminalDataIsUserInput;
      nextTerminalDataIsUserInput = false;
      // During a scrollback replay xterm re-emits responses to the stale query
      // requests in the ring buffer; dropping them here (instead of forwarding
      // to the live PTY) is the bounded fix for the switch-time leak. User
      // keystrokes share onData and are dropped too, but the replay drain is
      // short (a screenful parses inside xterm's 12ms synchronous budget) and
      // the user is not typing in the moment after a switch.
      if (activeOutputSession?.isSuppressingOutput()) return;
      for (const chunk of chunkInputByCodeUnits(data, MAX_INPUT_BYTES)) {
        if (isUserInput) localEcho.handleInput(chunk);
        else send({ type: "terminal-response", data: chunk });
      }
    });
    terminal.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
      updateScrollbar();
    });

    const observer = new ResizeObserver(scheduleFit);
    const handleWindowFocus = () => sendClientFocus(true);
    const handleWindowBlur = () => sendClientFocus(false);
    const handlePointerDown = () => sendClientFocus(true);
    const onVisibilityChange = () => {
      tabOutputActivity.handleVisibilityChange();
      sendClientFocus(document.visibilityState === "visible" && document.hasFocus());
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("pointerdown", handlePointerDown, true);

    observer.observe(container);
    fitToContainer();
    if (!onScreenKeyboardOpenRef.current) requestAnimationFrame(refocusTerminalQuietly);

    const showDeadSessionMask = (exitCode: number | null) => {
      if (disposed) return;
      tabOutputActivity.reset();
      setForegroundProcess(null);
      setTabFaviconState("dead");
      terminal.write(formatShellExitMarker(exitCode));
      document.title = titleForDeadSession(lastTitle);
      setExitInfo({ reason: "shell-exited", exitCode });
      setSessionInfo(null);
    };
    const markShellDead = (exitCode: number | null) => {
      if (!sessionLifecycle.markShellDead()) return;
      if (exitCode !== null && exitCode !== 0) {
        // Non-zero exit — surface immediately. The server's onExit deliberately
        // skips closeTab on non-clean codes so the tab stays as the failure mask.
        showDeadSessionMask(exitCode);
        return;
      }
      const settleAndMask = () => {
        window.close();
        setTimeout(() => showDeadSessionMask(exitCode), SHELL_CLOSE_MASK_DELAY_MS);
      };
      if (sessionLifecycle.getCdpControlled()) {
        // CDP-controlled tab: defer window.close() (and the mask) so the
        // daemon's server-driven closeTab has time to settle first. closeTab
        // drives the browser's own close path via CDP — reliable where
        // window.close() doesn't (Dia/Arc, or a tab opened by URL rather than
        // via window.open). If the CDP close hasn't landed by the deadline,
        // we fall back to window.close() + the mask so the user still sees
        // what happened.
        setTimeout(settleAndMask, AMBIENT_TAB_CLOSE_DEADLINE_MS);
      } else {
        settleAndMask();
      }
    };

    const markConnectionLost = (closeCode: number, closeReason: string, wasClean: boolean) => {
      if (!sessionLifecycle.markConnectionLost()) return;
      tabOutputActivity.reset();
      setTabFaviconState("dead");
      document.title = titleForDeadSession(lastTitle);
      setExitInfo({ reason: "connection-lost", closeCode, closeReason, wasClean });
      setSessionInfo(null);
      setForegroundProcess(null);
    };

    const connect = () => {
      if (disposed) return;
      const connectionRequest = sessionLifecycle.prepareConnection();
      const nextSocket = new WebSocket(
        buildTerminalWebSocketUrl({
          cwdOverride: liveCwdRef.current,
          sid: connectionRequest.sessionId,
          omitAddressBarSessionId: connectionRequest.shouldSpawnFreshSession,
        }),
      );
      socket = nextSocket;
      activeOutputSession?.dispose();
      const outputSession = createOutputSession(() => {
        if (socket !== nextSocket) return;
        try {
          nextSocket.close(WS_CLOSE_BACKPRESSURE, "output processing backlog");
        } catch {
          return;
        }
      });
      activeOutputSession = outputSession;

      nextSocket.binaryType = "arraybuffer";
      nextSocket.addEventListener("open", () => {
        if (disposed || socket !== nextSocket) return;
        sessionLifecycle.noteConnected();
        wsConnectedRef.current = true;
        setConsecutiveFailures(0);
        sendResize(terminal.cols, terminal.rows);
        sendClientFocus(document.visibilityState === "visible" && document.hasFocus());
        // Ambient tab provenance: echo the CDP-injected token so the server
        // pairs this socket with its CDP target for closeTab on shell exit.
        // Always send — with `token:null` when injection hasn't landed yet —
        // and register a one-shot listener for the 'localterm-token' event the
        // injection dispatches, so we re-identify with the real token when it
        // arrives. Idempotent across reconnects: the {once:true} old listener's
        // `socket !== nextSocket` guard rejects the next socket.
        send({ type: "identify", token: readTabToken() ?? null });
        window.addEventListener(
          LOCALTERM_TAB_TOKEN_EVENT,
          () => {
            if (disposed || socket !== nextSocket) return;
            send({ type: "identify", token: readTabToken() ?? null });
          },
          { once: true },
        );
      });

      nextSocket.addEventListener("message", (event) => {
        if (disposed || socket !== nextSocket) return;
        // Output frames are raw UTF-8 bytes (binary WebSocket frames) — bypass
        // JSON entirely and hand the bytes straight to the batcher. The server
        // emits every other message type as JSON text, so anything that isn't
        // an ArrayBuffer goes through the schema parser.
        if (isBinaryMessageData(event.data)) {
          outputSession.handleBinaryMessage(event.data);
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        const parsed = serverToClientMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "title") {
          applyIncomingTitle(message.title);
        } else if (message.type === "session") {
          const sessionTransition = sessionLifecycle.handleSession(message.id);
          const { isSwitch, priorSessionId } = sessionTransition;
          outputSession.beginSession();
          localEcho.flush();
          // Drop the prior PTY's effective-viewport mask: the new PTY's size
          // arrives in its own `pty-size` frame, and until it does the mask
          // would otherwise show the old PTY's narrower region over the new one.
          ptySizeRef.current = null;
          setPtySize(null);
          // Unclamp the grid back to the local natural size until the new PTY's
          // pty-size frame re-clamps it (a fresh sole PTY sends no pty-size
          // frame, so without this refit the grid would stay clamped at the
          // prior PTY's effective size). The mask is already cleared above, so
          // the debounced refit can't flash a stale region.
          scheduleFit();
          removeFreshSessionQueryParam();
          // A switch (or a missed reattach that spawned a fresh shell): the
          // new PTY is a different one than the tab was just viewing, so reset
          // the terminal and ask the server to replay its scrollback before
          // live fan-out begins. The replay lands as one binary frame right
          // after this, so the screen shows the PTY's recent output instead
          // of the prior PTY's stale content.
          if (isSwitch) {
            terminal.reset();
            // xterm's reset() (RIS) does not clear coreService.isCursorHidden —
            // only ?25h/?25l/softReset do — so a source PTY that hid the cursor
            // leaves it hidden on the fresh surface. An empty target PTY sends
            // no replay to re-establish its own cursor state, so the cursor stays
            // invisible. Re-assert DECTCEM locally; the replay, if any, overrides
            // with the target's own cursor state, and an empty replay keeps it on.
            terminal.write("\x1b[?25h");
          }
          tabOutputActivity.beginSession({
            foregroundProcess: message.foreground,
            isSwitch,
          });
          setSessionInfo({
            shell: message.shell,
            shellName: message.shellName,
            pid: message.pid,
            cwd: message.cwd,
            title: message.title,
            foreground: message.foreground,
          });
          setLiveCwd(message.cwd);
          applyIncomingTitle(message.title);
          removeRunQueryParam();
          removeInitialCommandQueryParam();
          // Attach handshake: tell the server whether this socket wants the
          // scrollback replay (a switch, or a fresh page load onto a blank
          // surface) or is already caught up (a silent reattach of the same
          // PTY onto a surface that still holds its output). The server holds
          // live fan-out for pending sockets until this lands, so nothing is
          // lost across the gap — it lives in the ring buffer and arrives via
          // the replay. A brand-new spawn has an empty ring buffer, so a
          // fresh-load replay is a no-op there.
          const wantsReplay = isSwitch || priorSessionId === null;
          if (wantsReplay) {
            // Open the suppressed-replay window: buffer the replay frames and
            // drop xterm's responses until `replay-end` writes them as one
            // block. Cleared in the replay-end handler.
            outputSession.beginReplay();
          }
          send({ type: "ready", replay: wantsReplay, compress: COMPRESS_MODE });
        } else if (message.type === "compress") {
          outputSession.setCompressMode(message.mode);
        } else if (message.type === "replay-end") {
          // The server has finished sending the scrollback replay. Write the
          // buffered frames as one block with onData suppressed so xterm's
          // responses to the stale query requests in the ring buffer are
          // dropped instead of forwarded to the live PTY. xterm parses the
          // block asynchronously (its WriteBuffer drains in 12ms chunks), so
          // keep onData suppressed until the drain completes (the write
          // callback) — responses fire during the drain, live output is
          // queued behind it in xterm's FIFO buffer and parses after the
          // callback clears suppression. An empty replay (blank PTY) writes
          // nothing and just clears the window.
          outputSession.finishReplay();
        } else if (message.type === "exit") {
          tabOutputActivity.reset();
          markShellDead(message.code);
        } else {
          dispatchTerminalControlMessage(message, {
            activity: tabOutputActivity,
            callbacks,
            fitToContainer,
            lifecycle: sessionLifecycle,
            liveSessionIdRef,
            ptySizeRef,
            qrPeerAttachedRef,
          });
        }
      });

      nextSocket.addEventListener("close", (event) => {
        outputSession.dispose();
        if (activeOutputSession === outputSession) activeOutputSession = null;
        if (socket !== nextSocket) return;
        socket = null;
        wsConnectedRef.current = false;
        if (disposed) return;
        const closeAction = sessionLifecycle.handleConnectionClose(
          event.code,
          event.reason,
          event.wasClean,
        );
        if (closeAction.type === "ignore") return;
        localEcho.flush();
        if (closeAction.type !== "retry") {
          // Surface close metadata in DevTools so "the terminal randomly dies"
          // reports always come back with a concrete code/reason instead of
          // the previous black-box `null` exit.
          console.warn(
            `[localterm] websocket closed: code=${event.code} reason=${JSON.stringify(event.reason)} wasClean=${event.wasClean}`,
          );
        }
        if (closeAction.type === "reconnect") {
          reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        } else if (closeAction.type === "connection-lost") {
          markConnectionLost(closeAction.closeCode, closeAction.closeReason, closeAction.wasClean);
        } else {
          setConsecutiveFailures((previous) => previous + 1);
          reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });

      nextSocket.addEventListener("error", (event) => {
        console.warn("[localterm] websocket error", event);
        try {
          nextSocket.close();
        } catch {
          /* socket already closing */
        }
      });
    };

    manualReconnectRef.current = () => {
      if (disposed) return;
      sessionLifecycle.beginManualReconnect();
      wsConnectedRef.current = false;
      setExitInfo(null);
      setSessionInfo(null);
      setForegroundProcess(null);
      setConsecutiveFailures(0);
      setTabFaviconState("ready");
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      activeOutputSession?.dispose();
      activeOutputSession = null;
      try {
        socket?.close();
      } catch {
        /* socket already closing */
      }
      socket = null;
      connect();
    };

    // Switch this tab to a different live PTY (from the session picker). The
    // current PTY detaches on the server and stays alive (dormant) so it stays
    // in the picker; the next connect opens against the picked `?sid=`. We
    // reuse the manual-reconnect reset (clear the dead-session mask, drop the
    // stale exit state) and just seed the sid override first — the
    // session-frame handler sees the new id differ from the old one and treats
    // it as a switch (reset terminal + scrollback replay).
    switchSessionRef.current = (sessionId: string) => {
      if (disposed || !sessionLifecycle.requestSessionSwitch(sessionId)) return;
      triggerHapticFeedback(HAPTIC_TAP_MS);
      manualReconnectRef.current?.();
    };

    spawnFreshSessionRef.current = () => {
      if (disposed) return;
      sessionLifecycle.requestFreshSession();
      triggerHapticFeedback(HAPTIC_TAP_MS);
      manualReconnectRef.current?.();
    };

    // Touch-device bare connect: resume the user's most recently active shell
    // instead of spawning a fresh one (the "open my phone, land on my active
    // run" path). Resolved once before the first connect; a transient
    // reconnect or a picker switch reuses the existing liveSessionId /
    // nextConnectSid. Skipped when the URL carries an explicit intent (?sid=
    // attach, ?run= automation, ?fresh= new shell) or the opt-out
    // setting is off. A slow fetch
    // or no live session falls back to a fresh spawn. The desktop + opt-out
    // + explicit-intent paths short-circuit synchronously so the first WS
    // opens on the same tick as before (the component tests assert this) —
    // only an actual touch-device resume defers connect() by one round-trip.
    const shouldAttemptMobileResume =
      detectDeviceTier() !== "desktop" &&
      loadStoredMobileResume() &&
      (() => {
        const params = new URLSearchParams(window.location.search);
        return (
          !params.has(FRESH_SESSION_QUERY_PARAM) &&
          !params.get(SESSION_ID_QUERY_PARAM) &&
          !params.get(RUN_QUERY_PARAM)
        );
      })();
    if (shouldAttemptMobileResume) {
      sessionLifecycle.startInitialMobileResume();
      void (async () => {
        const sessions = await fetchSessions();
        if (disposed) return;
        const resumeSid = sessions === null ? null : resolveResumeSession(sessions);
        if (!sessionLifecycle.completeInitialMobileResume(resumeSid)) return;
        connect();
      })();
    } else {
      connect();
    }
    setTerminalReady(true);

    return () => {
      disposed = true;
      setTerminalReady(false);
      terminalScrollbar.dispose();
      kittyKeyboardProtocol.dispose();
      scrollbackPurgeDisposable.dispose();
      selectiveScrollbackPurgeDisposable.dispose();
      terminalDataDisposable.dispose();
      terminalUserInputDisposable?.dispose();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      clearResizeScrollRestore();
      tabOutputActivity.reset();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      observer.disconnect();
      terminalTouchInteractions.dispose();
      activeOutputSession?.dispose();
      activeOutputSession = null;
      try {
        socket?.close();
      } catch {
        /* socket already closed */
      }
      socket = null;
      localEcho.dispose();
      localEchoRef.current = null;
      terminalSurface.dispose();
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, []);
};
