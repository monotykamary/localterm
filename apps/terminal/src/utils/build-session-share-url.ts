import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";

// Builds a clean share URL carrying only this tab's live PTY id: the mobile
// PWA scans the QR, opens it, and reattaches to the same shell. The cwd/run
// query params are dropped deliberately — a fresh PWA load should attach to the
// shared session, not spawn a shell scoped to the desktop's cwd.
export const buildSessionShareUrl = (sid: string): string => {
  const url = new URL(window.location.origin);
  url.searchParams.set(SESSION_ID_QUERY_PARAM, sid);
  return url.toString();
};
