export const RUN_QUERY_PARAM = "run";

// Drops the single-use ?run= claim token from the address bar once the session
// is established, so a reload or copied URL can never look like a fresh run.
export const removeRunQueryParam = (): void => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RUN_QUERY_PARAM)) return;
  url.searchParams.delete(RUN_QUERY_PARAM);
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* Safari rate-limits replaceState; not fatal */
  }
};
