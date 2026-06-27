import type { SessionListItem } from "@monotykamary/localterm-server/protocol";

// Pick the row to highlight when the session switcher opens: the shell this
// tab last switched away from (alt-tab style), falling back to the first row
// that isn't the current session so opening the picker and pressing Enter
// always quick-switches. Returns 0 when only the current session is listed.
export const resolveInitialSessionIndex = (
  ordered: readonly SessionListItem[],
  previousId: string | null,
  currentId: string | null,
): number => {
  if (ordered.length === 0) return 0;
  if (previousId) {
    const previousIndex = ordered.findIndex((session) => session.id === previousId);
    if (previousIndex !== -1) return previousIndex;
  }
  const firstSwitchable = ordered.findIndex((session) => session.id !== currentId);
  return firstSwitchable === -1 ? 0 : firstSwitchable;
};
