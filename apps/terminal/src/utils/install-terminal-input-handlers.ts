import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  KITTY_KEYBOARD_DISAMBIGUATE_FLAG,
  TERMINAL_BACK_TAB_SEQUENCE,
  TERMINAL_TAB_SEQUENCE,
} from "@/lib/constants";
import type { LocalEcho } from "@/lib/local-echo";
import { buildTerminalEditingOutput } from "@/utils/build-terminal-editing-output";
import { isAutomationsShortcut } from "@/utils/is-automations-shortcut";
import { isCommandPaletteShortcut } from "@/utils/is-command-palette-shortcut";
import { isDiffViewerShortcut } from "@/utils/is-diff-viewer-shortcut";
import { isFindShortcut } from "@/utils/is-find-shortcut";
import { isNewTabShortcut } from "@/utils/is-new-tab-shortcut";
import { isPortsShortcut } from "@/utils/is-ports-shortcut";
import { isSecretsShortcut } from "@/utils/is-secrets-shortcut";
import { isSessionsShortcut } from "@/utils/is-sessions-shortcut";
import { isWorktreesCreateShortcut } from "@/utils/is-worktrees-create-shortcut";
import { isWorktreesShortcut } from "@/utils/is-worktrees-shortcut";
import { shouldSuppressAltBufferWheel } from "@/utils/should-suppress-alt-buffer-wheel";
import { syncTerminalMouseWheelSensitivity } from "@/utils/sync-terminal-mouse-wheel-sensitivity";

interface InstallTerminalInputHandlersOptions {
  terminal: XtermTerminal;
  isMac: boolean;
  sendInput: (data: string) => void;
  getHasForegroundProcess: () => boolean;
  getKittyFlags: () => number;
  getLocalEcho: () => LocalEcho | null;
  onOpenNewShell: () => void;
  onToggleCommandPalette: () => void;
  onToggleAutomations: () => void;
  onOpenDiffViewer: () => void;
  onCreateWorktree: () => void;
  onToggleWorktrees: () => void;
  onToggleSessions: () => void;
  onTogglePorts: () => void;
  onToggleSecrets: () => void;
  onOpenSearch: () => void;
}

export const installTerminalInputHandlers = ({
  terminal,
  isMac,
  sendInput,
  getHasForegroundProcess,
  getKittyFlags,
  getLocalEcho,
  onOpenNewShell,
  onToggleCommandPalette,
  onToggleAutomations,
  onOpenDiffViewer,
  onCreateWorktree,
  onToggleWorktrees,
  onToggleSessions,
  onTogglePorts,
  onToggleSecrets,
  onOpenSearch,
}: InstallTerminalInputHandlersOptions): void => {
  terminal.attachCustomWheelEventHandler((event) => {
    syncTerminalMouseWheelSensitivity(event, terminal);
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
      getHasForegroundProcess();
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
        onOpenNewShell();
      }
      return false;
    }
    if (isCommandPaletteShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onToggleCommandPalette();
      }
      return false;
    }
    if (isAutomationsShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onToggleAutomations();
      }
      return false;
    }
    if (isDiffViewerShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onOpenDiffViewer();
      }
      return false;
    }
    if (isWorktreesCreateShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onCreateWorktree();
      }
      return false;
    }
    if (isWorktreesShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onToggleWorktrees();
      }
      return false;
    }
    if (isSessionsShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onToggleSessions();
      }
      return false;
    }
    if (isPortsShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onTogglePorts();
      }
      return false;
    }
    if (isSecretsShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onToggleSecrets();
      }
      return false;
    }
    if (isFindShortcut(event, isMac)) {
      if (event.type === "keydown") {
        event.preventDefault();
        onOpenSearch();
      }
      return false;
    }
    const terminalEditingOutput =
      getKittyFlags() === 0
        ? buildTerminalEditingOutput({
            key: event.key,
            alternate: event.altKey,
            command: isMac && event.metaKey,
            control: event.ctrlKey,
          })
        : null;
    if (terminalEditingOutput !== null) {
      event.preventDefault();
      if (event.type === "keydown") {
        const localEcho = getLocalEcho();
        if (localEcho) {
          localEcho.handleInput(terminalEditingOutput);
        } else {
          sendInput(terminalEditingOutput);
        }
      }
      return false;
    }
    // xterm.js's native Kitty handler owns enhanced keyboard reporting,
    // including Escape press/release and modified Enter. Without Kitty, its
    // legacy handler sends bare \r for Shift+Enter, so preserve LocalTerm's LF
    // fallback for Ink-based TUIs while delegating every other key to xterm.
    if (event.type === "keydown" && event.key === "Enter") {
      const isPlainShiftEnter = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const isKittyDisambiguateActive = (getKittyFlags() & KITTY_KEYBOARD_DISAMBIGUATE_FLAG) !== 0;
      if (isPlainShiftEnter && !isKittyDisambiguateActive) {
        event.preventDefault();
        sendInput("\n");
        return false;
      }
    }
    return true;
  });
};
