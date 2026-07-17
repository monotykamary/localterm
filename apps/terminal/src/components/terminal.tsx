
import {FitAddon} from "@xterm/addon-fit";

import {WebglAddon} from "@xterm/addon-webgl";
import {Terminal as XtermTerminal} from "@xterm/xterm";

import {
  Binary,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Command,
  Copy,
  FileDiff,
  FolderGit2,
  ImageIcon,
  Key,
  Keyboard,
  MonitorCog,
  Network,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {OnScreenKeyboard} from "@/components/on-screen-keyboard/on-screen-keyboard";
import {useDaemonSettings} from "@/hooks/use-daemon-settings";
import {useDeviceTier} from "@/hooks/use-device-tier";
import {
  PR_DISPLAY_STATE_LABELS,
  PR_STATE_ICONS,
  PR_STATE_STYLES,
  resolvePrDisplayState,
} from "@/lib/pr-state";
import {cn} from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {Spinner} from "@/components/ui/spinner";
import {ToastProvider, Toaster} from "@/components/ui/toast";
import {AutomationsButton} from "@/components/automations-menu";
import {AutomationsModal} from "@/components/automations-modal";
import {CommandPalette, type CommandItem} from "@/components/command-palette";
import {DiffViewer} from "@/components/diff-viewer";
import {KeepAwakeMenu, type CaffeinateMode} from "@/components/keep-awake-menu";
import {PortsButton} from "@/components/ports-menu";
import {PortsModal} from "@/components/ports-modal";
import {QrButton} from "@/components/qr-button";
import {QrModal} from "@/components/qr-modal";
import {SecretsButton} from "@/components/secrets-menu";
import {SecretsModal} from "@/components/secrets-modal";
import {SessionsButton} from "@/components/sessions-menu";
import {SessionsModal} from "@/components/sessions-modal";
import {SettingsMenu} from "@/components/settings-menu";
import {WorktreesButton} from "@/components/worktrees-menu";
import {WorktreesModal} from "@/components/worktrees-modal";
import {useGitBranchInfo} from "@/hooks/use-git-branch-info";
import {useGitDiffSummary} from "@/hooks/use-git-diff-summary";
import {useScreenWakeLock} from "@/hooks/use-screen-wake-lock";
import {useTerminalImagePaste} from "@/hooks/use-terminal-image-paste";
import {useTerminalOnScreenKeyboard} from "@/hooks/use-terminal-on-screen-keyboard";
import {useTerminalRuntime, type TerminalExitInfo} from "@/hooks/use-terminal-runtime";
import {useTerminalSearch} from "@/hooks/use-terminal-search";
import {useTerminalSettings} from "@/hooks/use-terminal-settings";
import {useUpdateStatus} from "@/hooks/use-update-status";
import {createGitWorktree, type CreateWorktreeOptions} from "@/utils/fetch-git-worktrees";
import {
  COPY_FEEDBACK_MS,
  DISCONNECT_MODAL_THRESHOLD_FAILURES,
  FALLBACK_TERMINAL_BACKGROUND_HEX,
  TERMINAL_FONT_SIZE_STEP_PX,
  HAPTIC_TAP_MS,
  RECONNECT_FAST_POLL_DURATION_MS,
  RECONNECT_FAST_POLL_INTERVAL_MS,
  RECONNECT_POLL_INTERVAL_MS,
  RESTART_COMMAND,
  RETRY_BUTTON_FEEDBACK_MS,
  TOOLBAR_HIDE_DELAY_MS,
  TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS,
} from "@/lib/constants";
import {type AutomationWithNextRun} from "@monotykamary/localterm-server/protocol";
import {TERMINAL_CURSOR_STYLES, isTerminalCursorStyle} from "@/lib/terminal-cursor";
import {TERMINAL_FONTS} from "@/lib/terminal-fonts";
import type {TerminalSessionInfo} from "@/lib/terminal-session-info";
import {TERMINAL_THEMES} from "@/lib/terminal-themes";

import {triggerHapticFeedback} from "@/utils/haptic-feedback";

import {detectIsMacPlatform} from "@/utils/detect-is-mac-platform";
import {detectLikelyKeepAwakeSupported} from "@/utils/detect-likely-keep-awake-supported";
import {formatDiffCount} from "@/utils/format-diff-count";
import {shellQuoteArg} from "@/utils/shell-quote-arg";
import {buildFileUrl} from "@/utils/build-file-url";

import {LocalEcho} from "@/lib/local-echo";
import {isCoarsePointer} from "@/utils/is-coarse-pointer";
import {buildNewTerminalTabUrl} from "@/utils/build-new-terminal-tab-url";
import {CWD_QUERY_PARAM} from "@/utils/build-terminal-websocket-url";

import {probeServerHealth} from "@/utils/probe-server-health";

import {computePtyViewportOverlay} from "@/utils/compute-pty-viewport-overlay";

import {isHerdrProcess} from "@/utils/is-herdr-process";

import {isLightTerminalTheme} from "@/utils/is-light-terminal-theme";

import {ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR} from "@/lib/on-screen-keyboard-selectors";

import "@xterm/xterm/css/xterm.css";

export const Terminal = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  // The terminal surface (xterm's positioned parent) — anchors the pty-viewport
  // mask so it can be positioned off the live `.xterm-screen` rect in the
  // surface's coordinate space.
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  // The PTY's effective cols/rows (the min across attached clients) reported by
  // the server, or null until the first `pty-size` frame lands (and cleared on
  // every session frame so a switch never inherits the prior PTY's mask).
  const [ptySize, setPtySize] = useState<{ cols: number; rows: number } | null>(null);
  // ptySize as a ref so the proposeDimensions closure (set once at terminal
  // creation) can read the live effective size and clamp the local grid to it.
  const ptySizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // The local viewer's natural cols (the viewport's width in cells, ignoring
  // any peer-imposed clamp), stashed by proposeDimensions so sendResize can
  // report it to the server and the overlay can gate the mask on it. The
  // server sizes the PTY to the min across clients, so each viewer must report
  // its NATURAL cols — reporting the clamped grid would deadlock the PTY at
  // the narrow size when the constraining peer leaves (the server would never
  // learn a wider size is available). The grid reflow is a purely local
  // render concern the server never sees.
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

  // Rectangle of the dead columns beyond the PTY's effective viewport (the
  // area right of a narrower peer's wrap), in the terminal surface's coordinate
  // space. Recomputes when the effective size changes (a `pty-size` frame) or
  // the local grid/cells move (resize, font, padding). Null when there's nothing
  // to mask — no frame yet, the local grid already matches the effective size
  // (sole/limiting viewer), or the terminal isn't measurable.
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

  const handleKeepAwakePopoverOpenChange = useCallback((open: boolean) => {
    setIsKeepAwakePopoverOpen(open);
    if (!open) setIsActionsMenuOpen(false);
  }, []);

  const handleOverlayOpenChange = useCallback(
    (setOpen: (open: boolean) => void, open: boolean): void => {
      setOpen(open);
      if (open) {
        setIsActionsMenuOpen(false);
        setIsCommandPaletteOpen(false);
        return;
      }
      if (toolbarHoverTimeoutRef.current !== null) {
        window.clearTimeout(toolbarHoverTimeoutRef.current);
      }
      toolbarHoverTimeoutRef.current = window.setTimeout(() => {
        toolbarHoverTimeoutRef.current = null;
        setIsToolbarHovered(false);
      }, TOOLBAR_HIDE_DELAY_MS);
      refocusTerminalRef.current?.();
    },
    [],
  );

  const handleSessionsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsSessionsOpen, open),
    [handleOverlayOpenChange],
  );

  const handlePortsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsPortsOpen, open),
    [handleOverlayOpenChange],
  );

  const handleSecretsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsSecretsOpen, open),
    [handleOverlayOpenChange],
  );

  const handleQrOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsQrOpen, open),
    [handleOverlayOpenChange],
  );

  const handleToolbarAreaEnter = useCallback(() => {
    if (toolbarHoverTimeoutRef.current !== null) {
      window.clearTimeout(toolbarHoverTimeoutRef.current);
      toolbarHoverTimeoutRef.current = null;
    }
    setIsToolbarHovered(true);
  }, []);

  const handleToolbarAreaLeave = useCallback(
    (event: React.MouseEvent) => {
      const leftThroughViewportEdge = event.clientY <= 0 || event.clientX >= window.innerWidth - 1;
      const delay = leftThroughViewportEdge
        ? TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS
        : TOOLBAR_HIDE_DELAY_MS;
      toolbarHoverTimeoutRef.current = window.setTimeout(() => {
        toolbarHoverTimeoutRef.current = null;
        if (!isSettingsOpen && !isAutomationsOpen) {
          setIsToolbarHovered(false);
        }
      }, delay);
    },
    [isSettingsOpen, isAutomationsOpen],
  );

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        loadDaemonSettings();
      } else {
        setIsActionsMenuOpen(false);
        if (toolbarHoverTimeoutRef.current !== null) {
          window.clearTimeout(toolbarHoverTimeoutRef.current);
        }
        toolbarHoverTimeoutRef.current = window.setTimeout(() => {
          toolbarHoverTimeoutRef.current = null;
          setIsToolbarHovered(false);
        }, TOOLBAR_HIDE_DELAY_MS);
      }
    },
    [loadDaemonSettings],
  );

  const handleAutomationsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsAutomationsOpen, open),
    [handleOverlayOpenChange],
  );

  const toggleAutomations = useCallback(() => {
    handleAutomationsOpenChange(!isAutomationsOpen);
  }, [handleAutomationsOpenChange, isAutomationsOpen]);
  toggleAutomationsRef.current = toggleAutomations;

  const handleWorktreesOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setWorktreeCreateError(null);
      }
      handleOverlayOpenChange(setIsWorktreesOpen, open);
    },
    [handleOverlayOpenChange],
  );

  const openWorktrees = useCallback(() => {
    setIsWorktreesOpen(true);
    setIsCommandPaletteOpen(false);
  }, []);
  openWorktreesRef.current = openWorktrees;

  const toggleWorktrees = useCallback(() => {
    handleWorktreesOpenChange(!isWorktreesOpen);
  }, [handleWorktreesOpenChange, isWorktreesOpen]);
  toggleWorktreesRef.current = toggleWorktrees;

  const toggleSessions = useCallback(() => {
    handleSessionsOpenChange(!isSessionsOpen);
  }, [handleSessionsOpenChange, isSessionsOpen]);
  toggleSessionsRef.current = toggleSessions;

  const togglePorts = useCallback(() => {
    handlePortsOpenChange(!isPortsOpen);
  }, [handlePortsOpenChange, isPortsOpen]);
  togglePortsRef.current = togglePorts;

  const toggleSecrets = useCallback(() => {
    handleSecretsOpenChange(!isSecretsOpen);
  }, [handleSecretsOpenChange, isSecretsOpen]);
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

  const commandPaletteCommands = useMemo<CommandItem[]>(() => {
    const togglePrefix = isMac ? "⌘" : "Ctrl+";
    return [
      {
        id: "find",
        label: "Find in terminal",
        category: "Actions",
        shortcut: `${togglePrefix}F`,
        icon: <Search className="size-3.5" />,
        action: openSearchOverlay,
      },
      {
        id: "git-diff",
        label: "View git diff",
        category: "Actions",
        shortcut: `${togglePrefix}G`,
        icon: <FileDiff className="size-3.5" />,
        action: openDiffViewer,
      },
      {
        id: "automations",
        label: "Automations",
        category: "Actions",
        shortcut: `${togglePrefix}J`,
        icon: <CalendarClock className="size-3.5" />,
        action: () => handleAutomationsOpenChange(true),
      },
      {
        id: "worktrees",
        label: "Git worktrees",
        category: "Actions",
        shortcut: `${togglePrefix}B`,
        icon: <FolderGit2 className="size-3.5" />,
        action: () => handleWorktreesOpenChange(true),
      },
      {
        id: "sessions",
        label: "Sessions",
        category: "Actions",
        shortcut: `${togglePrefix}I`,
        icon: <SquareTerminal className="size-3.5" />,
        action: () => handleSessionsOpenChange(true),
      },
      {
        id: "ports",
        label: "Dev ports",
        category: "Actions",
        shortcut: `${togglePrefix}Shift+D`,
        icon: <Network className="size-3.5" />,
        action: () => handlePortsOpenChange(true),
      },
      {
        id: "secrets",
        label: "Secrets",
        category: "Actions",
        shortcut: `${togglePrefix}Shift+S`,
        icon: <Key className="size-3.5" />,
        action: () => handleSecretsOpenChange(true),
      },
      {
        id: "worktrees-create",
        label: "Create git worktree",
        category: "Actions",
        shortcut: `${togglePrefix}Shift+B`,
        icon: <Plus className="size-3.5" />,
        action: () => {
          void createWorktree({}, true);
        },
      },
      {
        id: "new-shell",
        label: "Open new shell",
        category: "Actions",
        shortcut: "Alt+T",
        icon: <Plus className="size-3.5" />,
        action: openNewShell,
      },
      {
        id: "font-size-up",
        label: "Increase font size",
        category: "Settings",
        shortcut: `${togglePrefix}+`,
        icon: <MonitorCog className="size-3.5" />,
        action: () => handleFontSizeChange(activeFontSize + TERMINAL_FONT_SIZE_STEP_PX),
      },
      {
        id: "font-size-down",
        label: "Decrease font size",
        category: "Settings",
        shortcut: `${togglePrefix}-`,
        icon: <MonitorCog className="size-3.5" />,
        action: () => handleFontSizeChange(activeFontSize - TERMINAL_FONT_SIZE_STEP_PX),
      },
      {
        id: "cursor-blink",
        label: "Cursor blink",
        category: "Settings",
        checked: activeCursorBlink,
        action: () => handleCursorBlinkChange(!activeCursorBlink),
      },
      {
        id: "local-echo",
        label: "Predictive typing",
        category: "Settings",
        checked: activeLocalEcho,
        action: () => handleLocalEchoChange(!activeLocalEcho),
      },
      {
        id: "scroll-on-input",
        label: "Pin to bottom on input",
        category: "Settings",
        checked: activeScrollOnUserInput,
        action: () => handleScrollOnUserInputChange(!activeScrollOnUserInput),
      },
      // Keep-awake mode mirrors the coffee dropdown; only offered where
      // caffeinate exists (macOS), matching the toolbar control's gating.
      // Custom automatic commands stay in the popover — they need text input.
      ...(caffeinateSupported
        ? (
            [
              { mode: "off", label: "Keep awake: off" },
              { mode: "on", label: "Keep awake: on" },
              { mode: "automatic", label: "Keep awake: automatic" },
            ] as const
          ).map(({ mode, label }) => ({
            id: `keep-awake:${mode}`,
            label,
            category: "Keep awake",
            icon: <Coffee className="size-3.5" />,
            checked: caffeinateMode === mode,
            action: () => handleCaffeinateModeChange(mode),
          }))
        : []),
      ...TERMINAL_CURSOR_STYLES.map((option) => ({
        id: `cursor:${option.id}`,
        label: option.name,
        category: "Cursor",
        checked: option.id === activeCursorStyle,
        action: () => handleCursorStyleChange(option.id),
      })),
      ...TERMINAL_FONTS.map((font) => ({
        id: `font:${font.id}`,
        label: font.name,
        category: "Font",
        checked: font.id === activeFontId,
        action: () => handleFontChange(font.id),
      })),
      ...TERMINAL_THEMES.map((theme) => ({
        id: `theme:${theme.id}`,
        label: theme.name,
        category: "Theme",
        checked: theme.id === activeThemeId,
        action: () => handleThemeChange(theme.id),
      })),
    ];
  }, [
    isMac,
    handleThemeChange,
    handleFontChange,
    openSearchOverlay,
    openDiffViewer,
    handleAutomationsOpenChange,
    handleWorktreesOpenChange,
    handleSessionsOpenChange,
    handlePortsOpenChange,
    handleSecretsOpenChange,
    handleCursorStyleChange,
    activeCursorBlink,
    handleCursorBlinkChange,
    activeLocalEcho,
    handleLocalEchoChange,
    activeFontSize,
    handleFontSizeChange,
    activeScrollOnUserInput,
    handleScrollOnUserInputChange,
    activeThemeId,
    activeFontId,
    activeCursorStyle,
    caffeinateSupported,
    caffeinateMode,
    handleCaffeinateModeChange,
    openNewShell,
  ]);

  const handleCommandPaletteHighlight = useCallback((item: CommandItem | null) => {
    const itemId = item?.id ?? "";
    setPreviewThemeId(itemId.startsWith("theme:") ? itemId.slice("theme:".length) : null);
    setPreviewFontId(itemId.startsWith("font:") ? itemId.slice("font:".length) : null);
    const cursorStyleId = itemId.startsWith("cursor:") ? itemId.slice("cursor:".length) : null;
    setPreviewCursorStyle(isTerminalCursorStyle(cursorStyleId) ? cursorStyleId : null);
  }, []);

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
        <div
          className={cn(
            "absolute right-0 top-0 z-10 flex flex-col items-end pr-3 pt-1",
            shouldEnableAmbientToolbarPointerEvents ? "pointer-events-auto" : "pointer-events-none",
          )}
          onMouseEnter={isTouchDevice ? undefined : handleToolbarAreaEnter}
          onMouseLeave={isTouchDevice ? undefined : handleToolbarAreaLeave}
        >
          <div
            aria-hidden="true"
            className={cn(
              "mr-0.5 h-[2px] w-5 rounded-full bg-muted-foreground/25 transition-opacity duration-150",
              shouldShowToolbarHandle
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0",
            )}
          />
          {!isSearchOpen && (
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="terminal actions"
              data-terminal-actions-toolbar
              className={cn(
                "mt-1 flex max-w-[calc(100dvw-1.5rem)] items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 text-muted-foreground shadow-xs backdrop-blur-md",
                "transition-[opacity,transform] duration-200 ease-snappy",
                isTouchDevice &&
                  "touch-pan-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                shouldShowAmbientToolbar
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0",
              )}
              // The settings/automations popovers portal their DOM to <body> but
              // their React events still bubble here; only swallow focus for
              // events originating in the toolbar's own DOM subtree, or popover
              // inputs become unfocusable and typing gets yanked to the terminal.
              onMouseDown={(event) => {
                if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
              }}
              onClickCapture={(event) => {
                if (!isTouchDevice || !isOnScreenKeyboardOpen) return;
                if (
                  event.target instanceof Element &&
                  event.target.closest(ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR)
                ) {
                  return;
                }
                closeOnScreenKeyboard();
              }}
              onKeyDown={(event) => {
                if (event.currentTarget.contains(event.target as Node)) {
                  refocusTerminalRef.current?.();
                }
              }}
            >
              {/* With an indicator (working changes or a PR) showing, the action
                  buttons collapse behind the always-visible indicator and expand
                  on hover via the 0fr -> 1fr grid-column transition. */}
              <div
                className={cn(
                  "grid",
                  isTouchDevice ? "shrink-0" : "min-w-0",
                  (hasToolbarIndicator || isTouchDevice) &&
                    "transition-[grid-template-columns] duration-200 ease-snappy",
                  isTouchDevice
                    ? isActionsMenuOpen
                      ? "grid-cols-[1fr]"
                      : "grid-cols-[0fr]"
                    : hasToolbarIndicator && !isToolbarVisible
                      ? "grid-cols-[0fr]"
                      : "grid-cols-[1fr]",
                )}
              >
                <div
                  className={cn(
                    "flex min-w-0 items-center gap-0.5 overflow-hidden",
                    (hasToolbarIndicator || isTouchDevice) &&
                      "transition-opacity duration-200 ease-snappy",
                    isTouchDevice
                      ? isActionsMenuOpen
                        ? "opacity-100"
                        : "pointer-events-none opacity-0"
                      : hasToolbarIndicator && !isToolbarVisible
                        ? "pointer-events-none opacity-0"
                        : "opacity-100",
                  )}
                >
                  <SettingsMenu
                    themeId={activeThemeId}
                    onThemeChange={handleThemeChange}
                    onThemePreview={setPreviewThemeId}
                    customThemes={activeCustomThemes}
                    onImportTheme={handleImportTheme}
                    onDeleteTheme={handleDeleteCustomTheme}
                    fontId={activeFontId}
                    onFontChange={handleFontChange}
                    onFontPreview={setPreviewFontId}
                    customFontFamily={activeCustomFontFamily}
                    onCustomFontFamilyChange={handleCustomFontFamilyChange}
                    nerdFontEnabled={activeNerdFontEnabled}
                    onNerdFontEnabledChange={handleNerdFontEnabledChange}
                    ligaturesEnabled={activeLigaturesEnabled}
                    onLigaturesEnabledChange={handleLigaturesEnabledChange}
                    muteEmojiColors={activeMuteEmojiColors}
                    onMuteEmojiColorsChange={handleMuteEmojiColorsChange}
                    fontSize={activeFontSize}
                    onFontSizeChange={handleFontSizeChange}
                    lineHeight={activeLineHeight}
                    onLineHeightChange={handleLineHeightChange}
                    cursorStyle={activeCursorStyle}
                    onCursorStyleChange={handleCursorStyleChange}
                    onCursorStylePreview={setPreviewCursorStyle}
                    cursorBlink={activeCursorBlink}
                    onCursorBlinkChange={handleCursorBlinkChange}
                    localEcho={activeLocalEcho}
                    onLocalEchoChange={handleLocalEchoChange}
                    mobileResume={activeMobileResume}
                    onMobileResumeChange={handleMobileResumeChange}
                    scrollback={activeScrollback}
                    onScrollbackChange={handleScrollbackChange}
                    scrollOnUserInput={activeScrollOnUserInput}
                    onScrollOnUserInputChange={handleScrollOnUserInputChange}
                    cdpPort={cdpPort}
                    cdpStatus={cdpStatus}
                    cdpConnecting={cdpConnecting}
                    onCdpPortChange={handleCdpPortChange}
                    onCdpConnect={handleCdpConnect}
                    onOpenInspect={handleOpenInspect}
                    graceSeconds={graceSeconds}
                    onGraceSecondsChange={handleGraceSecondsChange}
                    workspaceRestore={workspaceRestore}
                    onWorkspaceRestoreChange={handleWorkspaceRestoreChange}
                    paddingX={activePaddingX}
                    onPaddingXChange={handlePaddingXChange}
                    paddingY={activePaddingY}
                    onPaddingYChange={handlePaddingYChange}
                    defaultCwd={activeDefaultCwd}
                    onDefaultCwdChange={handleDefaultCwdChange}
                    defaultShell={activeDefaultShell}
                    onDefaultShellChange={handleDefaultShellChange}
                    detectedDefaultShell={detectedDefaultShell}
                    notificationsPermission={notificationsPermission}
                    onNotificationsPermissionRequest={handleNotificationsPermissionRequest}
                    sessionInfo={sessionInfo}
                    updateAvailable={updateAvailable}
                    latestVersion={latestUpdateVersion}
                    onOpenChange={handleSettingsOpenChange}
                    onClose={refocusTerminalRef.current ?? undefined}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={openSearchOverlay}
                    aria-label="find in terminal"
                    className="hover:text-foreground"
                  >
                    <Search />
                  </Button>
                  {deviceTier !== "desktop" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={pickAndPasteImage}
                      aria-label="paste or pick an image into the terminal"
                      title="Paste or pick an image into the terminal"
                      className="hover:text-foreground"
                    >
                      <ImageIcon />
                    </Button>
                  ) : null}
                  {isTouchDevice ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        toggleCommandPaletteRef.current?.();
                      }}
                      aria-label="command palette"
                      className="hover:text-foreground"
                    >
                      <Command />
                    </Button>
                  ) : null}
                  {deviceTier !== "desktop" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-on-screen-keyboard-toggle
                      onClick={toggleOnScreenKeyboard}
                      aria-label="toggle on-screen keyboard"
                      className={cn(
                        "hover:text-foreground",
                        isOnScreenKeyboardOpen && "text-primary",
                      )}
                    >
                      <Keyboard />
                    </Button>
                  ) : null}
                  <AutomationsButton
                    onOpen={() => handleAutomationsOpenChange(true)}
                    isMac={isMac}
                  />
                  <WorktreesButton onOpen={() => handleWorktreesOpenChange(true)} isMac={isMac} />
                  <SessionsButton onOpen={() => handleSessionsOpenChange(true)} isMac={isMac} />
                  <PortsButton onOpen={() => handlePortsOpenChange(true)} />
                  <SecretsButton onOpen={() => handleSecretsOpenChange(true)} />
                  {caffeinateSupported ? (
                    <KeepAwakeMenu
                      mode={caffeinateMode}
                      active={caffeinateActive}
                      activityGate={caffeinateActivityGate}
                      peerKeepAwake={caffeinatePeerKeepAwake}
                      peerActive={caffeinatePeerActive}
                      batteryThreshold={caffeinateBatteryThreshold}
                      defaultCommands={caffeinateDefaultCommands}
                      commands={caffeinateCommands}
                      activeTrigger={caffeinateActiveTrigger}
                      onModeChange={handleCaffeinateModeChange}
                      onCommandsChange={handleCaffeinateCommandsChange}
                      onActivityGateChange={handleCaffeinateActivityGateChange}
                      onPeerKeepAwakeChange={handleCaffeinatePeerKeepAwakeChange}
                      onBatteryThresholdChange={handleCaffeinateBatteryThresholdChange}
                      onPopoverOpenChange={handleKeepAwakePopoverOpenChange}
                      onClose={refocusTerminalRef.current ?? undefined}
                    />
                  ) : null}
                  <QrButton onOpen={() => handleQrOpenChange(true)} />
                </div>
              </div>
              {isTouchDevice ||
              (shouldShowGitMetadata &&
                ((hasDiff && diffSummary !== null) || branchPrDisplayState)) ? (
                <div className="flex shrink-0 items-center">
                  {shouldShowGitMetadata && hasDiff && diffSummary !== null ? (
                    <button
                      type="button"
                      onClick={openDiffViewer}
                      aria-label={`view git diff: ${diffSummary.additions} additions, ${diffSummary.deletions} deletions${diffSummary.binaries > 0 ? `, ${diffSummary.binaries} binary files changed` : ""}`}
                      title={`${isMac ? "⌘" : "Ctrl+"}G`}
                      className="flex h-8 items-center gap-1 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="text-[var(--localterm-green)]">
                        +{formatDiffCount(diffSummary.additions)}
                      </span>
                      <span className="text-[var(--localterm-red)]">
                        −{formatDiffCount(diffSummary.deletions)}
                      </span>
                      {diffSummary.binaries > 0 ? (
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <Binary className="size-3" aria-hidden="true" />
                          {diffSummary.binaries}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                  {shouldShowGitMetadata && branchPr && branchPrDisplayState && BranchPrIcon ? (
                    <button
                      type="button"
                      onClick={openDiffViewer}
                      aria-label={`view pull request diff: PR #${branchPr.number} (${PR_DISPLAY_STATE_LABELS[branchPrDisplayState]})${branchPr.title ? ` — ${branchPr.title}` : ""}`}
                      title={`PR #${branchPr.number} (${PR_DISPLAY_STATE_LABELS[branchPrDisplayState]})${branchPr.title ? ` — ${branchPr.title}` : ""}`}
                      className={cn(
                        "flex h-8 items-center gap-1 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                        PR_STATE_STYLES[branchPrDisplayState].text,
                      )}
                    >
                      <BranchPrIcon className="size-3.5" aria-hidden="true" />
                      <span>#{branchPr.number}</span>
                    </button>
                  ) : null}
                  {isTouchDevice ? (
                    <button
                      type="button"
                      data-on-screen-keyboard-actions-toggle
                      onClick={toggleActionsMenu}
                      aria-label={
                        isActionsMenuOpen ? "Hide terminal actions" : "Show terminal actions"
                      }
                      aria-expanded={isActionsMenuOpen}
                      className="flex h-8 w-8 items-center justify-center rounded-[min(var(--radius-md),10px)] outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform duration-200 ease-snappy",
                          isActionsMenuOpen ? "rotate-180" : "rotate-0",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {isSearchOpen && (
            <InputGroup
              role="search"
              aria-label="find in terminal"
              className="mt-1 w-80 border-border/60 bg-background/70 text-muted-foreground shadow-xs backdrop-blur-md dark:bg-background/70"
            >
              <InputGroupInput
                ref={searchInputRef}
                type="search"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={searchQuery}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Find"
                aria-label="find query"
                className="text-xs"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText
                  role="status"
                  aria-label="match count"
                  className="text-xs tabular-nums"
                >
                  {matchLabel}
                </InputGroupText>
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => findPreviousMatch(searchQuery)}
                  disabled={searchResults.resultCount === 0}
                  aria-label="previous match"
                >
                  <ChevronUp />
                </InputGroupButton>
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => findNextMatch(searchQuery)}
                  disabled={searchResults.resultCount === 0}
                  aria-label="next match"
                >
                  <ChevronDown />
                </InputGroupButton>
                <InputGroupButton size="icon-xs" onClick={closeSearch} aria-label="close find">
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          )}
        </div>
      </div>

      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={closeCommandPalette}
        commands={commandPaletteCommands}
        onActiveItemChange={handleCommandPaletteHighlight}
      />

      <DiffViewer
        open={isDiffViewerOpen}
        cwd={liveCwd}
        syntaxHighlightColorScheme={syntaxHighlightColorScheme}
        branchInfo={branchInfo}
        gitDirtyVersion={gitDirtyVersion}
        onClose={closeDiffViewer}
        onSendToTerminal={sendDiffReviewToTerminal}
        onOpenInEditor={(filePath) => {
          if (!liveCwd) return;
          openShellAt(liveCwd, `nvim ${shellQuoteArg(filePath)} && exit`);
        }}
        onOpenImage={(filePath) => {
          if (!liveCwd) return;
          window.open(buildFileUrl(liveCwd, filePath), "_blank", "noopener,noreferrer");
        }}
        onRefreshBranchInfo={refreshBranchInfo}
        onDiffSummaryUpdate={setGitDiffSummary}
      />

      <AutomationsModal
        open={isAutomationsOpen}
        onClose={() => handleAutomationsOpenChange(false)}
        automations={automations}
        onAutomationsLoaded={setAutomations}
        defaultCwd={liveCwd}
        isMac={isMac}
      />

      <WorktreesModal
        open={isWorktreesOpen}
        cwd={liveCwd}
        isMac={isMac}
        createError={worktreeCreateError}
        onCreate={createWorktree}
        onDismissCreateError={() => setWorktreeCreateError(null)}
        onClose={() => handleWorktreesOpenChange(false)}
        onOpenShell={openShellAt}
      />

      <SessionsModal
        open={isSessionsOpen}
        liveSessionIdRef={liveSessionIdRef}
        previousSessionIdRef={previousSessionIdRef}
        switchSessionRef={switchSessionRef}
        isTouchDevice={isTouchDevice}
        onOpenNewShell={openNewShell}
        onClose={() => handleSessionsOpenChange(false)}
      />

      <PortsModal
        open={isPortsOpen}
        isTouchDevice={isTouchDevice}
        onClose={() => handlePortsOpenChange(false)}
      />

      <SecretsModal open={isSecretsOpen} onClose={() => handleSecretsOpenChange(false)} />

      <QrModal
        open={isQrOpen}
        liveSessionIdRef={liveSessionIdRef}
        switchSessionRef={switchSessionRef}
        peerAttachedRef={qrPeerAttachedRef}
        onClose={() => handleQrOpenChange(false)}
      />

      <AlertDialog open={isModalOpen}>
        <AlertDialogContent>
          {exitInfo !== null ? (
            exitInfo.reason === "shell-exited" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm">Shell ended</AlertDialogTitle>
                  <AlertDialogDescription>
                    {exitInfo.exitCode === null || exitInfo.exitCode === 0
                      ? "Open a new shell to keep going, or close this tab."
                      : `Exit code ${exitInfo.exitCode}. Open a new shell to keep going.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction onClick={openNewShell}>New shell</AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-sm">
                    <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
                    Connection lost
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The browser lost its connection to the localterm daemon (close code{" "}
                    {exitInfo.closeCode}
                    {exitInfo.closeReason ? ` · ${exitInfo.closeReason}` : ""}). Reconnecting spawns
                    a fresh shell. The previous one can't be reattached.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction
                    onClick={triggerManualReconnect}
                    disabled={isRetryingConnection}
                  >
                    {isRetryingConnection ? <Spinner data-icon="inline-start" /> : null}
                    Reconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-sm">
                  <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
                  Lost connection
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The localterm server isn't responding. Start it again from your terminal, then
                  retry.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <InputGroup>
                <InputGroupInput
                  readOnly
                  value={RESTART_COMMAND}
                  aria-label="restart command"
                  className="font-mono"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={copyRestartCommand}
                    aria-label={hasCopiedRestartCommand ? "Copied" : "Copy restart command"}
                  >
                    {hasCopiedRestartCommand ? <Check /> : <Copy />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <AlertDialogFooter>
                <AlertDialogAction onClick={triggerManualReconnect} disabled={isRetryingConnection}>
                  {isRetryingConnection ? <Spinner data-icon="inline-start" /> : null}
                  Retry
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
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
