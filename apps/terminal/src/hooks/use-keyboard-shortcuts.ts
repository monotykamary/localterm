import { useCallback, useEffect, useState } from "react";
import {
  MAC_KEYBOARD_SHORTCUT_DEFAULTS,
  NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS,
  type KeyboardShortcut,
  type KeyboardShortcutAction,
  type KeyboardShortcutBinding,
  type KeyboardShortcutMap,
} from "@/lib/keyboard-shortcuts";
import { KEYBOARD_SHORTCUTS_STORAGE_KEY } from "@/lib/constants";

interface UseKeyboardShortcutsResult {
  keyboardShortcuts: KeyboardShortcutMap;
  setKeyboardShortcut: (action: KeyboardShortcutAction, shortcut: KeyboardShortcutBinding) => void;
  resetKeyboardShortcuts: () => void;
}

const isKeyboardShortcut = (value: unknown): value is KeyboardShortcut => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "key" in value &&
    typeof value.key === "string" &&
    "altKey" in value &&
    typeof value.altKey === "boolean" &&
    "ctrlKey" in value &&
    typeof value.ctrlKey === "boolean" &&
    "metaKey" in value &&
    typeof value.metaKey === "boolean" &&
    "shiftKey" in value &&
    typeof value.shiftKey === "boolean"
  );
};

const defaultsForPlatform = (isMac: boolean): KeyboardShortcutMap =>
  isMac ? MAC_KEYBOARD_SHORTCUT_DEFAULTS : NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS;

const keyboardShortcutFromStored = (
  stored: object,
  action: KeyboardShortcutAction,
  fallback: KeyboardShortcutBinding,
): KeyboardShortcutBinding => {
  if (!(action in stored)) return fallback;
  const shortcut = stored[action];
  return shortcut === null || isKeyboardShortcut(shortcut) ? shortcut : fallback;
};

const loadKeyboardShortcuts = (isMac: boolean): KeyboardShortcutMap => {
  const defaults = defaultsForPlatform(isMac);
  try {
    const raw = localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
    if (!raw) return defaults;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return defaults;
    return {
      automations: keyboardShortcutFromStored(stored, "automations", defaults.automations),
      commandPalette: keyboardShortcutFromStored(
        stored,
        "commandPalette",
        defaults.commandPalette,
      ),
      createWorktree: keyboardShortcutFromStored(
        stored,
        "createWorktree",
        defaults.createWorktree,
      ),
      devPorts: keyboardShortcutFromStored(stored, "devPorts", defaults.devPorts),
      find: keyboardShortcutFromStored(stored, "find", defaults.find),
      gitDiff: keyboardShortcutFromStored(stored, "gitDiff", defaults.gitDiff),
      newShell: keyboardShortcutFromStored(stored, "newShell", defaults.newShell),
      secrets: keyboardShortcutFromStored(stored, "secrets", defaults.secrets),
      sessions: keyboardShortcutFromStored(stored, "sessions", defaults.sessions),
      worktrees: keyboardShortcutFromStored(stored, "worktrees", defaults.worktrees),
    };
  } catch {
    return defaults;
  }
};

const storeKeyboardShortcuts = (keyboardShortcuts: KeyboardShortcutMap): void => {
  try {
    localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify(keyboardShortcuts));
  } catch {}
};

export const useKeyboardShortcuts = (isMac: boolean): UseKeyboardShortcutsResult => {
  const [keyboardShortcuts, setKeyboardShortcuts] = useState(() => loadKeyboardShortcuts(isMac));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== KEYBOARD_SHORTCUTS_STORAGE_KEY) return;
      setKeyboardShortcuts(loadKeyboardShortcuts(isMac));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isMac]);

  const setKeyboardShortcut = useCallback(
    (action: KeyboardShortcutAction, shortcut: KeyboardShortcutBinding) => {
      setKeyboardShortcuts((previous) => {
        const next = { ...previous, [action]: shortcut };
        storeKeyboardShortcuts(next);
        return next;
      });
    },
    [],
  );

  const resetKeyboardShortcuts = useCallback(() => {
    const defaults = defaultsForPlatform(isMac);
    setKeyboardShortcuts(defaults);
    storeKeyboardShortcuts(defaults);
  }, [isMac]);

  return { keyboardShortcuts, setKeyboardShortcut, resetKeyboardShortcuts };
};
