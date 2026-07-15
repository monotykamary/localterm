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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OnScreenKeyboard } from "@/components/on-screen-keyboard/on-screen-keyboard";
import { useDeviceTier } from "@/hooks/use-device-tier";
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
import { ToastProvider, Toaster, useToast } from "@/components/ui/toast";
import { AutomationsButton } from "@/components/automations-menu";
import { AutomationsModal } from "@/components/automations-modal";
import { CommandPalette, type CommandItem } from "@/components/command-palette";
import { DiffViewer } from "@/components/diff-viewer";
import { KeepAwakeMenu, type CaffeinateMode } from "@/components/keep-awake-menu";
import { PortsButton } from "@/components/ports-menu";
import { PortsModal } from "@/components/ports-modal";
import { QrButton } from "@/components/qr-button";
import { QrModal } from "@/components/qr-modal";
import { SecretsButton } from "@/components/secrets-menu";
import { SecretsModal } from "@/components/secrets-modal";
import { SessionsButton } from "@/components/sessions-menu";
import { SessionsModal } from "@/components/sessions-modal";
import { SettingsMenu } from "@/components/settings-menu";
import { WorktreesButton } from "@/components/worktrees-menu";
import { WorktreesModal } from "@/components/worktrees-modal";
import { useGitBranchInfo } from "@/hooks/use-git-branch-info";
import { useGitDiffSummary } from "@/hooks/use-git-diff-summary";
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
import { useTerminalSettings } from "@/hooks/use-terminal-settings";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { createGitWorktree, type CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";
import {
  COPY_FEEDBACK_MS,
  PASTED_IMAGE_FEEDBACK_MS,
  PASTED_IMAGE_TOAST_ID,
  DEAD_SESSION_TITLE_PREFIX,
  DEFAULT_DOCUMENT_TITLE,
  DISCONNECT_MODAL_THRESHOLD_FAILURES,
  TERMINAL_TAP_MOVEMENT_THRESHOLD_PX,
  TERMINAL_TAB_SEQUENCE,
  TERMINAL_BACK_TAB_SEQUENCE,
  TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX,
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
  NOTIFICATION_TAG_PREFIX,
  NOTIFICATION_TITLE,
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
  WS_OUTPUT_BROTLI,
  WS_OUTPUT_BROTLI_CTX,
  WS_OUTPUT_CTX_HEADER_BYTES,
  WS_OUTPUT_GZIP,
  WS_OUTPUT_RAW,
} from "@/lib/constants";
import {
  AMBIENT_TAB_CLOSE_DEADLINE_MS,
  LOCALTERM_TAB_TOKEN_EVENT,
  LOCALTERM_TAB_TOKEN_PROPERTY,
  LOCALTERM_PANE_TEXT_PROPERTY,
  LOCALTERM_MOUSE_CELLS_PROPERTY,
  serverToClientMessageSchema,
  type AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { TERMINAL_CURSOR_STYLES, isTerminalCursorStyle } from "@/lib/terminal-cursor";
import { TERMINAL_FONTS, familyForFont, findTerminalFontById } from "@/lib/terminal-fonts";
import type { TerminalSessionInfo } from "@/lib/terminal-session-info";
import { TERMINAL_THEMES, findTerminalThemeById } from "@/lib/terminal-themes";
import { generateExtendedPalette } from "@/utils/generate-extended-palette";
import { awaitFontReady } from "@/utils/await-font-ready";
import { buildKittyKeySequence } from "@/utils/build-kitty-key-sequence";
import { buildTerminalEditingOutput } from "@/utils/build-terminal-editing-output";
import {
  captureTerminalScrollAnchor,
  type TerminalScrollAnchor,
} from "@/utils/capture-terminal-scroll-anchor";
import { EmojiWidthUnicodeProvider } from "@/utils/emoji-width-unicode-provider";
import { extractKeyboardModifiers } from "@/utils/extract-keyboard-modifiers";
import { fitTerminalPreservingScroll } from "@/utils/fit-terminal-preserving-scroll";
import { formatShellExitMarker } from "@/utils/format-shell-exit-marker";
import { dismissSystemKeyboard } from "@/utils/dismiss-system-keyboard";
import { triggerHapticFeedback } from "@/utils/haptic-feedback";
import { chunkInputByCodeUnits } from "@/utils/chunk-input-by-code-units";
import { restoreTerminalScrollAnchor } from "@/utils/restore-terminal-scroll-anchor";
import { outputBatcher } from "@/utils/write-terminal-output";
import { shouldBlockTerminalScrollbackPurge } from "@/utils/should-block-terminal-scrollback-purge";
import { shouldSuppressSessionNotification } from "@/utils/should-suppress-session-notification";
import { suppressTerminalSystemKeyboard } from "@/utils/suppress-terminal-system-keyboard";
import { subscribeTerminalUserInput } from "@/utils/subscribe-terminal-user-input";
import { detectIsMacPlatform } from "@/utils/detect-is-mac-platform";
import { detectLikelyKeepAwakeSupported } from "@/utils/detect-likely-keep-awake-supported";
import { formatDiffCount } from "@/utils/format-diff-count";
import { shellQuoteArg } from "@/utils/shell-quote-arg";
import { uploadPastedImage } from "@/utils/upload-pasted-image";
import { buildFileUrl } from "@/utils/build-file-url";
import { isAutomationsShortcut } from "@/utils/is-automations-shortcut";
import { isBinaryMessageData } from "@/utils/is-binary-message-data";
import { isCommandPaletteShortcut } from "@/utils/is-command-palette-shortcut";
import { isDiffViewerShortcut } from "@/utils/is-diff-viewer-shortcut";
import { isFindShortcut } from "@/utils/is-find-shortcut";
import { isNewTabShortcut } from "@/utils/is-new-tab-shortcut";
import { isPortsShortcut } from "@/utils/is-ports-shortcut";
import { isSecretsShortcut } from "@/utils/is-secrets-shortcut";
import { isSessionsShortcut } from "@/utils/is-sessions-shortcut";
import { isWorktreesCreateShortcut } from "@/utils/is-worktrees-create-shortcut";
import { isWorktreesShortcut } from "@/utils/is-worktrees-shortcut";
import {
  INITIAL_COMMAND_QUERY_PARAM,
  removeInitialCommandQueryParam,
} from "@/utils/remove-initial-command-query-param";
import {
  FRESH_SESSION_QUERY_PARAM,
  removeFreshSessionQueryParam,
} from "@/utils/fresh-session-query-param";
import { removeRunQueryParam, RUN_QUERY_PARAM } from "@/utils/remove-run-query-param";
import {
  SESSION_ID_QUERY_PARAM,
  syncSessionIdQueryParam,
} from "@/utils/sync-session-id-query-param";
import { LocalEcho } from "@/lib/local-echo";
import { isCoarsePointer } from "@/utils/is-coarse-pointer";
import { detectIsAppleWebKit } from "@/utils/detect-is-apple-webkit";
import { loadStoredDefaultCwd } from "@/utils/stored-default-cwd";
import { loadStoredDefaultShell } from "@/utils/stored-default-shell";
import { WINDOW_ID_QUERY_PARAM, loadWindowId } from "@/utils/window-id";
import { detectDeviceTier } from "@/utils/detect-device-tier";
import { fetchSessions } from "@/utils/fetch-sessions";
import { loadStoredMobileResume } from "@/utils/stored-mobile-resume";
import { resolveResumeSession } from "@/utils/resolve-resume-session";
import { setTabFaviconState } from "@/utils/set-tab-favicon-state";
import { probeServerHealth } from "@/utils/probe-server-health";
import { fetchDaemonConfig } from "@/utils/fetch-daemon-config";
import { updateDaemonConfig } from "@/utils/update-daemon-config";
import { fetchServerHealth } from "@/utils/fetch-server-health";
import { connectCdp } from "@/utils/connect-cdp";
import { openInspectPage } from "@/utils/open-inspect-page";
import { shouldSuppressAltBufferWheel } from "@/utils/should-suppress-alt-buffer-wheel";
import { computePtyViewportOverlay } from "@/utils/compute-pty-viewport-overlay";

import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_INPUT_BYTES,
  type ClientToServerMessage,
  type CompressMode,
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

const ON_SCREEN_KEYBOARD_CONTROL_SELECTOR = [
  "[data-on-screen-keyboard]",
  "[data-on-screen-keyboard-settings]",
  "[data-on-screen-keyboard-toggle]",
  "[data-on-screen-keyboard-actions-toggle]",
].join(", ");

// Server-side output compression: the server compresses each binary output
// frame (brotli if the browser can decode it, else gzip) with a 1-byte header
// (0x00 raw / 0x01 gzip / 0x02 brotli). Feature-detect the decompressor at
// module load; null means no DecompressionStream (raw passthrough, also the
// back-compat path for an old server). Browsers never negotiate
// permessage-deflate, so this is application-level. The TS DOM lib's
// CompressionFormat omits "br" (runtime-supported in Chrome 105+/Safari 16.4+),
// so the format string is cast.
const detectCompressMode = (): "br-ctx" | "gzip" | null => {
  const tryFormat = (format: string): boolean => {
    try {
      new DecompressionStream(format as CompressionFormat);
      return true;
    } catch {
      return false;
    }
  };
  // "br-ctx" advertises the context-takeover (a persistent DecompressionStream
  // per PTY): the same DecompressionStream("br") support as per-frame brotli,
  // but the server compresses each frame against the prior screen (the delta).
  if (tryFormat("br")) return "br-ctx";
  if (tryFormat("gzip")) return "gzip";
  return null;
};
const COMPRESS_MODE = detectCompressMode();

const decompressFrame = async (
  format: string,
  compressed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> => {
  const stream = new DecompressionStream(format as CompressionFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  // Read concurrently with the write+close: writer.close() waits for the
  // readable to drain, so the reader must already be pulling or a large frame
  // backpressures the transform and deadlocks the close.
  const drained = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();
  await writer.write(compressed);
  await writer.close();
  await drained;
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

// Persistent Brotli decompressor for the context-takeover mode ("br-ctx"). One
// per PTY (created on the {compress} frame, released on {session} or teardown).
// The DecompressionStream doesn't end per frame, so a concurrent reader runs for
// the socket's lifetime pushing decoded bytes into a buffer; each decompress()
// feeds a compressed chunk and waits for `rawSize` bytes (the size-delimited
// frame boundary — the decoder emits in arbitrary 16KB chunks, so the raw-size
// bound, not a read() boundary, recovers the frame).
const makeCtxDecoder = () => {
  const stream = new DecompressionStream("br" as CompressionFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let len = 0;
  let waitingFor = 0;
  let resolver: (() => void) | null = null;
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          len += value.length;
        }
        if (resolver !== null && len >= waitingFor) {
          const r = resolver!;
          resolver = null;
          r();
        }
      }
    } catch {
      /* the no-finish close error at socket teardown — ignore */
    }
  })();
  const decompress = async (
    compressed: Uint8Array<ArrayBuffer>,
    rawSize: number,
  ): Promise<Uint8Array> => {
    await writer.write(compressed);
    if (len < rawSize) {
      waitingFor = rawSize;
      await new Promise<void>((r) => {
        resolver = r;
      });
    }
    const out = new Uint8Array(rawSize);
    let offset = 0;
    while (offset < rawSize) {
      const chunk = chunks[0];
      const need = rawSize - offset;
      if (chunk.length <= need) {
        out.set(chunk, offset);
        offset += chunk.length;
        chunks.shift();
        len -= chunk.length;
      } else {
        out.set(chunk.subarray(0, need), offset);
        chunks[0] = chunk.subarray(need);
        offset = rawSize;
        len -= need;
      }
    }
    return out;
  };
  const release = async () => {
    try {
      await writer.close();
    } catch {
      /* the persistent stream has no finish marker — the close errors */
    }
  };
  return { decompress, release };
};

const CWD_QUERY_PARAM = "cwd";
const SHELL_QUERY_PARAM = "shell";

interface BuildWebSocketUrlOptions {
  cwdOverride?: string | null;
  sid?: string | null;
  omitAddressBarSessionId?: boolean;
}

const buildWebSocketUrl = ({
  cwdOverride,
  sid,
  omitAddressBarSessionId = false,
}: BuildWebSocketUrlOptions = {}): string => {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams(window.location.search);
  // The address-bar ?cwd= (or an explicit override like the live cwd on
  // reconnect) wins; a bare launch with neither falls back to the user's
  // saved default cwd so the PWA app icon and a fresh tab open somewhere
  // meaningful instead of always the home directory.
  const cwd = cwdOverride ?? params.get(CWD_QUERY_PARAM) ?? loadStoredDefaultCwd();
  if (cwd) url.searchParams.set(CWD_QUERY_PARAM, cwd);
  // The saved default shell override (Settings → Launch) seeds every fresh
  // spawn with the user's chosen shell; an address-bar ?shell= wins (a
  // programmatic launch can target a specific shell). Empty = the daemon's
  // detected login shell (no param sent).
  const shell = params.get(SHELL_QUERY_PARAM) ?? loadStoredDefaultShell();
  if (shell) url.searchParams.set(SHELL_QUERY_PARAM, shell);
  const runId = params.get(RUN_QUERY_PARAM);
  if (runId) url.searchParams.set(RUN_QUERY_PARAM, runId);
  // Fall back to the address bar's ?sid= (written by syncSessionIdQueryParam)
  // when no explicit id is passed, so a full page refresh reattaches to the
  // same live PTY instead of spawning a fresh shell. An in-place fresh switch
  // explicitly suppresses this fallback while preserving the address bar until
  // the replacement session lands.
  const resolvedSid = sid ?? (omitAddressBarSessionId ? null : params.get(SESSION_ID_QUERY_PARAM));
  if (resolvedSid) url.searchParams.set(SESSION_ID_QUERY_PARAM, resolvedSid);
  // The per-browser-profile handle so the daemon can group this tab with the
  // others of the same profile in the session picker's peer display. Minted
  // once into localStorage (partitioned per profile), so every tab of one
  // profile carries the same id.
  const windowId = loadWindowId();
  if (windowId) url.searchParams.set(WINDOW_ID_QUERY_PARAM, windowId);
  // Forward a transient initial command (a worktree's setup script) so the
  // server writes it to the PTY as if the user typed it — the install/env-copy
  // output is visible and the prompt returns when it finishes.
  const initialCommand = params.get(INITIAL_COMMAND_QUERY_PARAM);
  if (initialCommand) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, initialCommand);
  return url.toString();
};

const buildNewTabUrl = (cwd: string | null, command?: string): string => {
  const url = new URL(window.location.origin);
  // Inherit the live cwd when available; otherwise seed from the saved default
  // so a new tab opened before any session connects still lands in the
  // user's chosen directory rather than the home directory.
  const resolvedCwd = cwd ?? loadStoredDefaultCwd();
  if (resolvedCwd) url.searchParams.set(CWD_QUERY_PARAM, resolvedCwd);
  // Seed the saved default shell so a new tab spawns the user's chosen shell
  // (the address-bar ?shell= from a programmatic launch is inherited via the
  // search params below).
  const savedShell = loadStoredDefaultShell();
  if (savedShell) url.searchParams.set(SHELL_QUERY_PARAM, savedShell);
  if (command) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, command);
  // Prevent mobile's bare-launch resume from replacing this explicit spawn.
  url.searchParams.set(FRESH_SESSION_QUERY_PARAM, "1");
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
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const refocusTerminalRef = useRef<(() => void) | null>(null);
  const pasteToTerminalRef = useRef<((text: string) => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const retryFeedbackTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const resizeScrollRestoreRef = useRef<ResizeScrollRestoreState | null>(null);
  const localEchoRef = useRef<LocalEcho | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const {
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
  } = useTerminalSettings({ terminalRef, fitAddonRef, terminalReady, localEchoRef });
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [isKeepAwakePopoverOpen, setIsKeepAwakePopoverOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [cdpPort, setCdpPort] = useState<number | null>(null);
  const [graceSeconds, setGraceSeconds] = useState<number | null>(null);
  const [workspaceRestore, setWorkspaceRestore] = useState(true);
  // The daemon's detected default shell (from `GET /api/config`), shown as the
  // Settings → Launch shell field's placeholder so the user knows what an
  // empty field falls back to. Lazily fetched when the Settings panel opens
  // (alongside cdpPort/graceSeconds) since it's only needed for the hint.
  const [detectedDefaultShell, setDetectedDefaultShell] = useState<string>("");
  const [cdpStatus, setCdpStatus] = useState<{
    connected: boolean;
    browser?: string;
    port?: number;
    error?: string;
  } | null>(null);
  const [cdpConnecting, setCdpConnecting] = useState(false);
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
  const isAppleWebKit = useMemo(detectIsAppleWebKit, []);
  const deviceTier = useDeviceTier();
  const [isOnScreenKeyboardOpen, setIsOnScreenKeyboardOpen] = useState(false);
  const [onScreenKeyboardHeight, setOnScreenKeyboardHeight] = useState(0);
  const onScreenKeyboardOpenRef = useRef(false);
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const refocusTerminal = useCallback(() => refocusTerminalRef.current?.(), []);
  const closeOnScreenKeyboard = useCallback(() => {
    onScreenKeyboardOpenRef.current = false;
    setIsOnScreenKeyboardOpen(false);
  }, []);
  const dismissOnScreenKeyboard = useCallback(() => {
    closeOnScreenKeyboard();
    setIsActionsMenuOpen(false);
  }, [closeOnScreenKeyboard]);
  const openOnScreenKeyboard = useCallback(() => {
    suppressTerminalSystemKeyboard(terminalRef.current?.textarea);
    dismissSystemKeyboard();
    onScreenKeyboardOpenRef.current = true;
    setIsOnScreenKeyboardOpen(true);
  }, []);
  const toggleOnScreenKeyboard = useCallback(() => {
    if (onScreenKeyboardOpenRef.current) dismissOnScreenKeyboard();
    else openOnScreenKeyboard();
  }, [dismissOnScreenKeyboard, openOnScreenKeyboard]);

  useEffect(() => {
    if (deviceTier === "desktop") dismissOnScreenKeyboard();
  }, [deviceTier, dismissOnScreenKeyboard]);

  // Focus the terminal cursor whenever the on-screen keyboard opens. The
  // guarded helper textarea keeps the system keyboard suppressed, and re-focus
  // after each keystroke keeps xterm's cursor block solid while using the OSK.
  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    refocusTerminalRef.current?.();
  }, [isOnScreenKeyboardOpen]);

  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(ON_SCREEN_KEYBOARD_CONTROL_SELECTOR)) {
        return;
      }
      closeOnScreenKeyboard();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target === terminalRef.current?.textarea) return;
      if (
        event.target instanceof Element &&
        event.target.closest(ON_SCREEN_KEYBOARD_CONTROL_SELECTOR)
      ) {
        return;
      }
      closeOnScreenKeyboard();
    };
    // Some Android IMEs ignore both flags on an already-focused textarea. A large,
    // width-stable viewport shrink is the final signal to evict that stale IME.
    const visualViewport = window.visualViewport;
    let baselineViewportHeight = visualViewport?.height ?? 0;
    let baselineViewportWidth = visualViewport?.width ?? 0;
    const handleViewportResize = () => {
      if (!visualViewport) return;
      const viewportHeight = visualViewport.height;
      const viewportWidth = visualViewport.width;
      const didViewportWidthChange =
        Math.abs(viewportWidth - baselineViewportWidth) >= TERMINAL_VIEWPORT_WIDTH_STABLE_PX;
      if (didViewportWidthChange) {
        baselineViewportHeight = viewportHeight;
        baselineViewportWidth = viewportWidth;
        return;
      }
      const didSystemKeyboardOpen =
        viewportHeight < baselineViewportHeight - TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX;
      if (onScreenKeyboardOpenRef.current && didSystemKeyboardOpen) {
        baselineViewportHeight = viewportHeight;
        suppressTerminalSystemKeyboard(terminalRef.current?.textarea);
        dismissSystemKeyboard();
        refocusTerminalRef.current?.();
        return;
      }
      baselineViewportHeight = Math.max(baselineViewportHeight, viewportHeight);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    visualViewport?.addEventListener("resize", handleViewportResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [closeOnScreenKeyboard, isOnScreenKeyboardOpen]);

  // Hardware back / iOS edge-swipe dismisses the on-screen keyboard instead of
  // navigating: push a history entry on open and pop it on close so a back
  // gesture closes the keyboard.
  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    window.history.pushState({ localtermOsk: true }, "");
    const onPopState = () => dismissOnScreenKeyboard();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.localtermOsk) window.history.back();
    };
  }, [dismissOnScreenKeyboard, isOnScreenKeyboardOpen]);
  // Apple WebKit ignores `interactive-widget=resizes-content` (set in
  // index.html) — its keyboard overlays the layout viewport, where Chromium
  // shrinks it above the keyboard in one browser-driven pass. Only WebKit
  // needs this hand-rolled shrink+translate, rAF-coalesced so the keyboard
  // animation's per-frame visualViewport events fold into one aligned style
  // write; the transform drops at zero offset to avoid a needless layer.
  useEffect(() => {
    if (!isTouchDevice || !isAppleWebKit) return;
    const root = rootRef.current;
    const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!root || !visualViewport) return;
    let pendingFrame: number | null = null;
    const apply = () => {
      pendingFrame = null;
      root.style.height = `${visualViewport.height}px`;
      const offsetTop = visualViewport.offsetTop;
      root.style.transform = offsetTop ? `translateY(${offsetTop}px)` : "";
    };
    const schedule = () => {
      if (pendingFrame !== null) return;
      pendingFrame = window.requestAnimationFrame(apply);
    };
    schedule();
    visualViewport.addEventListener("resize", schedule);
    visualViewport.addEventListener("scroll", schedule);
    return () => {
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
      visualViewport.removeEventListener("resize", schedule);
      visualViewport.removeEventListener("scroll", schedule);
      root.style.height = "";
      root.style.transform = "";
    };
  }, [isTouchDevice, isAppleWebKit]);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultState>({
    resultIndex: -1,
    resultCount: 0,
  });

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
  const hasToolbarIndicator = hasDiff || branchPrDisplayState !== null;
  const shouldShowAmbientToolbar = isTouchDevice
    ? isOnScreenKeyboardOpen || isToolbarVisible
    : isToolbarVisible || hasToolbarIndicator;
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
    // treats it as a switch (reset + scrollback replay). A fresh in-place
    // switch keeps liveSessionId for the same comparison but omits it from every
    // retry until the replacement session frame lands.
    let nextConnectSid: string | null = null;
    let shouldSpawnFreshSession = false;
    let initialMobileResumePending = false;
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

    // Expose viewport serializers to the daemon's CDP automation (capture-pane
    // --png, mouse). The daemon reads these off the tab's window over the
    // existing CDP socket: a pane-text serializer (the render-landed source of
    // truth — a content-equality check against the server-side capture renderer
    // that can't return stale pixels) and a cell-metrics helper (col/row →
    // pixel for Input.dispatchMouseEvent). Mirrors LOCALTERM_TAB_TOKEN_PROPERTY
    // — well-known names so the wire protocol stays authoritative. Torn down
    // on unmount so a tab the user closed never answers a stale query.
    const w = window as unknown as Record<string, unknown>;
    w[LOCALTERM_PANE_TEXT_PROPERTY] = (): string => {
      const buffer = terminal.buffer.active;
      const rows: string[] = [];
      for (let i = buffer.baseY; i < buffer.baseY + terminal.rows; i++) {
        const line = buffer.getLine(i);
        rows.push(line ? line.translateToString(true) : "");
      }
      while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
      return rows.join("\n");
    };
    w[LOCALTERM_MOUSE_CELLS_PROPERTY] = (): {
      left: number;
      top: number;
      cellWidth: number;
      cellHeight: number;
      cols: number;
      rows: number;
    } | null => {
      const screen = container.querySelector(".xterm-screen");
      if (!(screen instanceof HTMLElement)) return null;
      const rect = screen.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        cellWidth: terminal.cols > 0 ? rect.width / terminal.cols : 0,
        cellHeight: terminal.rows > 0 ? rect.height / terminal.rows : 0,
        cols: terminal.cols,
        rows: terminal.rows,
      };
    };

    const helperTextArea = container.querySelector("textarea.xterm-helper-textarea");
    if (helperTextArea instanceof HTMLTextAreaElement) {
      helperTextArea.autocomplete = "off";
      helperTextArea.setAttribute("autocapitalize", "off");
      helperTextArea.setAttribute("autocorrect", "off");
      helperTextArea.spellcheck = false;
      if (isTouchDevice) suppressTerminalSystemKeyboard(helperTextArea);
    }

    let tapStartClientX = 0;
    let tapStartClientY = 0;
    let tapMovedBeyondThreshold = false;
    // Programmatic refocus after an overlay closes (settings/keep-awake menu,
    // search, command palette, diff viewer): route keystrokes back to the
    // terminal. inputMode "none" keeps the system keyboard suppressed on touch
    // while still focusing the textarea so xterm's cursor block stays solid.
    const refocusTerminalQuietly = () => {
      if (isTouchDevice) suppressTerminalSystemKeyboard(terminal.textarea);
      if (terminal.textarea !== document.activeElement) terminal.focus();
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
      if (onScreenKeyboardOpenRef.current) return;
      openOnScreenKeyboard();
    };
    const tapListenerAbort = new AbortController();
    if (isTouchDevice) {
      // inputMode="none" is the primary IME guard; readOnly backs it up for
      // Android keyboards that ignore inputMode when xterm re-focuses an
      // already-active helper textarea. Keeping both on every focus path makes
      // the terminal custom-keyboard-only without affecting the app's inputs.
      const guardTextarea = () => {
        suppressTerminalSystemKeyboard(terminal.textarea);
      };
      const blurAndGuardTextarea = () => {
        suppressTerminalSystemKeyboard(terminal.textarea);
        terminal.textarea?.blur();
      };
      guardTextarea();
      terminal.textarea?.addEventListener("blur", guardTextarea, {
        signal: tapListenerAbort.signal,
      });
      // A native keyboard that was already active can dismiss without blurring
      // xterm's helper (Android back, an IME hide-toggle, iOS swipe-down). A
      // growing visualViewport is the cross-platform hide signal; reset the
      // helper there so a later xterm scroll-refocus starts from the guarded,
      // unfocused state instead of reviving the stale IME session.
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        let prevViewportHeight = visualViewport.height;
        let prevViewportWidth = visualViewport.width;
        const onViewportResize = () => {
          const height = visualViewport.height;
          const width = visualViewport.width;
          const grew = height > prevViewportHeight + TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX;
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
        const naturalCols = Math.max(2, Math.floor(availableWidth / cellWidth));
        const naturalRows = Math.max(1, Math.floor(availableHeight / cellHeight));
        // Stash the natural cols so sendResize reports them (not the clamped
        // grid) and the overlay gates the mask on natural-vs-effective.
        naturalColsRef.current = naturalCols;
        // Reflow the local grid to the PTY's effective cols when a narrower peer
        // constrains it: xterm reflows the whole buffer on resize, so the dead
        // columns beyond the effective width carry no stale wide content (a
        // narrow phone joining a wide desktop otherwise leaves the desktop's
        // pre-join 120-col scrollback sitting in cols 40-120, bleeding through
        // the mask). Rows stay at the local natural height — only the vertical
        // boundary conveys anything, and clamping rows would shrink the
        // terminal instead of masking the side.
        const effectiveCols = ptySizeRef.current?.cols;
        const cols = effectiveCols ? Math.min(naturalCols, effectiveCols) : naturalCols;
        return { cols, rows: naturalRows };
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
    // A grid/cell-size change (window resize, font, padding, fit) moves the
    // `.xterm-screen` rect the pty-viewport mask is positioned off, so re-measure
    // on resize. onResize fires before the DOM settles, so defer to the next
    // frame for an accurate getBoundingClientRect.
    const ptyViewportResizeDisposable = terminal.onResize(() => {
      requestAnimationFrame(() => setPtyViewportVersion((version) => version + 1));
    });

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
      webglAddon.onContextLoss(() => {
        outputBatcher.setInteractiveRenderingEnabled(false);
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
      outputBatcher.setInteractiveRenderingEnabled(true);
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

    terminal.attachCustomWheelEventHandler((event) => {
      if (shouldSuppressAltBufferWheel(event, terminal)) {
        event.preventDefault();
        return false;
      }
      return true;
    });

    terminal.attachCustomKeyEventHandler((event) => {
      const isForegroundControlTab =
        event.key === "Tab" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        hasForegroundProcess;
      if (isForegroundControlTab) {
        event.preventDefault();
        if (event.type === "keydown") {
          sendInput(event.shiftKey ? TERMINAL_BACK_TAB_SEQUENCE : TERMINAL_TAB_SEQUENCE);
        }
        return false;
      }
      if (event.key === "Tab" && (event.metaKey || event.ctrlKey)) return false;
      if (isNewTabShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          openNewShellRef.current?.();
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
      if (isSecretsShortcut(event, isMac)) {
        if (event.type === "keydown") {
          event.preventDefault();
          toggleSecretsRef.current?.();
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
      const terminalEditingOutput = buildTerminalEditingOutput({
        key: event.key,
        alternate: event.altKey,
        command: isMac && event.metaKey,
        control: event.ctrlKey,
      });
      if (terminalEditingOutput !== null) {
        event.preventDefault();
        if (event.type === "keydown") {
          const localEcho = localEchoRef.current;
          if (localEcho) {
            localEcho.handleInput(terminalEditingOutput);
          } else {
            sendInput(terminalEditingOutput);
          }
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
          sendInput(buildKittyKeySequence(ENTER_KEY_CODE, modifierBits));
          return false;
        }
        if (modifierBits === KEYBOARD_MODIFIER_SHIFT_BIT) {
          event.preventDefault();
          sendInput("\n");
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
      // Report the viewer's NATURAL cols, not the (possibly clamped) grid
      // cols: the server sizes the PTY to the min across clients, so a wider
      // viewer reporting its clamped cols would deadlock the PTY at the narrow
      // size when the constraining peer leaves. Rows are unclamped, so the
      // passed rows are already the natural height. The canvas pixels stay as
      // measured — the server only uses them for a sole (unclamped) viewer,
      // where the canvas is already the natural size.
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
      isSafeState: () => !hasForegroundProcess && terminal.buffer.active.type === "normal",
    });
    localEcho.setEnabled(activeLocalEchoRef.current);
    localEchoRef.current = localEcho;

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
      if (suppressOutput) return;
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
    if (!onScreenKeyboardOpenRef.current) requestAnimationFrame(refocusTerminalQuietly);

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
      const shouldSpawnFresh = shouldSpawnFreshSession;
      nextConnectSid = null;
      const nextSocket = new WebSocket(
        buildWebSocketUrl({
          cwdOverride: liveCwdRef.current,
          sid: shouldSpawnFresh ? null : (connectSid ?? liveSessionId),
          omitAddressBarSessionId: shouldSpawnFresh,
        }),
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

      // Decompression is async (DecompressionStream), so serialize per socket:
      // frames must reach xterm in PTY order, and the replay-end flush must wait
      // for the replay frames' decompresses. A promise chain (FIFO). ptyGeneration
      // invalidates pending decompresses when a {session} frame switches PTYs —
      // a prior PTY's frame still in the queue would otherwise land in the new
      // PTY (after terminal.reset()).
      let decompressQueue: Promise<void> = Promise.resolve();
      let ptyGeneration = 0;
      // The server's chosen compress mode (from the {compress} frame on promote),
      // NOT the client's advertisement. null = raw (no header) — either a no-
      // support browser or an old server that never sent {compress}.
      let negotiatedCompressMode: CompressMode = null;
      // The persistent Brotli decompressor for "br-ctx" (one per PTY, reset on
      // {session} and {compress}); its LZ77 window holds the prior screen so each
      // frame decompresses as a delta.
      let ctxDecoder: ReturnType<typeof makeCtxDecoder> | null = null;
      const enqueueDecompress = (task: () => Promise<void> | void): void => {
        decompressQueue = decompressQueue.then(task).catch((error: unknown) => {
          console.warn("[localterm] output decompress error", error);
        });
      };

      nextSocket.addEventListener("message", (event) => {
        if (disposed || socket !== nextSocket) return;
        // Output frames are raw UTF-8 bytes (binary WebSocket frames) — bypass
        // JSON entirely and hand the bytes straight to the batcher. The server
        // emits every other message type as JSON text, so anything that isn't
        // an ArrayBuffer goes through the schema parser.
        if (isBinaryMessageData(event.data)) {
          const data = new Uint8Array(event.data);
          if (negotiatedCompressMode === null) {
            // Raw passthrough (no compression — a no-DecompressionStream browser,
            // or an old server that never sent a {compress} frame): no header byte.
            if (inReplay) {
              replayChunks.push(data);
              return;
            }
            outputBatcher.pushBytes(localEcho.hasPending() ? localEcho.reconcile(data) : data);
            noteOutputActivity();
            return;
          }
          // Compressed frame. 0x00/0x01/0x02 use a 1-byte header (per-frame
          // independent — a fresh DecompressionStream per frame reads to done).
          // 0x03 is the context-takeover: a 5-byte header (0x03 + 4-byte LE raw
          // size) then the compressed payload, fed to the per-socket persistent
          // DecompressionStream and size-delimited by the raw size (the stream
          // doesn't end per frame). Decompress is async, so enqueue per socket —
          // frames reach xterm in PTY order and the replay-end flush waits for
          // the replay frames' decompresses. Capture the PTY generation so a
          // {session} switch drops a prior PTY's frame still mid-decompress.
          const generationAtEnqueue = ptyGeneration;
          enqueueDecompress(async () => {
            const header = data[0];
            let bytes: Uint8Array;
            if (header === WS_OUTPUT_BROTLI_CTX) {
              const rawSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
                1,
                true,
              );
              const compressed = data.subarray(WS_OUTPUT_CTX_HEADER_BYTES);
              bytes = await ctxDecoder!.decompress(compressed, rawSize);
            } else {
              const payload = data.subarray(1);
              if (header === WS_OUTPUT_BROTLI) bytes = await decompressFrame("br", payload);
              else if (header === WS_OUTPUT_GZIP) bytes = await decompressFrame("gzip", payload);
              else if (header === WS_OUTPUT_RAW) bytes = payload;
              else return; // unknown header — a version mismatch; drop the frame
            }
            if (ptyGeneration !== generationAtEnqueue) return;
            if (inReplay) {
              // Buffer the DECOMPRESSED bytes; replay-end writes them as one
              // suppressed block (dropping xterm's stale query responses).
              replayChunks.push(bytes);
              return;
            }
            outputBatcher.pushBytes(localEcho.hasPending() ? localEcho.reconcile(bytes) : bytes);
            noteOutputActivity();
          });
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
          ptyGeneration += 1;
          const priorSessionId = liveSessionId;
          const didSpawnFreshSession = shouldSpawnFreshSession;
          shouldSpawnFreshSession = false;
          // A new session frame is a fresh attach: reset the negotiated compress
          // mode (the server sends a new {compress} frame on promote) and release
          // the prior PTY's persistent Brotli decompressor (its LZ77 context is
          // stale for the new PTY).
          negotiatedCompressMode = null;
          if (ctxDecoder !== null) {
            void ctxDecoder.release();
            ctxDecoder = null;
          }
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
          if (message.id) {
            if (priorSessionId !== null && message.id !== priorSessionId) {
              previousSessionIdRef.current = priorSessionId;
            }
            liveSessionId = message.id;
            liveSessionIdRef.current = message.id;
            syncSessionIdQueryParam(message.id);
          }
          removeFreshSessionQueryParam();
          // A switch (or a missed reattach that spawned a fresh shell): the
          // new PTY is a different one than the tab was just viewing, so reset
          // the terminal and ask the server to replay its scrollback before
          // live fan-out begins. The replay lands as one binary frame right
          // after this, so the screen shows the PTY's recent output instead
          // of the prior PTY's stale content.
          const isSwitch =
            didSpawnFreshSession || (priorSessionId !== null && message.id !== priorSessionId);
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
          // Re-sync the foreground flag from the PTY's current state, then re-seed
          // the favicon to match. The server's foreground watcher only emits on
          // change, so without this a reattaching client (page refresh, silent
          // reattach) or a fresh PTY after a daemon restart keeps hasForegroundProcess
          // at its stale prior value — stuck blue after a restart (stale true) or
          // grey-after-green on refresh (stale false, the deduped watcher never
          // re-emits). On a switch to a different PTY, drop the prior PTY's pending
          // favicon timers so they don't fire against the new one. A same-PTY
          // reattach keeps its timers — clearing the ready timer would interrupt
          // an in-progress green→blue quiet transition (leaving the icon stuck
          // green, never blue). Never clobber an active "running" (green): output
          // drives that, and checkReadyAfterOutput picks up the re-synced
          // hasForegroundProcess when output goes quiet.
          hasForegroundProcess = message.foreground !== null;
          hadForegroundThisCycle = hasForegroundProcess;
          if (isSwitch) {
            if (faviconRunningTimer !== null) {
              window.clearTimeout(faviconRunningTimer);
              faviconRunningTimer = null;
            }
            if (faviconReadyTimer !== null) {
              window.clearTimeout(faviconReadyTimer);
              faviconReadyTimer = null;
            }
          }
          if (isSwitch || faviconState !== "running") {
            faviconBadge = false;
            faviconState = hasForegroundProcess ? "alive-quiet" : "ready";
            setTabFaviconState(faviconState);
          }
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
            inReplay = true;
            suppressOutput = true;
            replayChunks = [];
          }
          send({ type: "ready", replay: wantsReplay, compress: COMPRESS_MODE });
        } else if (message.type === "compress") {
          // The server's chosen compress mode, sent on promote BEFORE the
          // scrollback replay so the client knows how to parse the compressed
          // replay frames. Drives the binary handler (NOT COMPRESS_MODE — that's
          // the client's advertisement). An old server that doesn't know "br-ctx"
          // never sends this frame, so negotiatedCompressMode stays null and the
          // binary handler reads frames as raw (no header) — graceful degrade.
          negotiatedCompressMode = message.mode;
          if (ctxDecoder !== null) {
            void ctxDecoder.release();
            ctxDecoder = null;
          }
          if (message.mode === "br-ctx") ctxDecoder = makeCtxDecoder();
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
          const flushReplay = () => {
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
                terminal.write(
                  chunks[index],
                  index === chunks.length - 1 ? finishReplay : undefined,
                );
              }
            }
          };
          // Compressed replay frames are decompressed async (the per-socket
          // queue); the flush must wait for them or it'd write an incomplete
          // block. Raw mode (no compression) flushes inline — the frames
          // arrived synchronously and the flush must land before the next
          // (inline) live frame reads `inReplay`.
          if (negotiatedCompressMode === null) flushReplay();
          else enqueueDecompress(flushReplay);
        } else if (message.type === "automations") {
          setAutomations(message.automations);
        } else if (message.type === "themes") {
          applyThemesState({
            activeThemeId: message.activeThemeId,
            customThemes: message.customThemes,
          });
        } else if (message.type === "fonts") {
          applyFontsState({
            activeFontId: message.activeFontId,
            customFontFamily: message.customFontFamily,
            nerdFontEnabled: message.nerdFontEnabled,
            ligaturesEnabled: message.ligaturesEnabled,
            initialized: message.initialized,
          });
        } else if (message.type === "caffeinate") {
          setCaffeinateSupported(message.supported);
          setCaffeinateActive(message.active);
          setCaffeinatePeerActive(message.peerActive);
          setCaffeinateMode(message.mode);
          setCaffeinateDefaultCommands(message.defaultCommands);
          setCaffeinateCommands(message.commands);
          setCaffeinateActivityGate(message.activityGate);
          setCaffeinatePeerKeepAwake(message.peerKeepAwake);
          setCaffeinateBatteryThreshold(message.batteryThreshold);
          setCaffeinateActiveTrigger(message.activeTrigger);
        } else if (message.type === "cwd") {
          setLiveCwd(message.cwd);
          setGitDiffSummary(null);
        } else if (message.type === "git-diff-summary") {
          setGitDiffSummary(message.summary);
          setGitDirtyVersion((version) => (version ?? 0) + 1);
        } else if (message.type === "git-branch-pr") {
          setPushedPr(message.pr);
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
            // Show via the SW so the click fires the SW's notificationclick,
            // which can focus a background tab through WindowClient.focus() —
            // the API browsers honor, unlike a main-thread window.focus(). The
            // per-session tag coalesces the copies the daemon fanned out to the
            // user's other tabs into one OS notification. Falls back to a
            // page-owned Notification when no SW is active (dev / not controlling).
            const sid = message.sessionId;
            const isViewer = sid === liveSessionIdRef.current;
            // The foreground viewer tab can already see the result on screen, so
            // it skips the OS notification — see shouldSuppressSessionNotification
            // for the cross-tab + foreground suppression rules.
            if (
              shouldSuppressSessionNotification({
                isViewer,
                hasViewers: message.hasViewers,
                documentVisible: document.visibilityState === "visible",
                documentFocused: document.hasFocus(),
              })
            ) {
              return;
            }
            const sw = navigator.serviceWorker;
            if (sw?.controller) {
              void sw.ready.then((reg) =>
                reg.showNotification(NOTIFICATION_TITLE, {
                  body: message.body,
                  tag: `${NOTIFICATION_TAG_PREFIX}${sid}`,
                  data: { sid, hasViewers: message.hasViewers },
                }),
              );
            } else {
              const notification = new Notification(message.body);
              notification.onclick = () => {
                window.focus();
                if (!isViewer && sid) {
                  // Orphaned (suppression only shows this when !hasViewers):
                  // open a fresh tab on the session instead of hijacking this one.
                  const url = new URL(window.location.href);
                  url.searchParams.set(SESSION_ID_QUERY_PARAM, sid);
                  window.open(url.toString(), "_blank");
                }
                notification.close();
              };
            }
          }
        } else if (message.type === "exit") {
          resetFavicon();
          markShellDead(message.code);
        } else if (message.type === "cdp-controlled") {
          cdpControlled = message.controlled;
        } else if (message.type === "peer-attached") {
          qrPeerAttachedRef.current?.();
        } else if (message.type === "pty-size") {
          ptySizeRef.current = { cols: message.cols, rows: message.rows };
          setPtySize({ cols: message.cols, rows: message.rows });
          // Refit immediately (not the debounced scheduleFit) so the grid
          // reflows to the new effective size in the same tick the mask
          // recomputes — a debounced refit would leave the old grid sitting
          // under the new mask position for a frame, bleeding the prior
          // effective width through the wash. pty-size frames are infrequent
          // (peer attach/detach/resize), so the synchronous reflow cost is fine.
          fitToContainer();
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
      initialMobileResumePending = false;
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
      shouldSpawnFreshSession = false;
      triggerHapticFeedback(HAPTIC_TAP_MS);
      manualReconnectRef.current?.();
    };

    spawnFreshSessionRef.current = () => {
      if (disposed) return;
      nextConnectSid = null;
      shouldSpawnFreshSession = true;
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
      initialMobileResumePending = true;
      void (async () => {
        const sessions = await fetchSessions();
        if (disposed || !initialMobileResumePending) return;
        initialMobileResumePending = false;
        const resumeSid = sessions === null ? null : resolveResumeSession(sessions);
        if (resumeSid) nextConnectSid = resumeSid;
        connect();
      })();
    } else {
      connect();
    }
    setTerminalReady(true);

    return () => {
      disposed = true;
      setTerminalReady(false);
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
      ptyViewportResizeDisposable.dispose();
      kittyPushDisposable.dispose();
      kittyPopDisposable.dispose();
      kittySetDisposable.dispose();
      scrollbackPurgeDisposable.dispose();
      selectiveScrollbackPurgeDisposable.dispose();
      terminalDataDisposable.dispose();
      terminalUserInputDisposable?.dispose();
      const w = window as unknown as Record<string, unknown>;
      delete w[LOCALTERM_PANE_TEXT_PROPERTY];
      delete w[LOCALTERM_MOUSE_CELLS_PROPERTY];
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

  const refreshCdpStatus = useCallback(() => {
    void fetchServerHealth().then((health) => {
      if (health) setCdpStatus(health.cdp);
    });
  }, []);

  // The CDP port lives on the daemon, so the settings field is hydrated when
  // the modal opens (not held in localStorage like the terminal-appearance
  // prefs). A port change PUTs to the daemon, which reconnects in the
  // background; health is re-fetched after a short delay so the "Connected"
  // status reflects the new endpoint.
  // Persist the configured port. No connect and no status refresh here — a
  // port change only updates the value the daemon's next connect reads. The
  // explicit Connect button applies it; the live socket is left untouched.
  const handleCdpPortChange = useCallback((next: number | null) => {
    setCdpPort(next);
    void updateDaemonConfig({ cdpPort: next }).then((confirmed) => {
      if (confirmed) setCdpPort(confirmed.cdpPort);
    });
  }, []);

  // The grace window lives on the daemon; PUT the new value and adopt the
  // clamped confirmation (the daemon re-arms already-dormant shells).
  const handleGraceSecondsChange = useCallback((next: number | null) => {
    setGraceSeconds(next);
    void updateDaemonConfig({ graceSeconds: next }).then((confirmed) => {
      if (confirmed) setGraceSeconds(confirmed.graceSeconds);
    });
  }, []);

  // The workspace-restore toggle lives on the daemon; PUT the new value and
  // adopt the confirmation. Takes effect on the next daemon start (restore
  // runs once at startup, not live-reactively).
  const handleWorkspaceRestoreChange = useCallback((next: boolean) => {
    setWorkspaceRestore(next);
    void updateDaemonConfig({ workspaceRestore: next }).then((confirmed) => {
      if (confirmed) setWorkspaceRestore(confirmed.workspaceRestore);
    });
  }, []);

  // Explicit "Connect now": await the daemon's connect and fold the result
  // (including any error) into cdpStatus, so the field shows why a connection
  // failed rather than silently staying "Not connected".
  const handleCdpConnect = useCallback(() => {
    setCdpConnecting(true);
    void connectCdp().then((result) => {
      setCdpConnecting(false);
      if (result) {
        setCdpStatus({
          connected: result.connected,
          browser: result.browser,
          port: result.port,
          error: result.error,
        });
      } else {
        refreshCdpStatus();
      }
    });
  }, [refreshCdpStatus]);

  const handleOpenInspect = useCallback(() => {
    void openInspectPage();
  }, []);

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        void fetchDaemonConfig().then((config) => {
          if (config) {
            setCdpPort(config.cdpPort);
            setGraceSeconds(config.graceSeconds);
            setWorkspaceRestore(config.workspaceRestore);
            setDetectedDefaultShell(config.defaultShell);
          }
        });
        refreshCdpStatus();
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
    [refreshCdpStatus],
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

  const toastManager = useToast();
  const pasteImageFromBlobRef = useRef<((blob: Blob, filename: string) => Promise<void>) | null>(
    null,
  );

  const showPastedImageNotice = useCallback(
    (notice: { kind: "uploading" | "done" | "error"; message: string }) => {
      const toastVariant =
        notice.kind === "done" ? "success" : notice.kind === "error" ? "destructive" : "loading";
      toastManager.add({
        id: PASTED_IMAGE_TOAST_ID,
        title: notice.message,
        type: toastVariant,
        timeout: notice.kind === "uploading" ? 0 : PASTED_IMAGE_FEEDBACK_MS,
      });
    },
    [toastManager],
  );

  const pasteImageFromBlob = useCallback(
    async (blob: Blob, filename: string) => {
      const sessionId = liveSessionIdRef.current;
      if (!blob.type.startsWith("image/")) {
        showPastedImageNotice({ kind: "error", message: "Not an image" });
        return;
      }
      if (blob.size > MAX_IMAGE_UPLOAD_BYTES) {
        showPastedImageNotice({ kind: "error", message: "Image too large" });
        return;
      }
      if (!sessionId) {
        showPastedImageNotice({ kind: "error", message: "No session yet" });
        return;
      }
      showPastedImageNotice({ kind: "uploading", message: "Pasting image…" });
      try {
        const absolutePath = await uploadPastedImage(sessionId, blob, filename);
        pasteToTerminalRef.current?.(shellQuoteArg(absolutePath));
        const basename = absolutePath.split(/[/\\]/).pop() ?? absolutePath;
        showPastedImageNotice({ kind: "done", message: `Pasted ${basename}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        showPastedImageNotice({ kind: "error", message });
      }
    },
    [showPastedImageNotice],
  );

  useEffect(() => {
    pasteImageFromBlobRef.current = pasteImageFromBlob;
  }, [pasteImageFromBlob]);

  // The mobile entry point: open the system photo/file picker. A hidden
  // appended <input type=file> is the cross-platform path (iOS Safari blocks
  // clipboard image reads and mobile paste into xterm's off-screen textarea is
  // unreliable), so the button/keyboard key both route here. Desktop clipboard
  // paste + drag-drop are handled by the listeners below.
  const pickAndPasteImage = useCallback(() => {
    setIsActionsMenuOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (file) void pasteImageFromBlobRef.current?.(file, file.name);
    };
    input.click();
  }, []);

  // Clipboard paste (Ctrl/Cmd+V) and drag-drop onto the terminal surface. Both
  // fire on the container, which is an ancestor of xterm's helper textarea, so
  // a paste bubbles here; the capture-phase listener intercepts an image paste
  // before xterm reads the clipboard's empty text representation. Text pastes
  // fall through (no image item) so xterm's normal text paste is untouched.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const imageFromDataTransfer = (
      dataTransfer: DataTransfer | null,
    ): { blob: Blob; name: string } | null => {
      const items = dataTransfer?.items;
      if (!items) return null;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) return { blob: file, name: file.name || "image" };
        }
      }
      return null;
    };
    const handlePaste = (event: ClipboardEvent) => {
      const image = imageFromDataTransfer(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImageFromBlobRef.current?.(image.blob, image.name);
    };
    // Suppress the browser default (navigate to the dropped file) for ANY file
    // drop so an accidental drop never leaves the terminal; only images upload.
    const handleDrop = (event: DragEvent) => {
      const image = imageFromDataTransfer(event.dataTransfer);
      const hasFile = event.dataTransfer?.types?.includes("Files") ?? false;
      if (!image && !hasFile) return;
      event.preventDefault();
      event.stopPropagation();
      if (image) void pasteImageFromBlobRef.current?.(image.blob, image.name);
    };
    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    };
    container.addEventListener("paste", handlePaste, true);
    container.addEventListener("drop", handleDrop, true);
    container.addEventListener("dragover", handleDragOver);
    return () => {
      container.removeEventListener("paste", handlePaste, true);
      container.removeEventListener("drop", handleDrop, true);
      container.removeEventListener("dragover", handleDragOver);
    };
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

  const newShellUrl = buildNewTabUrl(liveCwd);
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
              className={cn(
                "mt-1 flex max-w-[calc(100dvw-1.5rem)] items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 text-muted-foreground shadow-xs backdrop-blur-md",
                "transition-[opacity,transform] duration-200 ease-snappy",
                isTouchDevice &&
                  "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
                  <AlertDialogTitle>Shell ended</AlertDialogTitle>
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
