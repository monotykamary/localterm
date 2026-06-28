import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import type { IUnicodeVersionProvider } from "@xterm/xterm";
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
  MonitorCog,
  Network,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PR_DISPLAY_STATE_LABELS,
  PR_STATE_ICONS,
  PR_STATE_STYLES,
  resolvePrDisplayState,
} from "@/lib/pr-state";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { AutomationsButton } from "@/components/automations-menu";
import { AutomationsModal } from "@/components/automations-modal";
import { CommandPalette, type CommandItem } from "@/components/command-palette";
import { DiffViewer } from "@/components/diff-viewer";
import { KeepAwakeMenu, type CaffeinateMode } from "@/components/keep-awake-menu";
import { PortsButton } from "@/components/ports-menu";
import { PortsModal } from "@/components/ports-modal";
import { QrButton } from "@/components/qr-button";
import { QrModal } from "@/components/qr-modal";
import { SessionsButton } from "@/components/sessions-menu";
import { SessionsModal } from "@/components/sessions-modal";
import { SettingsMenu } from "@/components/settings-menu";
import { WorktreesButton } from "@/components/worktrees-menu";
import { WorktreesModal } from "@/components/worktrees-modal";
import { useGitBranchInfo } from "@/hooks/use-git-branch-info";
import { useGitDiffSummary } from "@/hooks/use-git-diff-summary";
import { createGitWorktree, type CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";
import {
  COPY_FEEDBACK_MS,
  DEAD_SESSION_TITLE_PREFIX,
  DEFAULT_DOCUMENT_TITLE,
  DISCONNECT_MODAL_THRESHOLD_FAILURES,
  TERMINAL_TAP_MOVEMENT_THRESHOLD_PX,
  TERMINAL_KEYBOARD_HIDE_VIEWPORT_GROWTH_PX,
  TERMINAL_VIEWPORT_WIDTH_STABLE_PX,
  ENTER_KEY_CODE,
  FALLBACK_TERMINAL_BACKGROUND_HEX,
  TERMINAL_FONT_SIZE_STEP_PX,
  FAVICON_RUNNING_DEBOUNCE_MS,
  FAVICON_READY_DEBOUNCE_MS,
  HAPTIC_TAP_MS,
  KEYBOARD_MODIFIER_SHIFT_BIT,
  KITTY_KEYBOARD_DISAMBIGUATE_FLAG,
  KITTY_KEYBOARD_SET_MODE_AND_NOT,
  KITTY_KEYBOARD_SET_MODE_OR,
  KITTY_KEYBOARD_SET_MODE_REPLACE,
  RECONNECT_DELAY_MS,
  RECONNECT_FAST_POLL_DURATION_MS,
  RECONNECT_FAST_POLL_INTERVAL_MS,
  RECONNECT_POLL_INTERVAL_MS,
  RESIZE_DEBOUNCE_MS,
  RESTART_COMMAND,
  RETRY_BUTTON_FEEDBACK_MS,
  SEARCH_ACTIVE_MATCH_BACKGROUND_HEX,
  SEARCH_ACTIVE_MATCH_BORDER_HEX,
  SEARCH_MATCH_BACKGROUND_HEX,
  TOOLBAR_HIDE_DELAY_MS,
  TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS,
} from "@/lib/constants";
import {
  AMBIENT_TAB_CLOSE_DEADLINE_MS,
  LOCALTERM_TAB_TOKEN_EVENT,
  LOCALTERM_TAB_TOKEN_PROPERTY,
  serverToClientMessageSchema,
  type AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import {
  TERMINAL_CURSOR_STYLES,
  type TerminalCursorStyle,
  isTerminalCursorStyle,
} from "@/lib/terminal-cursor";
import { TERMINAL_FONTS, familyForFont, findTerminalFontById } from "@/lib/terminal-fonts";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";
import { TERMINAL_THEMES, findTerminalThemeById } from "@/lib/terminal-themes";
import { generateExtendedPalette } from "@/utils/generate-extended-palette";
import { awaitFontReady } from "@/utils/await-font-ready";
import { buildKittyKeySequence } from "@/utils/build-kitty-key-sequence";
import {
  captureTerminalScrollAnchor,
  type TerminalScrollAnchor,
} from "@/utils/capture-terminal-scroll-anchor";
import { EmojiWidthUnicodeProvider } from "@/utils/emoji-width-unicode-provider";
import { extractKeyboardModifiers } from "@/utils/extract-keyboard-modifiers";
import { fitTerminalPreservingScroll } from "@/utils/fit-terminal-preserving-scroll";
import { formatShellExitMarker } from "@/utils/format-shell-exit-marker";
import { triggerHapticFeedback } from "@/utils/haptic-feedback";
import { chunkInputByCodeUnits } from "@/utils/chunk-input-by-code-units";
import { restoreTerminalScrollAnchor } from "@/utils/restore-terminal-scroll-anchor";
import { outputBatcher } from "@/utils/write-terminal-output";
import { shouldBlockTerminalScrollbackPurge } from "@/utils/should-block-terminal-scrollback-purge";
import { clampTerminalFontSize } from "@/utils/clamp-terminal-font-size";
import { clampTerminalLineHeight } from "@/utils/clamp-terminal-line-height";
import { clampTerminalPaddingX, clampTerminalPaddingY } from "@/utils/clamp-terminal-padding";
import { detectIsMacPlatform } from "@/utils/detect-is-mac-platform";
import { formatDiffCount } from "@/utils/format-diff-count";
import { shellQuoteArg } from "@/utils/shell-quote-arg";
import { buildFileUrl } from "@/utils/build-file-url";
import { isAutomationsShortcut } from "@/utils/is-automations-shortcut";
import { isBinaryMessageData } from "@/utils/is-binary-message-data";
import { isCommandPaletteShortcut } from "@/utils/is-command-palette-shortcut";
import { isDiffViewerShortcut } from "@/utils/is-diff-viewer-shortcut";
import { isFindShortcut } from "@/utils/is-find-shortcut";
import { isNewTabShortcut } from "@/utils/is-new-tab-shortcut";
import { isPortsShortcut } from "@/utils/is-ports-shortcut";
import { isSessionsShortcut } from "@/utils/is-sessions-shortcut";
import { isWorktreesCreateShortcut } from "@/utils/is-worktrees-create-shortcut";
import { isWorktreesShortcut } from "@/utils/is-worktrees-shortcut";
import {
  INITIAL_COMMAND_QUERY_PARAM,
  removeInitialCommandQueryParam,
} from "@/utils/remove-initial-command-query-param";
import { removeRunQueryParam, RUN_QUERY_PARAM } from "@/utils/remove-run-query-param";
import {
  SESSION_ID_QUERY_PARAM,
  syncSessionIdQueryParam,
} from "@/utils/sync-session-id-query-param";
import {
  loadStoredTerminalCursorBlink,
  storeTerminalCursorBlink,
  subscribeStoredTerminalCursorBlink,
} from "@/utils/stored-terminal-cursor-blink";
import {
  loadStoredLocalEcho,
  storeStoredLocalEcho,
  subscribeStoredLocalEcho,
} from "@/utils/stored-local-echo-enabled";
import { LocalEcho } from "@/lib/local-echo";
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
  loadStoredTerminalFontSize,
  storeTerminalFontSize,
  subscribeStoredTerminalFontSize,
} from "@/utils/stored-terminal-font-size";
import { isCoarsePointer } from "@/utils/is-coarse-pointer";
import {
  loadStoredTerminalLineHeight,
  storeTerminalLineHeight,
  subscribeStoredTerminalLineHeight,
} from "@/utils/stored-terminal-line-height";
import {
  loadStoredTerminalScrollback,
  storeTerminalScrollback,
  subscribeStoredTerminalScrollback,
} from "@/utils/stored-terminal-scrollback";
import {
  loadStoredTerminalScrollOnUserInput,
  storeTerminalScrollOnUserInput,
  subscribeStoredTerminalScrollOnUserInput,
} from "@/utils/stored-terminal-scroll-on-user-input";
import {
  loadStoredTerminalThemeId,
  storeTerminalThemeId,
  subscribeStoredTerminalThemeId,
} from "@/utils/stored-terminal-theme-id";
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
  loadStoredNerdFontEnabled,
  storeNerdFontEnabled,
  subscribeStoredNerdFontEnabled,
} from "@/utils/stored-nerd-font-enabled";
import {
  loadStoredLigaturesEnabled,
  storeLigaturesEnabled,
  subscribeStoredLigaturesEnabled,
} from "@/utils/stored-ligatures-enabled";
import { findLigatureRanges } from "@/utils/ligature-joiner";
import { setTabFaviconState } from "@/utils/set-tab-favicon-state";
import { probeServerHealth } from "@/utils/probe-server-health";
import { shouldSuppressAltBufferWheel } from "@/utils/should-suppress-alt-buffer-wheel";

import {
  MAX_INPUT_BYTES,
  type ClientToServerMessage,
} from "@monotykamary/localterm-server/protocol";
import "@xterm/xterm/css/xterm.css";

const titleForLiveSession = (raw: string): string => raw || DEFAULT_DOCUMENT_TITLE;
const titleForDeadSession = (raw: string): string =>
  `${DEAD_SESSION_TITLE_PREFIX}${raw || DEFAULT_DOCUMENT_TITLE}`;

const SEARCH_DECORATION_OPTIONS = {
  matchBackground: SEARCH_MATCH_BACKGROUND_HEX,
  activeMatchBackground: SEARCH_ACTIVE_MATCH_BACKGROUND_HEX,
  activeMatchBorder: SEARCH_ACTIVE_MATCH_BORDER_HEX,
  matchOverviewRuler: SEARCH_ACTIVE_MATCH_BACKGROUND_HEX,
  activeMatchColorOverviewRuler: SEARCH_ACTIVE_MATCH_BORDER_HEX,
};

const CWD_QUERY_PARAM = "cwd";

const buildWebSocketUrl = (cwdOverride?: string | null, sid?: string | null): string => {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams(window.location.search);
  const cwd = cwdOverride ?? params.get(CWD_QUERY_PARAM);
  if (cwd) url.searchParams.set(CWD_QUERY_PARAM, cwd);
  const runId = params.get(RUN_QUERY_PARAM);
  if (runId) url.searchParams.set(RUN_QUERY_PARAM, runId);
  // Fall back to the address bar's ?sid= (written by syncSessionIdQueryParam)
  // when no explicit id is passed, so a full page refresh reattaches to the
  // same live PTY instead of spawning a fresh shell.
  const resolvedSid = sid ?? params.get(SESSION_ID_QUERY_PARAM);
  if (resolvedSid) url.searchParams.set(SESSION_ID_QUERY_PARAM, resolvedSid);
  // Forward a transient initial command (a worktree's setup script) so the
  // server writes it to the PTY as if the user typed it — the install/env-copy
  // output is visible and the prompt returns when it finishes.
  const initialCommand = params.get(INITIAL_COMMAND_QUERY_PARAM);
  if (initialCommand) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, initialCommand);
  return url.toString();
};

const buildNewTabUrl = (cwd: string | null, command?: string): string => {
  const url = new URL(window.location.origin);
  if (cwd) url.searchParams.set(CWD_QUERY_PARAM, cwd);
  if (command) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, command);
  return url.toString();
};

interface SearchResultState {
  resultIndex: number;
  resultCount: number;
}

type ExitInfo =
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

export const Terminal = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const terminalInitializedRef = useRef(false);
  const manualReconnectRef = useRef<(() => void) | null>(null);
  const switchSessionRef = useRef<((sid: string) => void) | null>(null);
  const liveSessionIdRef = useRef<string | null>(null);
  // The session this tab was viewing immediately before the current one — the
  // "last switched" shell. Recorded on every switch so the session picker can
  // open with it highlighted for an alt-tab-style Enter quick-switch.
  const previousSessionIdRef = useRef<string | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const refocusTerminalRef = useRef<(() => void) | null>(null);
  const pasteToTerminalRef = useRef<((text: string) => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const retryFeedbackTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const resizeScrollRestoreRef = useRef<ResizeScrollRestoreState | null>(null);
  const initialThemeIdRef = useRef<string>(loadStoredTerminalThemeId());
  const initialFontIdRef = useRef<string>(loadStoredTerminalFontId());
  const initialFontSizeRef = useRef<number>(loadStoredTerminalFontSize());
  const initialLineHeightRef = useRef<number>(loadStoredTerminalLineHeight());
  const initialCursorStyleRef = useRef<TerminalCursorStyle>(loadStoredTerminalCursorStyle());
  const initialCursorBlinkRef = useRef<boolean>(loadStoredTerminalCursorBlink());
  const initialLocalEchoRef = useRef<boolean>(loadStoredLocalEcho());
  const activeLocalEchoRef = useRef<boolean>(initialLocalEchoRef.current);
  const localEchoRef = useRef<LocalEcho | null>(null);
  const initialScrollbackRef = useRef<number>(loadStoredTerminalScrollback());
  const initialScrollOnUserInputRef = useRef<boolean>(loadStoredTerminalScrollOnUserInput());
  const initialPaddingXRef = useRef<number>(loadStoredTerminalPaddingX());
  const initialPaddingYRef = useRef<number>(loadStoredTerminalPaddingY());
  const initialNerdFontEnabledRef = useRef<boolean>(loadStoredNerdFontEnabled());
  const initialLigaturesEnabledRef = useRef<boolean>(loadStoredLigaturesEnabled());
  const fitAddonRef = useRef<FitAddon | null>(null);
  const openSearchOverlayRef = useRef<(() => void) | null>(null);
  const openDiffViewerRef = useRef<(() => void) | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [hasCopiedRestartCommand, setHasCopiedRestartCommand] = useState(false);
  const [isRetryingConnection, setIsRetryingConnection] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const toggleCommandPaletteRef = useRef<(() => void) | null>(null);
  const [searchOpenAttempt, setSearchOpenAttempt] = useState(0);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isSettingsPopoverOpen, setIsSettingsPopoverOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [isKeepAwakePopoverOpen, setIsKeepAwakePopoverOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [automations, setAutomations] = useState<AutomationWithNextRun[] | null>(null);
  const toggleAutomationsRef = useRef<(() => void) | null>(null);
  const [isWorktreesOpen, setIsWorktreesOpen] = useState(false);
  const [worktreeCreateError, setWorktreeCreateError] = useState<string | null>(null);
  const [isPortsOpen, setIsPortsOpen] = useState(false);
  const openWorktreesRef = useRef<(() => void) | null>(null);
  const toggleWorktreesRef = useRef<(() => void) | null>(null);
  const togglePortsRef = useRef<(() => void) | null>(null);
  const toggleSessionsRef = useRef<(() => void) | null>(null);
  const createWorktreeRef = useRef<
    ((options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>) | null
  >(null);
  const setCaffeinateModeRef = useRef<((mode: CaffeinateMode) => void) | null>(null);
  const setCaffeinateCommandsRef = useRef<((commands: string[]) => void) | null>(null);
  const setCaffeinateActivityGateRef = useRef<((enabled: boolean) => void) | null>(null);
  const setCaffeinateBatteryThresholdRef = useRef<((percent: number | null) => void) | null>(null);
  const toolbarHoverTimeoutRef = useRef<number | null>(null);
  const isSettingsPopoverOpenRef = useRef(false);
  const isKeepAwakePopoverOpenRef = useRef(false);
  const isAutomationsOpenRef = useRef(false);
  const isWorktreesOpenRef = useRef(false);
  const isSessionsOpenRef = useRef(false);
  const isPortsOpenRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isTouchDevice = useMemo(() => isCoarsePointer(), []);
  useEffect(() => {
    if (!isTouchDevice) return;
    const root = rootRef.current;
    const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!root || !visualViewport) return;
    const apply = () => {
      root.style.height = `${visualViewport.height}px`;
      root.style.transform = `translateY(${visualViewport.offsetTop}px)`;
    };
    apply();
    visualViewport.addEventListener("resize", apply);
    visualViewport.addEventListener("scroll", apply);
    return () => {
      visualViewport.removeEventListener("resize", apply);
      visualViewport.removeEventListener("scroll", apply);
      root.style.height = "";
      root.style.transform = "";
    };
  }, [isTouchDevice]);
  // On touch the expanded action toolbar dismisses on a tap landing outside
  // itself, replacing the dedicated overlay layer. The settings and keep-awake
  // popovers portal to <body> and own their own outside-tap dismissal, so while
  // either is open we defer to it — collapsing the toolbar would yank the
  // popover's anchor, whose trigger lives in the collapsing grid.
  useEffect(() => {
    if (!isTouchDevice || !isActionsMenuOpen) return;
    const handleOutsidePress = (event: PointerEvent) => {
      if (isSettingsPopoverOpenRef.current || isKeepAwakePopoverOpenRef.current) return;
      const toolbar = toolbarRef.current;
      if (toolbar && event.target instanceof Node && toolbar.contains(event.target)) return;
      setIsActionsMenuOpen(false);
    };
    window.addEventListener("pointerdown", handleOutsidePress, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePress, true);
  }, [isTouchDevice, isActionsMenuOpen]);
  const isToolbarVisible =
    isToolbarHovered ||
    isActionsMenuOpen ||
    isSettingsPopoverOpen ||
    isAutomationsOpen ||
    isKeepAwakePopoverOpen ||
    isSessionsOpen ||
    isWorktreesOpen ||
    isPortsOpen ||
    isQrOpen;
  isSettingsPopoverOpenRef.current = isSettingsPopoverOpen;
  isKeepAwakePopoverOpenRef.current = isKeepAwakePopoverOpen;
  isAutomationsOpenRef.current = isAutomationsOpen;
  isSessionsOpenRef.current = isSessionsOpen;
  isPortsOpenRef.current = isPortsOpen;
  isWorktreesOpenRef.current = isWorktreesOpen;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultState>({
    resultIndex: -1,
    resultCount: 0,
  });
  const [activeThemeId, setActiveThemeId] = useState<string>(initialThemeIdRef.current);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const effectiveThemeId = previewThemeId ?? activeThemeId;
  const effectiveTheme = useMemo(() => findTerminalThemeById(effectiveThemeId), [effectiveThemeId]);
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
  const effectiveFont = useMemo(() => findTerminalFontById(effectiveFontId), [effectiveFontId]);
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
  const [activeScrollback, setActiveScrollback] = useState<number>(initialScrollbackRef.current);
  const [activeScrollOnUserInput, setActiveScrollOnUserInput] = useState<boolean>(
    initialScrollOnUserInputRef.current,
  );
  const [activePaddingX, setActivePaddingX] = useState<number>(initialPaddingXRef.current);
  const [activePaddingY, setActivePaddingY] = useState<number>(initialPaddingYRef.current);
  const [sessionInfo, setSessionInfo] = useState<TerminalSessionInfo | null>(null);
  const [notificationsPermission, setNotificationsPermission] = useState<
    NotificationPermission | "unsupported"
  >("Notification" in window ? Notification.permission : "unsupported");
  const [liveCwd, setLiveCwd] = useState<string | null>(null);
  const liveCwdRef = useRef<string | null>(null);
  const wsConnectedRef = useRef(false);
  const isMac = useMemo(detectIsMacPlatform, []);
  // Keep-awake (caffeinate) is daemon-owned global state: the server is the
  // source of truth for the mode, the live process state, and the trigger
  // commands, and broadcasts changes to every tab. Seed `supported` from the
  // platform and `mode` from the server default ("automatic") so the control
  // doesn't flash in before the first WS frame.
  const [caffeinateSupported, setCaffeinateSupported] = useState(isMac);
  const [caffeinateActive, setCaffeinateActive] = useState(false);
  const [caffeinateMode, setCaffeinateMode] = useState<CaffeinateMode>("automatic");
  const [caffeinateDefaultCommands, setCaffeinateDefaultCommands] = useState<string[]>([]);
  const [caffeinateCommands, setCaffeinateCommands] = useState<string[]>([]);
  const [caffeinateActivityGate, setCaffeinateActivityGate] = useState(true);
  // Default null = guard off on the client seed; the server's authoritative
  // threshold (which defaults to 20% on) overwrites this on the first WS frame.
  const [caffeinateBatteryThreshold, setCaffeinateBatteryThreshold] = useState<number | null>(null);
  const caffeinateActiveTriggerRef = useRef<string | null>(null);
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false);
  const { summary: diffSummary, setGitDiffSummary } = useGitDiffSummary();
  // Bumps every time the server pushes a git-diff-summary from a real git-dirty
  // signal, giving the diff viewer a trigger for near-realtime updates.
  // Starts undefined so the diff viewer doesn't treat the initial render as a
  // dirty signal and re-fetch the file list immediately on open.
  const [gitDirtyVersion, setGitDirtyVersion] = useState<number | undefined>(undefined);
  const hasDiff = diffSummary !== null && diffSummary.isRepo && diffSummary.files > 0;
  // Ambient branch/PR lease for the active cwd: drives the toolbar PR indicator
  // and is handed to the diff viewer so it opens in branch mode instantly.
  const { branchInfo, refresh: refreshBranchInfo } = useGitBranchInfo(liveCwd);
  const branchPr = branchInfo?.pr ?? null;
  const branchPrDisplayState = useMemo(
    () => (branchPr ? resolvePrDisplayState(branchPr, branchInfo?.currentBranch ?? null) : null),
    [branchPr, branchInfo?.currentBranch],
  );
  const BranchPrIcon = useMemo(
    () => (branchPrDisplayState ? PR_STATE_ICONS[branchPrDisplayState] : null),
    [branchPrDisplayState],
  );
  // Either indicator (working-changes count or PR) keeps the toolbar "peeking":
  // the indicator stays visible while the action buttons collapse behind it and
  // expand on hover. A stale merged PR (null display state) doesn't count.
  const hasToolbarIndicator = hasDiff || branchPrDisplayState !== null;

  // A `git checkout` keeps the same cwd, so the cwd-keyed lease wouldn't notice.
  // The ambient summary carries the live branch; when it diverges from the branch
  // the lease was fetched under, re-lease so the PR indicator tracks the branch.
  const summaryBranch = diffSummary?.branch ?? null;
  useEffect(() => {
    if (!branchInfo || !summaryBranch) return;
    if (summaryBranch !== branchInfo.currentBranch) refreshBranchInfo();
  }, [summaryBranch, branchInfo, refreshBranchInfo]);

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
    let exited = false;
    let wasEverConnected = false;
    let lastTitle = "";
    let socket: WebSocket | null = null;
    // Server-side PTY id (sent in the {type:"session"} message). Preserved
    // across reconnects and forwarded as `?sid=` so the daemon can attach to
    // the live PTY instead of spawning a fresh shell. Cleared on genuine shell
    // exit (markShellDead) so the dead session is never reattached on a manual
    // Reconnect. Mirrored into liveSessionIdRef so the session picker can badge
    // the PTY this tab is currently viewing and skip re-switching to it.
    let liveSessionId: string | null = null;
    // Override sid for the next connect(): set by switchSession() so the next
    // WebSocket opens against the picked PTY instead of the current one. The
    // session-frame handler leaves liveSessionId alone until the new frame
    // lands, so the new id compares unequal to the old one and the handler
    // treats it as a switch (reset + scrollback replay).
    let nextConnectSid: string | null = null;
    // Silent-reattach state: on a WS close while we still have a liveSessionId,
    // we skip the connection-lost modal and try one quiet reconnect — the
    // daemon keeps the PTY alive across transient drops (portless teardown on
    // wake, brief network blip). If the reconnect's session frame has the same
    // id the shell survived and the user sees nothing; if the id differs the
    // shell was reaped while dormant and a fresh shell spawned (the session
    // handler resets the terminal and replays its scrollback). Cleared on
    // session landing or on a second close (silent reconnect failed). Stashed
    // close info is reused for the failed-reconnect modal so we don't lose the
    // original code/reason.
    let reattachPending = false;
    let reattachCloseCode = 0;
    let reattachCloseReason = "";
    // Whether the server paired this WS socket with a CDP target via the
    // `{type:"identify"}` handshake → the server will drive closeTab on a
    // clean shell exit, so the client defers window.close() to give the
    // CDP-driven close time to land. Reset whenever the socket changes; the
    // next identify acks with the up-to-date value over the new WS.
    let cdpControlled = false;
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
    let suppressOutput = false;
    let inReplay = false;
    let replayChunks: Uint8Array[] = [];
    let reconnectTimer: number | null = null;
    let resizeTimer: number | null = null;
    let faviconRunningTimer: number | null = null;
    let faviconReadyTimer: number | null = null;
    let lastOutputTimestamp = 0;
    let faviconState: "ready" | "running" | "alive-quiet" = "ready";
    let faviconBadge = false;
    let hadForegroundThisCycle = false;
    let hasForegroundProcess = false;
    // Kitty keyboard protocol (https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
    // tracks a stack of flags so a TUI can push/pop reporting modes. We only
    // care that *some* flags are active when intercepting modifier+Enter so
    // shells (which never push flags) keep getting bare \r and don't see CSI u
    // garbage in their input. Stack always has at least one entry per spec.
    const kittyFlagStack: number[] = [0];
    const getKittyFlags = (): number => kittyFlagStack[kittyFlagStack.length - 1] ?? 0;

    const checkReadyAfterOutput = () => {
      const silence = performance.now() - lastOutputTimestamp;
      if (silence < FAVICON_READY_DEBOUNCE_MS) {
        faviconReadyTimer = window.setTimeout(
          checkReadyAfterOutput,
          FAVICON_READY_DEBOUNCE_MS - silence,
        );
        return;
      }
      faviconReadyTimer = null;
      if (faviconRunningTimer !== null) {
        window.clearTimeout(faviconRunningTimer);
        faviconRunningTimer = null;
      }
      if (faviconState === "running") {
        if (document.hidden && hadForegroundThisCycle) {
          faviconBadge = true;
        }
        if (!hasForegroundProcess) hadForegroundThisCycle = false;
        if (hasForegroundProcess) {
          faviconState = "alive-quiet";
          setTabFaviconState("alive-quiet", faviconBadge);
        } else {
          faviconState = "ready";
          setTabFaviconState("ready", faviconBadge);
        }
      }
    };

    const noteOutputActivity = () => {
      if (faviconState !== "running" && faviconRunningTimer === null) {
        faviconRunningTimer = window.setTimeout(() => {
          faviconRunningTimer = null;
          if (disposed || exited) return;
          faviconState = "running";
          faviconBadge = false;
          setTabFaviconState("running");
        }, FAVICON_RUNNING_DEBOUNCE_MS);
      }
      lastOutputTimestamp = performance.now();
      if (faviconReadyTimer !== null) return;
      faviconReadyTimer = window.setTimeout(checkReadyAfterOutput, FAVICON_READY_DEBOUNCE_MS);
    };

    const resetFavicon = () => {
      if (faviconRunningTimer !== null) {
        window.clearTimeout(faviconRunningTimer);
        faviconRunningTimer = null;
      }
      if (faviconReadyTimer !== null) {
        window.clearTimeout(faviconReadyTimer);
        faviconReadyTimer = null;
      }
      if (faviconState !== "ready" || faviconBadge) {
        faviconState = "ready";
        faviconBadge = false;
        setTabFaviconState("ready");
      }
      hadForegroundThisCycle = false;
    };

    const initialFont = findTerminalFontById(initialFontIdRef.current);
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

    const terminal = new XtermTerminal({
      allowProposedApi: true,
      cursorBlink: initialCursorBlinkRef.current,
      cursorStyle: initialCursorStyleRef.current,
      fontFamily: familyForFont(initialFont, initialNerdFontEnabledRef.current),
      fontSize: initialFontSizeRef.current,
      lineHeight: initialLineHeightRef.current,
      scrollback: initialScrollbackRef.current,
      theme: {
        ...findTerminalThemeById(initialThemeIdRef.current).colors,
        extendedAnsi: generateExtendedPalette(
          findTerminalThemeById(initialThemeIdRef.current).colors,
        ),
      },
      macOptionIsMeta: true,
      scrollOnUserInput: initialScrollOnUserInputRef.current,
      windowOptions: {
        getWinSizePixels: true,
        getCellSizePixels: true,
        getWinSizeChars: true,
      },
      scrollbar: { showScrollbar: false },
    });
    terminalRef.current = terminal;
    outputBatcher.attach(terminal);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new ClipboardAddon());
    terminal.loadAddon(new ImageAddon());
    terminal.loadAddon(new ProgressAddon());
    terminal.loadAddon(new UnicodeGraphemesAddon());
    const graphemesProvider = (
      terminal as unknown as {
        _core: { unicodeService: { _activeProvider: IUnicodeVersionProvider } };
      }
    )._core.unicodeService._activeProvider;
    terminal.unicode.register(
      new EmojiWidthUnicodeProvider(
        graphemesProvider,
        // The spacing-combining-mark override only matches Claude Code, which
        // runs in the normal buffer. Full-screen TUIs (vim, less, tmux) run in
        // the alternate buffer and use correct combining-mark widths.
        () => terminal.buffer.active.type === "normal",
      ),
    );
    terminal.unicode.activeVersion = "15-graphemes-emoji";
    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsDisposable = searchAddon.onDidChangeResults(setSearchResults);

    terminal.open(container);

    const helperTextArea = container.querySelector("textarea.xterm-helper-textarea");
    if (helperTextArea instanceof HTMLTextAreaElement) {
      helperTextArea.autocomplete = "off";
      helperTextArea.setAttribute("autocapitalize", "off");
      helperTextArea.setAttribute("autocorrect", "off");
      helperTextArea.spellcheck = false;
    }

    let tapStartClientX = 0;
    let tapStartClientY = 0;
    let tapMovedBeyondThreshold = false;
    const focusTerminalForInput = () => {
      if (terminal.textarea) terminal.textarea.inputMode = "";
      terminal.focus();
    };
    const handleTerminalTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tapMovedBeyondThreshold = true;
        return;
      }
      tapStartClientX = event.touches[0].clientX;
      tapStartClientY = event.touches[0].clientY;
      tapMovedBeyondThreshold = false;
    };
    const handleTerminalTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tapMovedBeyondThreshold = true;
        return;
      }
      const movedPx = Math.hypot(
        event.touches[0].clientX - tapStartClientX,
        event.touches[0].clientY - tapStartClientY,
      );
      if (movedPx > TERMINAL_TAP_MOVEMENT_THRESHOLD_PX) {
        tapMovedBeyondThreshold = true;
      }
    };
    const handleTerminalTouchEnd = (event: TouchEvent) => {
      if (tapMovedBeyondThreshold) {
        event.preventDefault();
        return;
      }
      focusTerminalForInput();
    };
    const tapListenerAbort = new AbortController();
    if (isTouchDevice) {
      // inputMode="none" on the helper textarea prevents the virtual keyboard
      // opening on focus, so xterm's scroll-release / viewport-refocus can't
      // pop it. A reactive blur-on-focus loses the race vs iOS's synchronous
      // keyboard-open; the guard prevents it at focus time. Taps + explicit
      // refocuses flip inputMode back to "" to allow typing.
      const guardTextarea = () => {
        if (terminal.textarea) terminal.textarea.inputMode = "none";
      };
      const blurAndGuardTextarea = () => {
        if (terminal.textarea) {
          terminal.textarea.blur();
          terminal.textarea.inputMode = "none";
        }
      };
      guardTextarea();
      terminal.textarea?.addEventListener("blur", guardTextarea, {
        signal: tapListenerAbort.signal,
      });
      // Keyboard-dismiss paths that DON'T blur the textarea (Android back,
      // OSK hide-toggle, iOS swipe-down) leave it focused with inputMode="",
      // so the next scroll's re-focus reopens the keyboard. visualViewport
      // growing back (height up, width stable) is the cross-platform
      // keyboard-hide signal — blur + re-guard there, resetting to the
      // unfocused + guarded (cold) state.
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        let prevViewportHeight = visualViewport.height;
        let prevViewportWidth = visualViewport.width;
        const onViewportResize = () => {
          const height = visualViewport.height;
          const width = visualViewport.width;
          const grew = height > prevViewportHeight + TERMINAL_KEYBOARD_HIDE_VIEWPORT_GROWTH_PX;
          const widthStable =
            Math.abs(width - prevViewportWidth) < TERMINAL_VIEWPORT_WIDTH_STABLE_PX;
          if (grew && widthStable) blurAndGuardTextarea();
          prevViewportHeight = height;
          prevViewportWidth = width;
        };
        visualViewport.addEventListener("resize", onViewportResize, {
          signal: tapListenerAbort.signal,
        });
      }
      terminal.element?.addEventListener("touchstart", handleTerminalTouchStart, {
        capture: true,
        passive: true,
        signal: tapListenerAbort.signal,
      });
      terminal.element?.addEventListener("touchmove", handleTerminalTouchMove, {
        capture: true,
        passive: true,
        signal: tapListenerAbort.signal,
      });
      terminal.element?.addEventListener("touchend", handleTerminalTouchEnd, {
        capture: true,
        passive: false,
        signal: tapListenerAbort.signal,
      });
    }

    const patchFitAddonScrollbarWidth = () => {
      if (!fitAddon.proposeDimensions) return;
      fitAddon.proposeDimensions = () => {
        if (!terminal || !terminal.element || !terminal.element.parentElement) return undefined;
        const terminalInternals = terminal as unknown as {
          _core: {
            _renderService: {
              dimensions: { css: { cell: { width: number; height: number } } };
            };
          };
        };
        const cellWidth = terminalInternals._core._renderService.dimensions.css.cell.width;
        const cellHeight = terminalInternals._core._renderService.dimensions.css.cell.height;
        if (cellWidth === 0 || cellHeight === 0) return undefined;
        const parentStyle = window.getComputedStyle(terminal.element.parentElement);
        const elementStyle = window.getComputedStyle(terminal.element);
        const availableWidth =
          Math.max(0, parseInt(parentStyle.getPropertyValue("width"))) -
          (parseInt(elementStyle.getPropertyValue("padding-right")) +
            parseInt(elementStyle.getPropertyValue("padding-left")));
        const availableHeight =
          parseInt(parentStyle.getPropertyValue("height")) -
          (parseInt(elementStyle.getPropertyValue("padding-top")) +
            parseInt(elementStyle.getPropertyValue("padding-bottom")));
        return {
          cols: Math.max(2, Math.floor(availableWidth / cellWidth)),
          rows: Math.max(1, Math.floor(availableHeight / cellHeight)),
        };
      };
    };
    patchFitAddonScrollbarWidth();

    const updateScrollbar = () => {
      const buffer = terminal.buffer.active;
      const totalLines = buffer.length;
      const visibleLines = terminal.rows;
      const isAtBottom = buffer.viewportY + visibleLines >= totalLines;
      const hasScrollback = totalLines > visibleLines;

      const track = scrollbarTrackRef.current;
      const thumb = scrollbarThumbRef.current;
      if (!track || !thumb) return;

      track.classList.toggle("xterm-scrollbar-visible", !isAtBottom && hasScrollback);

      if (hasScrollback) {
        const thumbHeightRatio = visibleLines / totalLines;
        const thumbTopRatio = buffer.viewportY / totalLines;
        thumb.style.height = `${thumbHeightRatio * 100}%`;
        thumb.style.top = `${thumbTopRatio * 100}%`;
      }
    };
    updateScrollbar();
    const scrollDisposable = terminal.onScroll(updateScrollbar);
    outputBatcher.setAfterFlush(updateScrollbar);

    let isDragging = false;
    let dragStartY = 0;
    let dragStartViewportY = 0;

    const handleThumbPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      isDragging = true;
      dragStartY = event.clientY;
      dragStartViewportY = terminal.buffer.active.viewportY;
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture not available */
      }
      event.preventDefault();
    };

    const handleThumbPointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      const trackEl = scrollbarTrackRef.current;
      if (!trackEl) return;
      const trackHeight = trackEl.clientHeight;
      const buffer = terminal.buffer.active;
      const totalLines = buffer.length - terminal.rows;
      if (totalLines <= 0 || trackHeight <= 0) return;
      const pixelsPerLine = trackHeight / totalLines;
      const deltaY = event.clientY - dragStartY;
      const targetViewportY = Math.max(
        0,
        Math.min(totalLines, dragStartViewportY + Math.round(deltaY / pixelsPerLine)),
      );
      if (targetViewportY !== terminal.buffer.active.viewportY) {
        terminal.scrollLines(targetViewportY - terminal.buffer.active.viewportY);
      }
    };

    const handleThumbPointerUp = () => {
      isDragging = false;
    };

    const handleTrackPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target === scrollbarThumbRef.current) return;
      const trackEl = scrollbarTrackRef.current;
      if (!trackEl) return;
      const trackRect = trackEl.getBoundingClientRect();
      const clickRatio = (event.clientY - trackRect.top) / trackRect.height;
      const buffer = terminal.buffer.active;
      const totalLines = buffer.length;
      const targetViewportY = Math.max(
        0,
        Math.min(
          totalLines - terminal.rows,
          Math.round(clickRatio * totalLines) - Math.floor(terminal.rows / 2),
        ),
      );
      terminal.scrollLines(targetViewportY - buffer.viewportY);
    };

    const thumbEl = scrollbarThumbRef.current;
    const trackEl = scrollbarTrackRef.current;
    if (thumbEl) {
      thumbEl.addEventListener("pointerdown", handleThumbPointerDown);
      thumbEl.addEventListener("pointermove", handleThumbPointerMove);
      thumbEl.addEventListener("pointerup", handleThumbPointerUp);
      thumbEl.addEventListener("pointercancel", handleThumbPointerUp);
    }
    if (trackEl) {
      trackEl.addEventListener("pointerdown", handleTrackPointerDown);
    }

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
      /* webgl unavailable; xterm falls back to dom renderer */
    }

    const kittyPushDisposable = terminal.parser.registerCsiHandler(
      { prefix: ">", final: "u" },
      (params) => {
        const first = params[0];
        const flags = typeof first === "number" ? first : 1;
        kittyFlagStack.push(flags);
        return true;
      },
    );
    const kittyPopDisposable = terminal.parser.registerCsiHandler(
      { prefix: "<", final: "u" },
      (params) => {
        const first = params[0];
        const count = typeof first === "number" && first > 0 ? first : 1;
        for (let popIndex = 0; popIndex < count && kittyFlagStack.length > 1; popIndex += 1) {
          kittyFlagStack.pop();
        }
        return true;
      },
    );
    const kittySetDisposable = terminal.parser.registerCsiHandler(
      { prefix: "=", final: "u" },
      (params) => {
        const first = params[0];
        const second = params[1];
        // Sub-params (number arrays) aren't defined for kitty `=`. Bail rather
        // than coerce them to 0, which would silently nuke the stack entry.
        if (typeof first !== "number") return true;
        const flags = first;
        const mode =
          typeof second === "number" && second > 0 ? second : KITTY_KEYBOARD_SET_MODE_REPLACE;
        const top = kittyFlagStack.length - 1;
        const current = kittyFlagStack[top] ?? 0;
        if (mode === KITTY_KEYBOARD_SET_MODE_REPLACE) {
          kittyFlagStack[top] = flags;
        } else if (mode === KITTY_KEYBOARD_SET_MODE_OR) {
          kittyFlagStack[top] = current | flags;
        } else if (mode === KITTY_KEYBOARD_SET_MODE_AND_NOT) {
          kittyFlagStack[top] = current & ~flags;
        }
        return true;
      },
    );
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

    setCaffeinateModeRef.current = (mode: CaffeinateMode) =>
      send({ type: "caffeinate-mode", mode });
    setCaffeinateCommandsRef.current = (commands: string[]) =>
      send({ type: "caffeinate-commands", commands });
    setCaffeinateActivityGateRef.current = (enabled: boolean) =>
      send({ type: "caffeinate-activity-gate", enabled });
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

    terminal.attachCustomWheelEventHandler((event) => {
      if (shouldSuppressAltBufferWheel(event, terminal)) {
        event.preventDefault();
        return false;
      }
      return true;
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === "Tab" && (event.metaKey || event.ctrlKey)) return false;
      if (isNewTabShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          const newShellLink = document.getElementById("new-shell-link");
          if (newShellLink instanceof HTMLAnchorElement) newShellLink.click();
        }
        return false;
      }
      if (isCommandPaletteShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          toggleCommandPaletteRef.current?.();
        }
        return false;
      }
      if (isAutomationsShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          toggleAutomationsRef.current?.();
        }
        return false;
      }
      if (isDiffViewerShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          openDiffViewerRef.current?.();
        }
        return false;
      }
      if (isWorktreesCreateShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          void createWorktreeRef.current?.({}, true);
        }
        return false;
      }
      if (isWorktreesShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          toggleWorktreesRef.current?.();
        }
        return false;
      }
      if (isSessionsShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          toggleSessionsRef.current?.();
        }
        return false;
      }
      if (isPortsShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          togglePortsRef.current?.();
        }
        return false;
      }
      if (isFindShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          openSearchOverlayRef.current?.();
        }
        return false;
      }
      // xterm.js's default keyboard handler ignores Shift/Ctrl/Meta on Enter
      // and sends bare \r for all of them, so TUIs can't distinguish Shift+Enter
      // from Enter. Three-tier dispatch:
      //   1. Kitty disambiguate flag is active -> emit `CSI 13;mods+1 u` for any
      //      modifier+Enter (including Alt, since the TUI explicitly asked for
      //      the new protocol and prefers it over the legacy \e\r form).
      //   2. Plain Shift+Enter without kitty -> emit LF. This matches the
      //      iTerm2/VS Code/Terminal.app convention that Ink-based TUIs (Claude
      //      Code, Cursor Agent) read as "newline within input". Bash/zsh/fish
      //      bind \n to accept-line just like \r so shells are unaffected.
      //   3. Anything else (plain Enter, Alt-only, Ctrl/Cmd+Enter without
      //      kitty) -> fall through to xterm.js so app-specific bindings keep
      //      working.
      if (event.type === "keydown" && event.key === "Enter") {
        const modifierBits = extractKeyboardModifiers(event);
        const isKittyDisambiguateActive =
          (getKittyFlags() & KITTY_KEYBOARD_DISAMBIGUATE_FLAG) !== 0;
        if (modifierBits !== 0 && isKittyDisambiguateActive) {
          event.preventDefault();
          send({ type: "input", data: buildKittyKeySequence(ENTER_KEY_CODE, modifierBits) });
          return false;
        }
        if (modifierBits === KEYBOARD_MODIFIER_SHIFT_BIT) {
          event.preventDefault();
          send({ type: "input", data: "\n" });
          return false;
        }
      }
      return true;
    });

    const applyIncomingTitle = (rawTitle: string) => {
      if (exited) return;
      const trimmed = rawTitle.trim();
      if (!trimmed) return;
      lastTitle = trimmed;
      document.title = titleForLiveSession(trimmed);
    };

    refocusTerminalRef.current = focusTerminalForInput;
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
      send({
        type: "resize",
        cols,
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
      send: (data) => send({ type: "input", data }),
      isSafeState: () => !hasForegroundProcess && terminal.buffer.active.type === "normal",
    });
    localEcho.setEnabled(activeLocalEchoRef.current);
    localEchoRef.current = localEcho;

    terminal.onData((data) => {
      // During a scrollback replay xterm re-emits responses to the stale query
      // requests in the ring buffer; dropping them here (instead of forwarding
      // to the live PTY) is the bounded fix for the switch-time leak. User
      // keystrokes share onData and are dropped too, but the replay drain is
      // short (a screenful parses inside xterm's 12ms synchronous budget) and
      // the user is not typing in the moment after a switch.
      if (suppressOutput) return;
      for (const chunk of chunkInputByCodeUnits(data, MAX_INPUT_BYTES)) {
        localEcho.handleInput(chunk);
      }
    });
    terminal.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
      updateScrollbar();
    });

    const observer = new ResizeObserver(scheduleFit);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        if (faviconBadge) {
          faviconBadge = false;
          setTabFaviconState(faviconState);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    observer.observe(container);
    fitToContainer();
    requestAnimationFrame(() => terminal.focus());

    const showDeadSessionMask = (exitCode: number | null) => {
      if (disposed) return;
      resetFavicon();
      setTabFaviconState("dead");
      terminal.write(formatShellExitMarker(exitCode));
      document.title = titleForDeadSession(lastTitle);
      setExitInfo({ reason: "shell-exited", exitCode });
      setSessionInfo(null);
    };
    const markShellDead = (exitCode: number | null) => {
      if (exited) return;
      exited = true;
      // The PTY is gone — drop its id so a manual Reconnect spawns a fresh
      // shell instead of trying to reattach to the dead one, and clear the
      // address-bar ?sid= so a refresh here never targets the dead PTY.
      liveSessionId = null;
      liveSessionIdRef.current = null;
      syncSessionIdQueryParam(null);
      if (exitCode !== null && exitCode !== 0) {
        // Non-zero exit — surface immediately. The server's onExit deliberately
        // skips closeTab on non-clean codes so the tab stays as the failure mask.
        showDeadSessionMask(exitCode);
        return;
      }
      const settleAndMask = () => {
        window.close();
        setTimeout(() => showDeadSessionMask(exitCode), 100);
      };
      if (cdpControlled) {
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
      if (exited) return;
      exited = true;
      resetFavicon();
      setTabFaviconState("dead");
      document.title = titleForDeadSession(lastTitle);
      setExitInfo({ reason: "connection-lost", closeCode, closeReason, wasClean });
      setSessionInfo(null);
    };

    const connect = () => {
      if (disposed) return;
      const connectSid = nextConnectSid;
      nextConnectSid = null;
      const nextSocket = new WebSocket(
        buildWebSocketUrl(liveCwdRef.current, connectSid ?? liveSessionId),
      );
      socket = nextSocket;

      nextSocket.binaryType = "arraybuffer";
      nextSocket.addEventListener("open", () => {
        if (disposed || socket !== nextSocket) return;
        wasEverConnected = true;
        wsConnectedRef.current = true;
        setConsecutiveFailures(0);
        sendResize(terminal.cols, terminal.rows);
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
          if (inReplay) {
            // Buffer replay frames; they are written as one suppressed block
            // when `replay-end` lands, so xterm's responses to the stale query
            // requests never reach the live PTY.
            replayChunks.push(new Uint8Array(event.data));
            return;
          }
          const bytes = new Uint8Array(event.data);
          outputBatcher.pushBytes(localEcho.hasPending() ? localEcho.reconcile(bytes) : bytes);
          noteOutputActivity();
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
          const priorSessionId = liveSessionId;
          // A new session frame means a fresh attach: drop any suppressed-replay
          // window left open by a prior (possibly failed) attach — its replay
          // is moot now, and an unbalanced window would leave onData suppressed
          // (a dead terminal). Re-opened below if this attach wants a replay.
          inReplay = false;
          replayChunks = [];
          suppressOutput = false;
          localEcho.flush();
          reattachPending = false;
          reattachCloseCode = 0;
          reattachCloseReason = "";
          if (message.id) {
            if (priorSessionId !== null && message.id !== priorSessionId) {
              previousSessionIdRef.current = priorSessionId;
            }
            liveSessionId = message.id;
            liveSessionIdRef.current = message.id;
            syncSessionIdQueryParam(message.id);
          }
          // A switch (or a missed reattach that spawned a fresh shell): the
          // new PTY is a different one than the tab was just viewing, so reset
          // the terminal and ask the server to replay its scrollback before
          // live fan-out begins. The replay lands as one binary frame right
          // after this, so the screen shows the PTY's recent output instead
          // of the prior PTY's stale content.
          const isSwitch = priorSessionId !== null && message.id !== priorSessionId;
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
          setSessionInfo({
            shell: message.shell,
            shellName: message.shellName,
            pid: message.pid,
            cwd: message.cwd,
            title: message.title,
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
            inReplay = true;
            suppressOutput = true;
            replayChunks = [];
          }
          send({ type: "ready", replay: wantsReplay });
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
          const chunks = replayChunks;
          inReplay = false;
          replayChunks = [];
          if (chunks.length === 0) {
            suppressOutput = false;
          } else {
            const finishReplay = () => {
              suppressOutput = false;
              updateScrollbar();
            };
            for (let index = 0; index < chunks.length; index += 1) {
              terminal.write(chunks[index], index === chunks.length - 1 ? finishReplay : undefined);
            }
          }
        } else if (message.type === "automations") {
          setAutomations(message.automations);
        } else if (message.type === "caffeinate") {
          setCaffeinateSupported(message.supported);
          setCaffeinateActive(message.active);
          setCaffeinateMode(message.mode);
          setCaffeinateDefaultCommands(message.defaultCommands);
          setCaffeinateCommands(message.commands);
          setCaffeinateActivityGate(message.activityGate);
          setCaffeinateBatteryThreshold(message.batteryThreshold);
          caffeinateActiveTriggerRef.current = message.activeTrigger;
        } else if (message.type === "cwd") {
          setLiveCwd(message.cwd);
          setGitDiffSummary(null);
        } else if (message.type === "git-diff-summary") {
          setGitDiffSummary(message.summary);
          setGitDirtyVersion((version) => (version ?? 0) + 1);
        } else if (message.type === "foreground") {
          const nowHasProcess = message.process !== null;
          if (nowHasProcess) {
            hadForegroundThisCycle = true;
          } else if (faviconState === "alive-quiet") {
            if (document.hidden && hadForegroundThisCycle) faviconBadge = true;
            faviconState = "ready";
            hadForegroundThisCycle = false;
            setTabFaviconState("ready", faviconBadge);
          }
          hasForegroundProcess = nowHasProcess;
        } else if (message.type === "notification") {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(message.body);
          }
        } else if (message.type === "exit") {
          resetFavicon();
          markShellDead(message.code);
        } else if (message.type === "cdp-controlled") {
          cdpControlled = message.controlled;
        }
      });

      nextSocket.addEventListener("close", (event) => {
        if (socket !== nextSocket) return;
        socket = null;
        wsConnectedRef.current = false;
        cdpControlled = false;
        if (disposed) return;
        if (exited) return;
        localEcho.flush();
        if (wasEverConnected) {
          // Surface close metadata in DevTools so "the terminal randomly dies"
          // reports always come back with a concrete code/reason instead of
          // the previous black-box `null` exit.
          console.warn(
            `[localterm] websocket closed: code=${event.code} reason=${JSON.stringify(event.reason)} wasClean=${event.wasClean}`,
          );
          // Silent-reattach attempt: the daemon keeps the PTY alive across
          // this drop, and on a successful reattach the user should see nothing
          // — mid-keystroke interactive CLIs continue uninterrupted. We stash
          // the close info and schedule a direct reconnect (bypassing the
          // connection-lost/modal path that fires `exited = true`). If the
          // silent reconnect itself closes before a session frame lands
          // (daemon genuinely down), fall through to markConnectionLost with
          // the stashed close info.
          if (liveSessionId && !reattachPending) {
            reattachPending = true;
            reattachCloseCode = event.code;
            reattachCloseReason = event.reason;
            reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
            return;
          }
          if (reattachPending) {
            const stashedCode = reattachCloseCode;
            const stashedReason = reattachCloseReason;
            reattachPending = false;
            reattachCloseCode = 0;
            reattachCloseReason = "";
            markConnectionLost(stashedCode, stashedReason, event.wasClean);
            return;
          }
          markConnectionLost(event.code, event.reason, event.wasClean);
          return;
        }
        setConsecutiveFailures((previous) => previous + 1);
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
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
      // Reset the per-session "we're done" flags so a Reconnect after a shell
      // exit *or* a transport-level connection loss actually opens a fresh WS.
      // The server always spawns a new PTY on connect; the alternative ("must
      // open a new tab") loses the user's tab state for a recoverable failure.
      exited = false;
      wasEverConnected = false;
      cdpControlled = false;
      reattachPending = false;
      reattachCloseCode = 0;
      reattachCloseReason = "";
      wsConnectedRef.current = false;
      setExitInfo(null);
      setSessionInfo(null);
      setConsecutiveFailures(0);
      setTabFaviconState("ready");
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
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
    switchSessionRef.current = (sid: string) => {
      if (disposed) return;
      if (sid === liveSessionId) return;
      nextConnectSid = sid;
      triggerHapticFeedback(HAPTIC_TAP_MS);
      manualReconnectRef.current?.();
    };

    connect();
    terminalInitializedRef.current = true;

    return () => {
      disposed = true;
      terminalInitializedRef.current = false;
      if (thumbEl) {
        thumbEl.removeEventListener("pointerdown", handleThumbPointerDown);
        thumbEl.removeEventListener("pointermove", handleThumbPointerMove);
        thumbEl.removeEventListener("pointerup", handleThumbPointerUp);
        thumbEl.removeEventListener("pointercancel", handleThumbPointerUp);
      }
      if (trackEl) {
        trackEl.removeEventListener("pointerdown", handleTrackPointerDown);
      }
      searchResultsDisposable.dispose();
      scrollDisposable.dispose();
      kittyPushDisposable.dispose();
      kittyPopDisposable.dispose();
      kittySetDisposable.dispose();
      scrollbackPurgeDisposable.dispose();
      selectiveScrollbackPurgeDisposable.dispose();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      clearResizeScrollRestore();
      resetFavicon();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
      tapListenerAbort.abort();
      try {
        socket?.close();
      } catch {
        /* socket already closed */
      }
      socket = null;
      localEcho.dispose();
      localEchoRef.current = null;
      outputBatcher.detach();
      terminal.dispose();
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = effectiveThemeWithExtendedPalette;
  }, [effectiveThemeWithExtendedPalette]);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
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
  }, [effectiveFont, activeNerdFontEnabled]);

  const handleThemeChange = useCallback((nextThemeId: string) => {
    setActiveThemeId(nextThemeId);
    setPreviewThemeId(null);
    storeTerminalThemeId(nextThemeId);
  }, []);

  const handleFontChange = useCallback((nextFontId: string) => {
    setActiveFontId(nextFontId);
    setPreviewFontId(null);
    storeTerminalFontId(nextFontId);
  }, []);

  const handleNerdFontEnabledChange = useCallback((nextEnabled: boolean) => {
    setActiveNerdFontEnabled(nextEnabled);
    storeNerdFontEnabled(nextEnabled);
  }, []);

  const handleLigaturesEnabledChange = useCallback((nextEnabled: boolean) => {
    setActiveLigaturesEnabled(nextEnabled);
    storeLigaturesEnabled(nextEnabled);
  }, []);

  // registerCharacterJoiner/deregisterCharacterJoiner each refresh the whole
  // viewport in xterm core, so toggling re-rasters joined spans without an
  // explicit refresh. The id guards keep the register/deregister idempotent
  // across effect re-runs.
  useEffect(() => {
    if (!terminalInitializedRef.current) return;
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
  }, [activeLigaturesEnabled]);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = activeFontSize;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [activeFontSize]);

  const handleFontSizeChange = useCallback((nextFontSize: number) => {
    const clamped = clampTerminalFontSize(nextFontSize);
    setActiveFontSize(clamped);
    storeTerminalFontSize(clamped);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.lineHeight = activeLineHeight;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [activeLineHeight]);

  const handleLineHeightChange = useCallback((nextLineHeight: number) => {
    const clamped = clampTerminalLineHeight(nextLineHeight);
    setActiveLineHeight(clamped);
    storeTerminalLineHeight(clamped);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorStyle = effectiveCursorStyle;
  }, [effectiveCursorStyle]);

  const handleCursorStyleChange = useCallback((nextCursorStyle: TerminalCursorStyle) => {
    setActiveCursorStyle(nextCursorStyle);
    setPreviewCursorStyle(null);
    storeTerminalCursorStyle(nextCursorStyle);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorBlink = activeCursorBlink;
  }, [activeCursorBlink]);

  useEffect(() => {
    activeLocalEchoRef.current = activeLocalEcho;
    localEchoRef.current?.setEnabled(activeLocalEcho);
  }, [activeLocalEcho]);

  const handleLocalEchoChange = useCallback((nextLocalEcho: boolean) => {
    setActiveLocalEcho(nextLocalEcho);
    storeStoredLocalEcho(nextLocalEcho);
  }, []);

  const handleCursorBlinkChange = useCallback((nextCursorBlink: boolean) => {
    setActiveCursorBlink(nextCursorBlink);
    storeTerminalCursorBlink(nextCursorBlink);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = activeScrollback;
  }, [activeScrollback]);

  const handleScrollbackChange = useCallback((nextScrollback: number) => {
    setActiveScrollback(nextScrollback);
    storeTerminalScrollback(nextScrollback);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollOnUserInput = activeScrollOnUserInput;
  }, [activeScrollOnUserInput]);

  const handleScrollOnUserInputChange = useCallback((nextScrollOnUserInput: boolean) => {
    setActiveScrollOnUserInput(nextScrollOnUserInput);
    storeTerminalScrollOnUserInput(nextScrollOnUserInput);
  }, []);

  useEffect(() => {
    if (!terminalInitializedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
  }, [activePaddingX, activePaddingY]);

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
      subscribeStoredTerminalScrollback(setActiveScrollback),
      subscribeStoredTerminalScrollOnUserInput(setActiveScrollOnUserInput),
      subscribeStoredTerminalPaddingX(setActivePaddingX),
      subscribeStoredTerminalPaddingY(setActivePaddingY),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

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

  const handleCaffeinateBatteryThresholdChange = useCallback((percent: number | null) => {
    setCaffeinateBatteryThresholdRef.current?.(percent);
  }, []);

  const handleKeepAwakePopoverOpenChange = useCallback((open: boolean) => {
    setIsKeepAwakePopoverOpen(open);
    if (!open) setIsActionsMenuOpen(false);
  }, []);

  const handleSessionsOpenChange = useCallback((open: boolean) => {
    setIsSessionsOpen(open);
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
  }, []);

  const handlePortsOpenChange = useCallback((open: boolean) => {
    setIsPortsOpen(open);
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
  }, []);

  const handleQrOpenChange = useCallback((open: boolean) => {
    setIsQrOpen(open);
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
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return;
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isSearchOpen, searchOpenAttempt]);

  const findNextMatch = useCallback((query: string) => {
    if (!query) {
      searchAddonRef.current?.clearDecorations();
      setSearchResults({ resultIndex: -1, resultCount: 0 });
      return;
    }
    searchAddonRef.current?.findNext(query, { decorations: SEARCH_DECORATION_OPTIONS });
  }, []);

  const findPreviousMatch = useCallback((query: string) => {
    if (!query) return;
    searchAddonRef.current?.findPrevious(query, { decorations: SEARCH_DECORATION_OPTIONS });
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setSearchResults({ resultIndex: -1, resultCount: 0 });
    searchAddonRef.current?.clearDecorations();
    refocusTerminalRef.current?.();
  }, []);

  const handleToolbarAreaEnter = useCallback(() => {
    if (toolbarHoverTimeoutRef.current !== null) {
      window.clearTimeout(toolbarHoverTimeoutRef.current);
      toolbarHoverTimeoutRef.current = null;
    }
    setIsToolbarHovered(true);
  }, []);

  const handleToolbarAreaLeave = useCallback((event: React.MouseEvent) => {
    const leftThroughViewportEdge = event.clientY <= 0 || event.clientX >= window.innerWidth - 1;
    const delay = leftThroughViewportEdge
      ? TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS
      : TOOLBAR_HIDE_DELAY_MS;
    toolbarHoverTimeoutRef.current = window.setTimeout(() => {
      toolbarHoverTimeoutRef.current = null;
      if (!isSettingsPopoverOpenRef.current && !isAutomationsOpenRef.current) {
        setIsToolbarHovered(false);
      }
    }, delay);
  }, []);

  const handleSettingsPopoverOpenChange = useCallback((open: boolean) => {
    setIsSettingsPopoverOpen(open);
    if (!open) {
      setIsActionsMenuOpen(false);
      if (toolbarHoverTimeoutRef.current !== null) {
        window.clearTimeout(toolbarHoverTimeoutRef.current);
      }
      toolbarHoverTimeoutRef.current = window.setTimeout(() => {
        toolbarHoverTimeoutRef.current = null;
        setIsToolbarHovered(false);
      }, TOOLBAR_HIDE_DELAY_MS);
    }
  }, []);

  const handleAutomationsOpenChange = useCallback((open: boolean) => {
    setIsAutomationsOpen(open);
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
  }, []);

  const toggleAutomations = useCallback(() => {
    handleAutomationsOpenChange(!isAutomationsOpenRef.current);
  }, [handleAutomationsOpenChange]);
  toggleAutomationsRef.current = toggleAutomations;

  const handleWorktreesOpenChange = useCallback((open: boolean) => {
    setIsWorktreesOpen(open);
    if (open) {
      setIsActionsMenuOpen(false);
      setIsCommandPaletteOpen(false);
      setWorktreeCreateError(null);
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
  }, []);

  const openWorktrees = useCallback(() => {
    setIsWorktreesOpen(true);
    setIsCommandPaletteOpen(false);
  }, []);
  openWorktreesRef.current = openWorktrees;

  const toggleWorktrees = useCallback(() => {
    handleWorktreesOpenChange(!isWorktreesOpenRef.current);
  }, [handleWorktreesOpenChange]);
  toggleWorktreesRef.current = toggleWorktrees;

  const toggleSessions = useCallback(() => {
    handleSessionsOpenChange(!isSessionsOpenRef.current);
  }, [handleSessionsOpenChange]);
  toggleSessionsRef.current = toggleSessions;

  const togglePorts = useCallback(() => {
    handlePortsOpenChange(!isPortsOpenRef.current);
  }, [handlePortsOpenChange]);
  togglePortsRef.current = togglePorts;

  const openShellAt = useCallback((shellCwd: string, command?: string) => {
    window.open(buildNewTabUrl(shellCwd, command), "_blank", "noopener,noreferrer");
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
    setIsSearchOpen(true);
    setIsActionsMenuOpen(false);
    setIsCommandPaletteOpen(false);
    setSearchOpenAttempt((previous) => previous + 1);
  }, []);
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

  const handleSearchInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setSearchQuery(next);
      findNextMatch(next);
    },
    [findNextMatch],
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isFindShortcut(event.nativeEvent, isMac)) {
        event.preventDefault();
        event.currentTarget.select();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          findPreviousMatch(searchQuery);
        } else {
          findNextMatch(searchQuery);
        }
      }
    },
    [closeSearch, findNextMatch, findPreviousMatch, isMac, searchQuery],
  );

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

  const newTabUrl = buildNewTabUrl(liveCwd);

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
        const terminal = terminalRef.current;
        if (terminal) {
          terminal.focus();
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
  const matchLabel =
    searchResults.resultCount === 0
      ? "0/0"
      : `${searchResults.resultIndex + 1}/${searchResults.resultCount}`;

  const pageBackground = effectiveTheme.colors.background ?? FALLBACK_TERMINAL_BACKGROUND_HEX;

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
        action: () => {
          const link = document.getElementById("new-shell-link");
          if (link instanceof HTMLAnchorElement) link.click();
        },
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
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
      }}
    >
      <div className="relative h-full w-full">
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
            isToolbarVisible || isSearchOpen || hasToolbarIndicator || isTouchDevice
              ? "pointer-events-auto"
              : "pointer-events-none",
          )}
          onMouseEnter={isTouchDevice ? undefined : handleToolbarAreaEnter}
          onMouseLeave={isTouchDevice ? undefined : handleToolbarAreaLeave}
        >
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-auto mr-0.5 h-[2px] w-5 rounded-full bg-muted-foreground/25 transition-opacity duration-150",
              isToolbarVisible || isSearchOpen || hasToolbarIndicator || isTouchDevice
                ? "opacity-0"
                : "opacity-100",
            )}
          />
          {!isSearchOpen && (
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="terminal actions"
              className={cn(
                "mt-1 flex max-w-[calc(100dvw-1.5rem)] items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 text-muted-foreground shadow-xs backdrop-blur-md",
                "transition-[opacity,transform] duration-200 ease-snappy",
                isTouchDevice &&
                  "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                isToolbarVisible || hasToolbarIndicator || isTouchDevice
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
                    fontId={activeFontId}
                    onFontChange={handleFontChange}
                    onFontPreview={setPreviewFontId}
                    nerdFontEnabled={activeNerdFontEnabled}
                    onNerdFontEnabledChange={handleNerdFontEnabledChange}
                    ligaturesEnabled={activeLigaturesEnabled}
                    onLigaturesEnabledChange={handleLigaturesEnabledChange}
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
                    scrollback={activeScrollback}
                    onScrollbackChange={handleScrollbackChange}
                    scrollOnUserInput={activeScrollOnUserInput}
                    onScrollOnUserInputChange={handleScrollOnUserInputChange}
                    paddingX={activePaddingX}
                    onPaddingXChange={handlePaddingXChange}
                    paddingY={activePaddingY}
                    onPaddingYChange={handlePaddingYChange}
                    notificationsPermission={notificationsPermission}
                    onNotificationsPermissionRequest={handleNotificationsPermissionRequest}
                    sessionInfo={sessionInfo}
                    onPopoverOpenChange={handleSettingsPopoverOpenChange}
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
                  <AutomationsButton
                    onOpen={() => handleAutomationsOpenChange(true)}
                    isMac={isMac}
                  />
                  <WorktreesButton onOpen={() => handleWorktreesOpenChange(true)} isMac={isMac} />
                  <SessionsButton onOpen={() => handleSessionsOpenChange(true)} isMac={isMac} />
                  <PortsButton onOpen={() => handlePortsOpenChange(true)} />
                  {caffeinateSupported ? (
                    <KeepAwakeMenu
                      mode={caffeinateMode}
                      active={caffeinateActive}
                      activityGate={caffeinateActivityGate}
                      batteryThreshold={caffeinateBatteryThreshold}
                      defaultCommands={caffeinateDefaultCommands}
                      commands={caffeinateCommands}
                      activeTriggerRef={caffeinateActiveTriggerRef}
                      onModeChange={handleCaffeinateModeChange}
                      onCommandsChange={handleCaffeinateCommandsChange}
                      onActivityGateChange={handleCaffeinateActivityGateChange}
                      onBatteryThresholdChange={handleCaffeinateBatteryThresholdChange}
                      onPopoverOpenChange={handleKeepAwakePopoverOpenChange}
                      onClose={refocusTerminalRef.current ?? undefined}
                    />
                  ) : null}
                  <a
                    id="new-shell-link"
                    href={newTabUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={-1}
                    aria-hidden="true"
                    className="sr-only"
                  />
                  <QrButton onOpen={() => handleQrOpenChange(true)} />
                </div>
              </div>
              {isTouchDevice || (hasDiff && diffSummary !== null) || branchPrDisplayState ? (
                <div className="flex shrink-0 items-center">
                  {hasDiff && diffSummary !== null ? (
                    <button
                      type="button"
                      onClick={openDiffViewer}
                      aria-label={`view git diff: ${diffSummary.additions} additions, ${diffSummary.deletions} deletions${diffSummary.binaries > 0 ? `, ${diffSummary.binaries} binary files changed` : ""}`}
                      title={`${isMac ? "⌘" : "Ctrl+"}G`}
                      className="flex h-8 items-center gap-1 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="text-emerald-400">
                        +{formatDiffCount(diffSummary.additions)}
                      </span>
                      <span className="text-red-400">
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
                  {branchPr && branchPrDisplayState && BranchPrIcon ? (
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
        onOpenNewShell={() => window.open(newTabUrl, "_blank", "noopener,noreferrer")}
        onClose={() => handleSessionsOpenChange(false)}
      />

      <PortsModal
        open={isPortsOpen}
        isTouchDevice={isTouchDevice}
        onClose={() => handlePortsOpenChange(false)}
      />

      <QrModal
        open={isQrOpen}
        liveSessionIdRef={liveSessionIdRef}
        switchSessionRef={switchSessionRef}
        onClose={() => handleQrOpenChange(false)}
      />

      <AlertDialog open={isModalOpen}>
        <AlertDialogContent>
          {exitInfo !== null ? (
            exitInfo.reason === "shell-exited" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Shell ended</AlertDialogTitle>
                  <AlertDialogDescription>
                    {exitInfo.exitCode === null || exitInfo.exitCode === 0
                      ? "Open a new shell to keep going, or close this tab."
                      : `Exit code ${exitInfo.exitCode}. Open a new shell to keep going.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction
                    onClick={() => window.open(newTabUrl, "_blank", "noopener,noreferrer")}
                  >
                    New shell
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
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
                <AlertDialogTitle className="flex items-center gap-2">
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
    </div>
  );
};
