// ⌘/Ctrl+Shift+S opens the secrets modal. The plain ⌘S mnemonic is a hard
// no-go (browser save — see is-sessions-shortcut, which rejected it for that
// reason), so Shift is required: it keeps the S-for-Secrets mnemonic while
// sidestepping save entirely, since a shifted save press isn't muscle memory
// and ⌘Shift+S isn't a Chrome/Edge/Safari/Firefox/Arc/Dia default. No plain
// letter is free — F/G/J/B/I/K are localterm (find / git diff / automations /
// worktrees / sessions / command palette) and the rest collide with browser
// defaults — so a Shift+letter is the only option, the same pattern ports
// (⌘Shift+D) and create-worktree (⌘Shift+B) already use.
export const isSecretsShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "s" && event.key !== "S") return false;
  return isMac
    ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
};
