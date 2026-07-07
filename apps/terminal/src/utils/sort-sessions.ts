import type {
  SessionActivityState,
  SessionListItem,
} from "@monotykamary/localterm-server/protocol";

// Picker order: the tab's current session pins to the top so a filtered list
// never loses "where am I now"; the rest group by activity — running (green)
// first, alive-quiet (blue) second, ready (grey) last — and within each group
// the sessions this tab's browser profile is attached to float up (so "my
// profile's shells" cluster together), then by most-recent output so the shells
// you last touched float up.
const STATE_SORT_PRIORITY: Record<SessionActivityState, number> = {
  running: 0,
  "alive-quiet": 1,
  ready: 2,
};

const matchesQuery = (session: SessionListItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;
  return (
    session.title.toLowerCase().includes(normalizedQuery) ||
    session.cwd.toLowerCase().includes(normalizedQuery) ||
    session.shellName.toLowerCase().includes(normalizedQuery)
  );
};

const isProfileAttached = (session: SessionListItem, currentWindowId: string | null): boolean => {
  if (!currentWindowId) return false;
  return (session.clientProfiles ?? []).some((profile) => profile.windowId === currentWindowId);
};

export const sortSessions = (
  sessions: readonly SessionListItem[],
  currentId: string | null,
  normalizedQuery: string,
  currentWindowId: string | null = null,
): SessionListItem[] =>
  [...sessions]
    .filter((session) => matchesQuery(session, normalizedQuery))
    .sort((a, b) => {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
      const priorityA = STATE_SORT_PRIORITY[a.state];
      const priorityB = STATE_SORT_PRIORITY[b.state];
      if (priorityA !== priorityB) return priorityA - priorityB;
      const aProfile = isProfileAttached(a, currentWindowId);
      const bProfile = isProfileAttached(b, currentWindowId);
      if (aProfile !== bProfile) return aProfile ? -1 : 1;
      return b.lastOutputAt - a.lastOutputAt;
    });
