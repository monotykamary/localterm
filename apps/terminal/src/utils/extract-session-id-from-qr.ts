import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";

// Pulls a session id out of a scanned QR payload. Both the mobile PWA and the
// desktop ingest key off ?sid=, so the scanner accepts a full share URL
// (`https://localterm.localhost/?sid=…`) and falls back to a bare `sid=…`
// fragment for QRs that encoded only the param. Returns null for payloads that
// carry no session id so the ingest loop keeps hunting instead of switching
// to garbage.
export const extractSessionIdFromQr = (data: string): string | null => {
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const sid = parsed.searchParams.get(SESSION_ID_QUERY_PARAM);
    if (sid) return sid;
  } catch {
    // Not an absolute URL — fall through to a bare sid=… match below.
  }
  const match = trimmed.match(/(?:^|[?&#\s])sid=([^&#\s]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};
