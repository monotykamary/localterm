import type { SessionListItem } from "@monotykamary/localterm-server/protocol";

// Pick the shell to resume on a touch-device bare connect: the user's most
// recently active session (highest lastOutputAt — the shell that last produced
// output, i.e. the foreground tab where a build or agent run is happening).
// Returns null when no live session exists. Multi-viewer join is intentional:
// the phone becomes a second viewer on the desktop's active shell.
export const resolveResumeSession = (sessions: readonly SessionListItem[]): string | null => {
  if (sessions.length === 0) return null;
  let best = sessions[0];
  for (const session of sessions) {
    if (session.lastOutputAt > best.lastOutputAt) best = session;
  }
  return best.id;
};
