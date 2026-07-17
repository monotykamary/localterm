import { FitAddon } from "@xterm/addon-fit";

import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OnScreenKeyboard } from "@/components/on-screen-keyboard/on-screen-keyboard";
import { useDaemonSettings } from "@/hooks/use-daemon-settings";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { PR_STATE_ICONS, resolvePrDisplayState } from "@/lib/pr-state";
import { Badge } from "@/components/ui/badge";
import { ToastProvider, Toaster } from "@/components/ui/toast";
import { AmbientActionSearchToolbar } from "@/components/ambient-action-search-toolbar";
import { ConnectionStatusDialog } from "@/components/connection-status-dialog";
import { type CaffeinateMode } from "@/components/keep-awake-menu";
import { TerminalOverlays } from "@/components/terminal-overlays";
import { useGitBranchInfo } from "@/hooks/use-git-branch-info";
import { useGitDiffSummary } from "@/hooks/use-git-diff-summary";
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
import { useTerminalCommandPalette } from "@/hooks/use-terminal-command-palette";
import { useTerminalImagePaste } from "@/hooks/use-terminal-image-paste";
import { useTerminalOnScreenKeyboard } from "@/hooks/use-terminal-on-screen-keyboard";
import { useTerminalOverlayControls } from "@/hooks/use-terminal-overlay-controls";
import { useTerminalRuntime, type TerminalExitInfo } from "@/hooks/use-terminal-runtime";
import { useTerminalSearch } from "@/hooks/use-terminal-search";
import { useTerminalSettings } from "@/hooks/use-terminal-settings";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { createGitWorktree, type CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";
import {
  COPY_FEEDBACK_MS,
  DISCONNECT_MODAL_THRESHOLD_FAILURES,
  FALLBACK_TERMINAL_BACKGROUND_HEX,
  HAPTIC_TAP_MS,
  RECONNECT_FAST_POLL_DURATION_MS,
  RECONNECT_FAST_POLL_INTERVAL_MS,
  RECONNECT_POLL_INTERVAL_MS,
  RESTART_COMMAND,
  RETRY_BUTTON_FEEDBACK_MS,
} from "@/lib/constants";
import { type AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";

import { triggerHapticFeedback } from "@/utils/haptic-feedback";

import { detectIsMacPlatform } from "@/utils/detect-is-mac-platform";
import { detectLikelyKeepAwakeSupported } from "@/utils/detect-likely-keep-awake-supported";
import { shellQuoteArg } from "@/utils/shell-quote-arg";
import { buildFileUrl } from "@/utils/build-file-url";

import { LocalEcho } from "@/lib/local-echo";
import { isCoarsePointer } from "@/utils/is-coarse-pointer";
import { buildNewTerminalTabUrl } from "@/utils/build-new-terminal-tab-url";
import { CWD_QUERY_PARAM } from "@/utils/build-terminal-websocket-url";

import { probeServerHealth } from "@/utils/probe-server-health";

import { computePtyViewportOverlay } from "@/utils/compute-pty-viewport-overlay";

import { isHerdrProcess } from "@/utils/is-herdr-process";

import { isLightTerminalTheme } from "@/utils/is-light-terminal-theme";

import "@xterm/xterm/css/xterm.css";

export const Terminal = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  // The terminal surface (xterm's positioned parent) — anchors the pty-viewport
  // mask so it can be positioned off the live `.xterm-screen` rect in the
  // surface's coordinate space.
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  // The active viewer's effective PTY cols/rows reported by the server, or
  // null until the first `pty-size` frame lands (and cleared on
  // every session frame so a switch never inherits the prior PTY's mask).
  const [ptySize, setPtySize] = useState<{ cols: number; rows: number } | null>(null);
  // ptySize as a ref so the proposeDimensions closure (set once at terminal
  // creation) can read the live effective size and clamp the local grid to it.
  const ptySizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // The local viewer's natural cols (the viewport's width in cells, ignoring
  // the active viewer's width), stashed by proposeDimensions so sendResize
  // can report it to the server and the overlay can gate the mask on it. Each
  // viewer reports its natural cols so the server can resize immediately when
  // focus or input hands PTY ownership to that viewer. The grid reflow is a
  // purely local render concern the server never sees.
  const naturalColsRef = useRef<number | null>(null);
  // Bumped on any resize/layout change so the pty-viewport overlay recomputes
  // against the freshly-measured `.xterm-screen` rect. ptySize alone only
  // covers the effective size changing; this covers the local grid/cells moving
  // (window resize, font, padding, fit).
  const [ptyViewportVersion, setPtyViewportVersion] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);
  const manualReconnectRef = useRef<(() => void) | null>(null);
  const switchSessionRef = useRef<((sid: string) => void) | null>(null);
  const spawnFreshSessionRef = useRef<(() => void) | null>(null);
  const openNewShellRef = useRef<(() => void) | null>(null);
  const liveSessionIdRef = useRef<string | null>(null);
  // The session this tab was viewing immediately before the current one — the
  // "last switched" shell. Recorded on every switch so the session picker can
  // open with it highlighted for an alt-tab-style Enter quick-switch.
  const previousSessionIdRef = useRef<string | null>(null);
  const refocusTerminalRef = useRef<(() => void) | null>(null);
  const pasteToTerminalRef = useRef<((text: string) => void) | null>(null);
  const retryFeedbackTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const localEchoRef = useRef<LocalEcho | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
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
    activeThemeId,
    activeFontId,
    activeNerdFontEnabled,
    activeLigaturesEnabled,
    activeMuteEmojiColors,
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
    handleMuteEmojiColorsChange,
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
  } = useTerminalSettings({
    terminalRef,
    fitAddonRef,
    webglAddonRef,
    terminalReady,
    localEchoRef,
  });
  const openSearchOverlayRef = useRef<(() => void) | null>(null);
  const openDiffViewerRef = useRef<(() => void) | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const [exitInfo, setExitInfo] = useState<TerminalExitInfo | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [hasCopiedRestartCommand, setHasCopiedRestartCommand] = useState(false);
  const [isRetryingConnection, setIsRetryingConnection] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const toggleCommandPaletteRef = useRef<(() => void) | null>(null);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [isKeepAwakePopoverOpen, setIsKeepAwakePopoverOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const {
    cdpPort,
    graceSeconds,
    workspaceRestore,
    detectedDefaultShell,
    cdpStatus,
    cdpConnecting,
    handleCdpPortChange,
    handleGraceSecondsChange,
    handleWorkspaceRestoreChange,
    handleCdpConnect,
    handleOpenInspect,
    loadDaemonSettings,
  } = useDaemonSettings();
  const [automations, setAutomations] = useState<AutomationWithNextRun[] | null>(null);
  const toggleAutomationsRef = useRef<(() => void) | null>(null);
  const [isWorktreesOpen, setIsWorktreesOpen] = useState(false);
  const [worktreeCreateError, setWorktreeCreateError] = useState<string | null>(null);
  const [isPortsOpen, setIsPortsOpen] = useState(false);
  const [isSecretsOpen, setIsSecretsOpen] = useState(false);
  const openWorktreesRef = useRef<(() => void) | null>(null);
  const toggleWorktreesRef = useRef<(() => void) | null>(null);
  const togglePortsRef = useRef<(() => void) | null>(null);
  const toggleSessionsRef = useRef<(() => void) | null>(null);
  const toggleSecretsRef = useRef<(() => void) | null>(null);
  const createWorktreeRef = useRef<
    ((options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>) | null
  >(null);
  const setCaffeinateModeRef = useRef<((mode: CaffeinateMode) => void) | null>(null);
  const setCaffeinateCommandsRef = useRef<((commands: string[]) => void) | null>(null);
  const setCaffeinateActivityGateRef = useRef<((enabled: boolean) => void) | null>(null);
  const setCaffeinatePeerKeepAwakeRef = useRef<((enabled: boolean) => void) | null>(null);
  const setCaffeinateBatteryThresholdRef = useRef<((percent: number | null) => void) | null>(null);
  const toolbarHoverTimeoutRef = useRef<number | null>(null);
  const qrPeerAttachedRef = useRef<(() => void) | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isTouchDevice = useMemo(() => isCoarsePointer(), []);
  const deviceTier = useDeviceTier();
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const {
    isOnScreenKeyboardOpen,
    onScreenKeyboardHeight,
    onScreenKeyboardOpenRef,
    setOnScreenKeyboardHeight,
    refocusTerminal,
    closeOnScreenKeyboard,
    dismissOnScreenKeyboard,
    openOnScreenKeyboard,
    toggleOnScreenKeyboard,
  } = useTerminalOnScreenKeyboard({
    containerRef,
    rootRef,
    terminalRef,
    refocusTerminalRef,
    deviceTier,
    isTouchDevice,
    setIsActionsMenuOpen,
  });
  // On touch the expanded action toolbar dismisses on a tap landing outside
  // itself, replacing the dedicated overlay layer. The settings and keep-awake
  // popovers portal to <body> and own their own outside-tap dismissal, so while
  // either is open we defer to it — collapsing the toolbar would yank the
  // popover's anchor, whose trigger lives in the collapsing grid.
  useEffect(() => {
    if (!isTouchDevice || !isActionsMenuOpen) return;
    const handleOutsidePress = (event: PointerEvent) => {
      if (isSettingsOpen || isKeepAwakePopoverOpen) return;
      const toolbar = toolbarRef.current;
      if (toolbar && event.target instanceof Node && toolbar.contains(event.target)) return;
      setIsActionsMenuOpen(false);
    };
    window.addEventListener("pointerdown", handleOutsidePress, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePress, true);
  }, [isTouchDevice, isActionsMenuOpen, isSettingsOpen, isKeepAwakePopoverOpen]);
  // xterm's onResize covers grid/cell changes, but a container resize that
  // doesn't change cols (a sub-cell-width tweak, a safe-area inset shift) still
  // moves the `.xterm-screen` rect the pty-viewport mask is anchored to. Watch
  // the surface so those re-measure too.
  useEffect(() => {
    const surface = terminalSurfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(() => setPtyViewportVersion((version) => version + 1));
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);
  const isToolbarVisible =
    isToolbarHovered ||
    isActionsMenuOpen ||
    isSettingsOpen ||
    isAutomationsOpen ||
    isKeepAwakePopoverOpen ||
    isSessionsOpen ||
    isWorktreesOpen ||
    isPortsOpen ||
    isQrOpen ||
    isSecretsOpen;
  const [sessionInfo, setSessionInfo] = useState<TerminalSessionInfo | null>(null);
  const [notificationsPermission, setNotificationsPermission] = useState<
    NotificationPermission | "unsupported"
  >("Notification" in window ? Notification.permission : "unsupported");
  const [liveCwd, setLiveCwd] = useState<string | null>(null);
  const [foregroundProcess, setForegroundProcess] = useState<string | null>(null);
  const liveCwdRef = useRef<string | null>(null);
  const wsConnectedRef = useRef(false);
  const isMac = useMemo(detectIsMacPlatform, []);
  const {
    searchAddonRef,
    searchInputRef,
    isSearchOpen,
    searchQuery,
    searchResults,
    setSearchResults,
    openSearch,
    closeSearch,
    findNextMatch,
    findPreviousMatch,
    handleSearchInputChange,
    handleSearchKeyDown,
    matchLabel,
  } = useTerminalSearch({ isMac, refocusTerminalRef });
  // Keep-awake (caffeinate) is daemon-owned global state: the server is the
  // source of truth for the mode, the live process state, and the trigger
  // commands, and broadcasts changes to every tab. Seed `supported` from the
  // client platform (macOS/Linux, where keep-awake has an implementation) and
  // `mode` from the server default ("automatic") so the control doesn't flash
  // in before the first WS frame. The server's authoritative `supported`
  // overwrites this seed on the first `{type:"caffeinate"}` frame.
  const [caffeinateSupported, setCaffeinateSupported] = useState(detectLikelyKeepAwakeSupported);
  const [caffeinateActive, setCaffeinateActive] = useState(false);
  const [caffeinatePeerActive, setCaffeinatePeerActive] = useState(false);
  const [caffeinateMode, setCaffeinateMode] = useState<CaffeinateMode>("automatic");
  const [caffeinateDefaultCommands, setCaffeinateDefaultCommands] = useState<string[]>([]);
  const [caffeinateCommands, setCaffeinateCommands] = useState<string[]>([]);
  const [caffeinateActivityGate, setCaffeinateActivityGate] = useState(true);
  // Default on (the server's authoritative peer keep-awake default overwrites
  // this on the first WS frame).
  const [caffeinatePeerKeepAwake, setCaffeinatePeerKeepAwake] = useState(true);
  // Default null = guard off on the client seed; the server's authoritative
  // threshold (which defaults to 20% on) overwrites this on the first WS frame.
  const [caffeinateBatteryThreshold, setCaffeinateBatteryThreshold] = useState<number | null>(null);
  const [caffeinateActiveTrigger, setCaffeinateActiveTrigger] = useState<string | null>(null);
  useScreenWakeLock(caffeinateActive);
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false);
  const { summary: diffSummary, setGitDiffSummary } = useGitDiffSummary();
  const { updateAvailable, latest: latestUpdateVersion } = useUpdateStatus();
  // Bumps every time the server pushes a git-diff-summary from a real git-dirty
  // signal, giving the diff viewer a trigger for near-realtime updates.
  // Starts undefined so the diff viewer doesn't treat the initial render as a
  // dirty signal and re-fetch the file list immediately on open.
  const [gitDirtyVersion, setGitDirtyVersion] = useState<number | undefined>(undefined);
  const hasDiff = diffSummary !== null && diffSummary.isRepo && diffSummary.files > 0;
  // Ambient branch/PR lease for the active cwd: drives the toolbar PR indicator
  // and is handed to the diff viewer so it opens in branch mode instantly.
  const { branchInfo, refresh: refreshBranchInfo, setPushedPr } = useGitBranchInfo(liveCwd);
  const branchPr = branchInfo?.pr ?? null;
  const branchPrDisplayState = useMemo(
    () => (branchPr ? resolvePrDisplayState(branchPr, branchInfo?.currentBranch ?? null) : null),
    [branchPr, branchInfo?.currentBranch],
  );
  const BranchPrIcon = useMemo(
    () => (branchPrDisplayState ? PR_STATE_ICONS[branchPrDisplayState] : null),
    [branchPrDisplayState],
  );
  // Indicators keep the desktop toolbar peeking. Touch leaves the entire
  // ambient overlay absent while the keyboard is down so an underlying mobile
  // app keeps its top-right controls; opening the keyboard restores our actions.
  const isHerdrForeground = isHerdrProcess(foregroundProcess);
  const hasToolbarIndicator = !isHerdrForeground && (hasDiff || branchPrDisplayState !== null);
  const shouldShowAmbientToolbar = isTouchDevice
    ? isOnScreenKeyboardOpen || isToolbarVisible
    : isToolbarVisible || hasToolbarIndicator;
  const shouldShowGitMetadata = !isHerdrForeground || shouldShowAmbientToolbar;
  const shouldEnableAmbientToolbarPointerEvents = shouldShowAmbientToolbar || isSearchOpen;
  const shouldShowToolbarHandle =
    !isTouchDevice && !isToolbarVisible && !isSearchOpen && !hasToolbarIndicator;

  // Rectangle of the dead columns beyond the active viewer's PTY viewport,
  // in the terminal surface's coordinate space. Recomputes when a `pty-size`
  // frame changes the effective size or the local grid moves. Null when there is
  // no frame, the effective PTY is at least as wide, or the terminal cannot be
  // measured.
  const ptyViewportOverlay = useMemo(() => {
    const terminal = terminalRef.current;
    const surface = terminalSurfaceRef.current;
    if (!terminal || !surface || !ptySize) return { right: null };
    const localCols = naturalColsRef.current;
    if (!localCols) return { right: null };
    return computePtyViewportOverlay({
      terminal,
      effectiveCols: ptySize.cols,
      localCols,
      paddingX: activePaddingX,
      origin: surface.getBoundingClientRect(),
    });
  }, [ptySize, ptyViewportVersion, terminalReady, activePaddingX]);

  // A `git checkout` keeps the same cwd, so the cwd-keyed lease wouldn't notice.
  // The ambient summary carries the live branch; when it diverges from the branch
  // the lease was fetched under, re-lease so the PR indicator tracks the branch.
  const summaryBranch = diffSummary?.branch ?? null;
  useEffect(() => {
    if (!branchInfo || !summaryBranch) return;
    if (summaryBranch !== branchInfo.currentBranch) refreshBranchInfo();
  }, [summaryBranch, branchInfo, refreshBranchInfo]);

  useTerminalRuntime({
    refs: {
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
    },
    actionRefs: {
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
    },
    initialSettings: {
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
    },
    callbacks: {
      setPtySize,
      setPtyViewportVersion,
      setTerminalReady,
      setExitInfo,
      setConsecutiveFailures,
      setSessionInfo,
      setLiveCwd,
      setForegroundProcess,
      setSearchResults,
      setAutomations,
      setCaffeinateSupported,
      setCaffeinateActive,
      setCaffeinatePeerActive,
      setCaffeinateMode,
      setCaffeinateDefaultCommands,
      setCaffeinateCommands,
      setCaffeinateActivityGate,
      setCaffeinatePeerKeepAwake,
      setCaffeinateBatteryThreshold,
      setCaffeinateActiveTrigger,
      setGitDiffSummary,
      setGitDirtyVersion,
      setPushedPr,
      applyThemesState,
      applyFontsState,
    },
    isMac,
    isTouchDevice,
    openOnScreenKeyboard,
  });

  const handleNotificationsPermissionRequest = useCallback(() => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then((result) => {
      setNotificationsPermission(result);
    });
  }, []);

  // Server-authoritative: we only request the change and let the broadcast
  // update every tab's control, so all open tabs stay in lockstep.
  const handleCaffeinateModeChange = useCallback((mode: CaffeinateMode) => {
    setCaffeinateModeRef.current?.(mode);
  }, []);

  const handleCaffeinateCommandsChange = useCallback((commands: string[]) => {
    setCaffeinateCommandsRef.current?.(commands);
  }, []);

  const handleCaffeinateActivityGateChange = useCallback((enabled: boolean) => {
    setCaffeinateActivityGateRef.current?.(enabled);
  }, []);

  const handleCaffeinatePeerKeepAwakeChange = useCallback((enabled: boolean) => {
    setCaffeinatePeerKeepAwakeRef.current?.(enabled);
  }, []);

  const handleCaffeinateBatteryThresholdChange = useCallback((percent: number | null) => {
    setCaffeinateBatteryThresholdRef.current?.(percent);
  }, []);

  const {
    handleAutomationsOpenChange,
    handleKeepAwakePopoverOpenChange,
    handlePortsOpenChange,
    handleQrOpenChange,
    handleSecretsOpenChange,
    handleSessionsOpenChange,
    handleSettingsOpenChange,
    handleToolbarAreaEnter,
    handleToolbarAreaLeave,
    handleWorktreesOpenChange,
    openWorktrees,
    toggleAutomations,
    togglePorts,
    toggleSecrets,
    toggleSessions,
    toggleWorktrees,
  } = useTerminalOverlayControls({
    isAutomationsOpen,
    isPortsOpen,
    isSecretsOpen,
    isSessionsOpen,
    isSettingsOpen,
    isWorktreesOpen,
    loadDaemonSettings,
    refocusTerminalRef,
    setIsActionsMenuOpen,
    setIsAutomationsOpen,
    setIsCommandPaletteOpen,
    setIsKeepAwakePopoverOpen,
    setIsPortsOpen,
    setIsQrOpen,
    setIsSecretsOpen,
    setIsSessionsOpen,
    setIsSettingsOpen,
    setIsToolbarHovered,
    setIsWorktreesOpen,
    setWorktreeCreateError,
    toolbarHoverTimeoutRef,
  });
  toggleAutomationsRef.current = toggleAutomations;
  openWorktreesRef.current = openWorktrees;
  toggleWorktreesRef.current = toggleWorktrees;
  toggleSessionsRef.current = toggleSessions;
  togglePortsRef.current = togglePorts;
  toggleSecretsRef.current = toggleSecrets;

  const openShellAt = useCallback((shellCwd: string, command?: string) => {
    window.open(buildNewTerminalTabUrl(shellCwd, command), "_blank", "noopener,noreferrer");
  }, []);

  // Create a worktree on a fresh branch (or `pr-<N>`), then (when openAfter) open
  // a new PTY tab at it and switch over. When the repo has a setup script it is
  // run as the new tab's initial command, so env copy / installs happen in the
  // right shell, visibly, before the prompt returns. Failures surface by opening
  // the worktrees modal with the message shown in its footer, regardless of
  // entry point. The modal `+` button calls this with openAfter=false (create +
  // refresh the list, no tab switch); the command palette and the Shift shortcut
  // call it with openAfter=true.
  const createWorktree = useCallback(
    async (options: CreateWorktreeOptions, openAfter: boolean): Promise<boolean> => {
      if (!liveCwd) return false;
      const result = await createGitWorktree(liveCwd, options);
      if (!result.ok) {
        setWorktreeCreateError(result.message);
        setIsWorktreesOpen(true);
        return false;
      }
      setWorktreeCreateError(null);
      if (openAfter) {
        openShellAt(result.result.path, result.result.setupCommand ?? undefined);
      }
      return true;
    },
    [liveCwd, openShellAt],
  );
  createWorktreeRef.current = createWorktree;

  const toggleCommandPalette = useCallback(() => {
    setIsActionsMenuOpen(false);
    setIsCommandPaletteOpen((previous) => !previous);
  }, []);
  toggleCommandPaletteRef.current = toggleCommandPalette;

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    refocusTerminalRef.current?.();
  }, []);

  const openSearchOverlay = useCallback(() => {
    openSearch();
    setIsActionsMenuOpen(false);
    setIsCommandPaletteOpen(false);
  }, [openSearch]);
  openSearchOverlayRef.current = openSearchOverlay;

  const openDiffViewer = useCallback(() => {
    setIsDiffViewerOpen(true);
    setIsActionsMenuOpen(false);
    setIsCommandPaletteOpen(false);
  }, []);
  openDiffViewerRef.current = openDiffViewer;

  // The mobile chevron is the sole toggle for the action toolbar now that the
  // diff/PR indicators open the diff viewer directly. A light tap haptic
  // confirms the press on devices that support navigator.vibrate.
  const toggleActionsMenu = useCallback(() => {
    triggerHapticFeedback(HAPTIC_TAP_MS);
    setIsActionsMenuOpen((previous) => !previous);
  }, []);

  const closeDiffViewer = useCallback(() => {
    setIsDiffViewerOpen(false);
    refocusTerminalRef.current?.();
  }, []);

  const sendDiffReviewToTerminal = useCallback((text: string) => {
    pasteToTerminalRef.current?.(text);
  }, []);

  const pickAndPasteImage = useTerminalImagePaste({
    containerRef,
    liveSessionIdRef,
    pasteToTerminalRef,
    setIsActionsMenuOpen,
  });

  const triggerManualReconnect = useCallback(() => {
    setIsRetryingConnection(true);
    manualReconnectRef.current?.();
    if (retryFeedbackTimerRef.current !== null) {
      window.clearTimeout(retryFeedbackTimerRef.current);
    }
    retryFeedbackTimerRef.current = window.setTimeout(() => {
      retryFeedbackTimerRef.current = null;
      setIsRetryingConnection(false);
    }, RETRY_BUTTON_FEEDBACK_MS);
  }, []);

  const copyRestartCommand = useCallback(() => {
    void navigator.clipboard
      .writeText(RESTART_COMMAND)
      .then(() => {
        setHasCopiedRestartCommand(true);
        if (copyFeedbackTimerRef.current !== null) {
          window.clearTimeout(copyFeedbackTimerRef.current);
        }
        copyFeedbackTimerRef.current = window.setTimeout(() => {
          copyFeedbackTimerRef.current = null;
          setHasCopiedRestartCommand(false);
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => {
        /* clipboard permission denied; user can still select + copy manually */
      });
  }, []);

  useEffect(() => {
    return () => {
      if (toolbarHoverTimeoutRef.current !== null) {
        window.clearTimeout(toolbarHoverTimeoutRef.current);
        toolbarHoverTimeoutRef.current = null;
      }
      if (retryFeedbackTimerRef.current !== null) {
        window.clearTimeout(retryFeedbackTimerRef.current);
        retryFeedbackTimerRef.current = null;
      }
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, []);

  // Service worker → page: a notification click the SW handled focuses a tab and
  // asks it to switch to the emitting session. Registered at component scope
  // (not inside the WS effect) so it survives reconnects — the SW fires it once
  // per click, independent of the current WebSocket lifecycle.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "focus-session") return;
      const sid = event.data?.sid;
      if (typeof sid !== "string") return;
      switchSessionRef.current?.(sid);
    };
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
    };
  }, []);

  useEffect(() => {
    liveCwdRef.current = liveCwd;
    if (!liveCwd) return;
    const url = new URL(window.location.href);
    const currentCwd = url.searchParams.get(CWD_QUERY_PARAM);
    if (currentCwd === liveCwd) return;
    url.searchParams.set(CWD_QUERY_PARAM, liveCwd);
    try {
      window.history.replaceState(null, "", url);
    } catch {
      /* Safari rate-limits replaceState; not fatal */
    }
  }, [liveCwd]);

  const newShellUrl = buildNewTerminalTabUrl(liveCwd);
  const openNewShell = useCallback(() => {
    if (deviceTier !== "desktop") {
      spawnFreshSessionRef.current?.();
      return;
    }
    window.open(newShellUrl, "_blank", "noopener,noreferrer");
  }, [deviceTier, newShellUrl]);
  openNewShellRef.current = openNewShell;

  const isSessionOver = exitInfo !== null;
  const isDisconnected =
    !isSessionOver && consecutiveFailures >= DISCONNECT_MODAL_THRESHOLD_FAILURES;
  const isModalOpen = isSessionOver || isDisconnected;

  const isConnectionLost = exitInfo !== null && exitInfo.reason !== "shell-exited";
  const shouldAutoReconnect = isConnectionLost || isDisconnected;

  useEffect(() => {
    if (!shouldAutoReconnect) return;
    const reconnectStart = Date.now();
    let cancelled = false;
    let timeoutId: number | null = null;
    const reconnectOrScheduleNext = (healthy: boolean) => {
      if (cancelled) return;
      if (wsConnectedRef.current) return;
      if (healthy) {
        if (terminalRef.current && !onScreenKeyboardOpenRef.current) {
          refocusTerminalRef.current?.();
        }
        manualReconnectRef.current?.();
        return;
      }
      const elapsed = Date.now() - reconnectStart;
      const interval =
        elapsed < RECONNECT_FAST_POLL_DURATION_MS
          ? RECONNECT_FAST_POLL_INTERVAL_MS
          : RECONNECT_POLL_INTERVAL_MS;
      timeoutId = window.setTimeout(tick, interval);
    };
    const tick = () => {
      void probeServerHealth().then(reconnectOrScheduleNext);
    };
    tick();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [shouldAutoReconnect]);

  useEffect(() => {
    if (isModalOpen) {
      setIsCommandPaletteOpen(false);
      setIsDiffViewerOpen(false);
      setIsAutomationsOpen(false);
      setIsWorktreesOpen(false);
    }
  }, [isModalOpen]);
  const pageBackground = effectiveTheme.colors.background ?? FALLBACK_TERMINAL_BACKGROUND_HEX;
  const syntaxHighlightColorScheme = isLightTerminalTheme(effectiveTheme) ? "light" : "dark";

  const { commandPaletteCommands, handleCommandPaletteHighlight } = useTerminalCommandPalette({
    activeCursorBlink,
    activeCursorStyle,
    activeFontId,
    activeFontSize,
    activeLocalEcho,
    activeScrollOnUserInput,
    activeThemeId,
    caffeinateMode,
    caffeinateSupported,
    createWorktree,
    handleAutomationsOpenChange,
    handleCaffeinateModeChange,
    handleCursorBlinkChange,
    handleCursorStyleChange,
    handleFontChange,
    handleFontSizeChange,
    handleLocalEchoChange,
    handlePortsOpenChange,
    handleScrollOnUserInputChange,
    handleSecretsOpenChange,
    handleSessionsOpenChange,
    handleThemeChange,
    handleWorktreesOpenChange,
    isMac,
    openDiffViewer,
    openNewShell,
    openSearchOverlay,
    setPreviewCursorStyle,
    setPreviewFontId,
    setPreviewThemeId,
  });

  return (
    <div
      ref={rootRef}
      className="h-dvh w-dvw"
      style={{
        background: pageBackground,
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        paddingBottom:
          onScreenKeyboardHeight > 0
            ? onScreenKeyboardHeight + "px"
            : "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
      }}
    >
      <div data-terminal-surface ref={terminalSurfaceRef} className="relative h-full w-full">
        <div
          ref={containerRef}
          aria-label="terminal session"
          className="absolute"
          style={{
            top: activePaddingY,
            right: activePaddingX,
            bottom: activePaddingY,
            left: activePaddingX,
          }}
        />
        {ptyViewportOverlay.right ? (
          <div
            aria-hidden="true"
            className="xterm-pty-viewport-mask"
            style={{
              left: ptyViewportOverlay.right.left,
              top: ptyViewportOverlay.right.top,
              width: ptyViewportOverlay.right.width,
              height: ptyViewportOverlay.right.height,
              borderLeft: "1px solid var(--pty-viewport-edge)",
            }}
          />
        ) : null}
        <div
          ref={scrollbarTrackRef}
          className="xterm-scrollbar-track"
          style={{
            top: activePaddingY,
            right: activePaddingX,
            bottom: activePaddingY,
          }}
        >
          <div ref={scrollbarThumbRef} className="xterm-scrollbar-thumb" />
        </div>
        {exitInfo !== null ? (
          <Badge
            variant="destructive"
            role="status"
            aria-live="polite"
            className="absolute top-2 left-3 z-10"
          >
            {exitInfo.reason === "shell-exited"
              ? exitInfo.exitCode === null
                ? "exited"
                : `exited · code ${exitInfo.exitCode}`
              : `disconnected · code ${exitInfo.closeCode}`}
          </Badge>
        ) : null}
        <AmbientActionSearchToolbar
          toolbarRef={toolbarRef}
          display={{
            deviceTier,
            isActionsMenuOpen,
            isOnScreenKeyboardOpen,
            isSearchOpen,
            isTouchDevice,
            isToolbarVisible,
            shouldEnablePointerEvents: shouldEnableAmbientToolbarPointerEvents,
            shouldShowAmbientToolbar,
            shouldShowGitMetadata,
            shouldShowToolbarHandle,
          }}
          actions={{
            onAutomationsOpen: () => handleAutomationsOpenChange(true),
            onCloseOnScreenKeyboard: closeOnScreenKeyboard,
            onCommandPaletteToggle: () => toggleCommandPaletteRef.current?.(),
            onMouseEnter: handleToolbarAreaEnter,
            onMouseLeave: handleToolbarAreaLeave,
            onPasteImage: pickAndPasteImage,
            onPortsOpen: () => handlePortsOpenChange(true),
            onQrOpen: () => handleQrOpenChange(true),
            onRefocusTerminal: () => refocusTerminalRef.current?.(),
            onSecretsOpen: () => handleSecretsOpenChange(true),
            onSessionsOpen: () => handleSessionsOpenChange(true),
            onToggleActionsMenu: toggleActionsMenu,
            onToggleOnScreenKeyboard: toggleOnScreenKeyboard,
            onWorktreesOpen: () => handleWorktreesOpenChange(true),
          }}
          gitMetadata={{
            branchPr,
            branchPrDisplayState,
            BranchPrIcon,
            diffSummary,
            hasDiff,
            hasToolbarIndicator,
            isMac,
            onOpenDiffViewer: openDiffViewer,
          }}
          search={{
            inputRef: searchInputRef,
            matchLabel,
            onClose: closeSearch,
            onFindNext: findNextMatch,
            onFindPrevious: findPreviousMatch,
            onInputChange: handleSearchInputChange,
            onKeyDown: handleSearchKeyDown,
            onOpen: openSearchOverlay,
            query: searchQuery,
            resultCount: searchResults.resultCount,
          }}
          settingsMenu={{
            themeId: activeThemeId,
            onThemeChange: handleThemeChange,
            onThemePreview: setPreviewThemeId,
            customThemes: activeCustomThemes,
            onImportTheme: handleImportTheme,
            onDeleteTheme: handleDeleteCustomTheme,
            fontId: activeFontId,
            onFontChange: handleFontChange,
            onFontPreview: setPreviewFontId,
            customFontFamily: activeCustomFontFamily,
            onCustomFontFamilyChange: handleCustomFontFamilyChange,
            nerdFontEnabled: activeNerdFontEnabled,
            onNerdFontEnabledChange: handleNerdFontEnabledChange,
            ligaturesEnabled: activeLigaturesEnabled,
            onLigaturesEnabledChange: handleLigaturesEnabledChange,
            muteEmojiColors: activeMuteEmojiColors,
            onMuteEmojiColorsChange: handleMuteEmojiColorsChange,
            fontSize: activeFontSize,
            onFontSizeChange: handleFontSizeChange,
            lineHeight: activeLineHeight,
            onLineHeightChange: handleLineHeightChange,
            cursorStyle: activeCursorStyle,
            onCursorStyleChange: handleCursorStyleChange,
            onCursorStylePreview: setPreviewCursorStyle,
            cursorBlink: activeCursorBlink,
            onCursorBlinkChange: handleCursorBlinkChange,
            localEcho: activeLocalEcho,
            onLocalEchoChange: handleLocalEchoChange,
            mobileResume: activeMobileResume,
            onMobileResumeChange: handleMobileResumeChange,
            scrollback: activeScrollback,
            onScrollbackChange: handleScrollbackChange,
            scrollOnUserInput: activeScrollOnUserInput,
            onScrollOnUserInputChange: handleScrollOnUserInputChange,
            cdpPort,
            cdpStatus,
            cdpConnecting,
            onCdpPortChange: handleCdpPortChange,
            onCdpConnect: handleCdpConnect,
            onOpenInspect: handleOpenInspect,
            graceSeconds,
            onGraceSecondsChange: handleGraceSecondsChange,
            workspaceRestore,
            onWorkspaceRestoreChange: handleWorkspaceRestoreChange,
            paddingX: activePaddingX,
            onPaddingXChange: handlePaddingXChange,
            paddingY: activePaddingY,
            onPaddingYChange: handlePaddingYChange,
            defaultCwd: activeDefaultCwd,
            onDefaultCwdChange: handleDefaultCwdChange,
            defaultShell: activeDefaultShell,
            onDefaultShellChange: handleDefaultShellChange,
            detectedDefaultShell,
            notificationsPermission,
            onNotificationsPermissionRequest: handleNotificationsPermissionRequest,
            sessionInfo,
            updateAvailable,
            latestVersion: latestUpdateVersion,
            onOpenChange: handleSettingsOpenChange,
            onClose: refocusTerminalRef.current ?? undefined,
          }}
          keepAwakeMenu={
            caffeinateSupported
              ? {
                  mode: caffeinateMode,
                  active: caffeinateActive,
                  activityGate: caffeinateActivityGate,
                  peerKeepAwake: caffeinatePeerKeepAwake,
                  peerActive: caffeinatePeerActive,
                  batteryThreshold: caffeinateBatteryThreshold,
                  defaultCommands: caffeinateDefaultCommands,
                  commands: caffeinateCommands,
                  activeTrigger: caffeinateActiveTrigger,
                  onModeChange: handleCaffeinateModeChange,
                  onCommandsChange: handleCaffeinateCommandsChange,
                  onActivityGateChange: handleCaffeinateActivityGateChange,
                  onPeerKeepAwakeChange: handleCaffeinatePeerKeepAwakeChange,
                  onBatteryThresholdChange: handleCaffeinateBatteryThresholdChange,
                  onPopoverOpenChange: handleKeepAwakePopoverOpenChange,
                  onClose: refocusTerminalRef.current ?? undefined,
                }
              : null
          }
        />
      </div>

      <TerminalOverlays
        commandPalette={{
          open: isCommandPaletteOpen,
          onClose: closeCommandPalette,
          commands: commandPaletteCommands,
          onActiveItemChange: handleCommandPaletteHighlight,
        }}
        diffViewer={{
          open: isDiffViewerOpen,
          cwd: liveCwd,
          syntaxHighlightColorScheme,
          branchInfo,
          gitDirtyVersion,
          onClose: closeDiffViewer,
          onSendToTerminal: sendDiffReviewToTerminal,
          onOpenInEditor: (filePath) => {
            if (!liveCwd) return;
            openShellAt(liveCwd, `nvim ${shellQuoteArg(filePath)} && exit`);
          },
          onOpenImage: (filePath) => {
            if (!liveCwd) return;
            window.open(buildFileUrl(liveCwd, filePath), "_blank", "noopener,noreferrer");
          },
          onRefreshBranchInfo: refreshBranchInfo,
          onDiffSummaryUpdate: setGitDiffSummary,
        }}
        automationsModal={{
          open: isAutomationsOpen,
          onClose: () => handleAutomationsOpenChange(false),
          automations,
          onAutomationsLoaded: setAutomations,
          defaultCwd: liveCwd,
          isMac,
        }}
        worktreesModal={{
          open: isWorktreesOpen,
          cwd: liveCwd,
          isMac,
          createError: worktreeCreateError,
          onCreate: createWorktree,
          onDismissCreateError: () => setWorktreeCreateError(null),
          onClose: () => handleWorktreesOpenChange(false),
          onOpenShell: openShellAt,
        }}
        sessionsModal={{
          open: isSessionsOpen,
          liveSessionIdRef,
          previousSessionIdRef,
          switchSessionRef,
          isTouchDevice,
          onOpenNewShell: openNewShell,
          onClose: () => handleSessionsOpenChange(false),
        }}
        portsModal={{
          open: isPortsOpen,
          isTouchDevice,
          onClose: () => handlePortsOpenChange(false),
        }}
        secretsModal={{
          open: isSecretsOpen,
          onClose: () => handleSecretsOpenChange(false),
        }}
        qrModal={{
          open: isQrOpen,
          liveSessionIdRef,
          switchSessionRef,
          peerAttachedRef: qrPeerAttachedRef,
          onClose: () => handleQrOpenChange(false),
        }}
      />

      <ConnectionStatusDialog
        open={isModalOpen}
        exitInfo={exitInfo}
        hasCopiedRestartCommand={hasCopiedRestartCommand}
        isRetryingConnection={isRetryingConnection}
        onCopyRestartCommand={copyRestartCommand}
        onOpenNewShell={openNewShell}
        onRetryConnection={triggerManualReconnect}
      />
      <ToastProvider>
        <Toaster />
      </ToastProvider>
      {deviceTier !== "desktop" && isOnScreenKeyboardOpen ? (
        <OnScreenKeyboard
          onInput={(data) => {
            sendInputRef.current?.(data);
            refocusTerminal();
          }}
          onAttachImage={pickAndPasteImage}
          onDismiss={dismissOnScreenKeyboard}
          onRefocus={refocusTerminal}
          onHeightChange={setOnScreenKeyboardHeight}
          terminalFontSize={activeFontSize}
          terminalLineHeight={activeLineHeight}
          onTerminalFontSizeChange={handleFontSizeChange}
          onTerminalLineHeightChange={handleLineHeightChange}
          deviceTier={deviceTier}
        />
      ) : null}
    </div>
  );
};
