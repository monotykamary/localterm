// ⌘/Ctrl+I opens the sessions modal. Chosen to avoid every browser binding:
// ⌘S (save) is the obvious mnemonic but a hard no-go; the other mnemonic-adjacent
// letters (F, G, J, B, K) are already taken by find / git diff / automations /
// worktrees / command palette, and the rest of the alphabet collides with
// browser shortcuts (W, T, N, P, S, R, L, D, H, A, C, X, V, Z, Y, M, Q, O, U,
// E). `I` has no binding in Chrome/Edge/Arc/Dia — the only matches are Safari's
// "Email This Page" and Firefox's "Page Info", both minor and intercepted by
// xterm's key handler (the same path ⌘J/⌘K already ride). Shift excluded so a
// future ⌘Shift+I stays free.
export const isSessionsShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "i" && event.key !== "I") return false;
  return isMac
    ? event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey;
};
