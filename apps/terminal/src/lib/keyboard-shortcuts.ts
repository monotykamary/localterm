export interface KeyboardShortcut {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type KeyboardShortcutBinding = KeyboardShortcut | null;

export interface KeyboardShortcutMap {
  automations: KeyboardShortcutBinding;
  commandPalette: KeyboardShortcutBinding;
  createWorktree: KeyboardShortcutBinding;
  devPorts: KeyboardShortcutBinding;
  find: KeyboardShortcutBinding;
  gitDiff: KeyboardShortcutBinding;
  newShell: KeyboardShortcutBinding;
  secrets: KeyboardShortcutBinding;
  sessions: KeyboardShortcutBinding;
  worktrees: KeyboardShortcutBinding;
}

export type KeyboardShortcutAction = keyof KeyboardShortcutMap;

export interface KeyboardShortcutDefinition {
  action: KeyboardShortcutAction;
  label: string;
}

export const KEYBOARD_SHORTCUT_DEFINITIONS: KeyboardShortcutDefinition[] = [
  { action: "commandPalette", label: "Command palette" },
  { action: "find", label: "Find in terminal" },
  { action: "gitDiff", label: "View git diff" },
  { action: "automations", label: "Automations" },
  { action: "worktrees", label: "Git worktrees" },
  { action: "createWorktree", label: "Create git worktree" },
  { action: "sessions", label: "Sessions" },
  { action: "devPorts", label: "Dev ports" },
  { action: "secrets", label: "Secrets" },
  { action: "newShell", label: "Open new shell" },
];

export const MAC_KEYBOARD_SHORTCUT_DEFAULTS: KeyboardShortcutMap = {
  automations: { key: "j", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  commandPalette: { key: "k", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  createWorktree: { key: "b", altKey: false, ctrlKey: false, metaKey: true, shiftKey: true },
  devPorts: { key: "d", altKey: false, ctrlKey: false, metaKey: true, shiftKey: true },
  find: { key: "f", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  gitDiff: { key: "g", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  newShell: { key: "t", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  secrets: { key: "s", altKey: false, ctrlKey: false, metaKey: true, shiftKey: true },
  sessions: { key: "i", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  worktrees: { key: "b", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
};

export const NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS: KeyboardShortcutMap = {
  automations: { key: "j", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  commandPalette: { key: "k", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  createWorktree: { key: "b", altKey: true, ctrlKey: false, metaKey: false, shiftKey: true },
  devPorts: { key: "d", altKey: false, ctrlKey: true, metaKey: false, shiftKey: true },
  find: { key: "f", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  gitDiff: { key: "g", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  newShell: { key: "t", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  secrets: { key: "s", altKey: false, ctrlKey: true, metaKey: false, shiftKey: true },
  sessions: { key: "i", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  worktrees: { key: "b", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
};
