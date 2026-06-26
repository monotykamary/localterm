export const SESSION_ID_QUERY_PARAM = "sid";

// Mirrors the live PTY id into the address bar so a full page refresh
// reattaches to the same shell instead of spawning a fresh one (which would
// orphan the old PTY for the grace window). A null sid clears the param — on
// shell exit, so a manual Reconnect or refresh never targets a dead PTY.
// Set/cleared via replaceState alongside ?cwd=/run=/cmd=.
export const syncSessionIdQueryParam = (sid: string | null): void => {
  const url = new URL(window.location.href);
  const current = url.searchParams.get(SESSION_ID_QUERY_PARAM);
  const next = sid ?? null;
  if (current === next) return;
  if (next === null) url.searchParams.delete(SESSION_ID_QUERY_PARAM);
  else url.searchParams.set(SESSION_ID_QUERY_PARAM, next);
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* Safari rate-limits replaceState; not fatal */
  }
};
