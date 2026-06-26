import {
  sessionsListResponseSchema,
  type SessionListItem,
} from "@monotykamary/localterm-server/protocol";

const SESSIONS_ENDPOINT = "/api/sessions";

// Every live PTY on the daemon (attached or dormant) for the session picker.
// Polled only while the picker is open, so an idle tab never hits the daemon.
export const fetchSessions = async (signal?: AbortSignal): Promise<SessionListItem[] | null> => {
  try {
    const response = await fetch(new URL(SESSIONS_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = sessionsListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.sessions : null;
  } catch {
    return null;
  }
};

// Kill a live PTY by id (the picker's per-row dispose). The daemon tears down
// the shell and closes any attached clients. Returns false on a miss or
// network failure; the picker refetches either way so the list self-corrects.
export const killSession = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`${SESSIONS_ENDPOINT}/${encodeURIComponent(id)}`, window.location.href),
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
};
