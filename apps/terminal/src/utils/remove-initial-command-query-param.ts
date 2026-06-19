export const INITIAL_COMMAND_QUERY_PARAM = "cmd";

// Drops the transient ?cmd= (a worktree's setup script) from the address bar
// once the session that ran it is established, so a reload or reconnect in
// this tab never re-runs the setup script. Mirrors removeRunQueryParam for
// ?run=.
export const removeInitialCommandQueryParam = (): void => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(INITIAL_COMMAND_QUERY_PARAM)) return;
  url.searchParams.delete(INITIAL_COMMAND_QUERY_PARAM);
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* Safari rate-limits replaceState; not fatal */
  }
};
