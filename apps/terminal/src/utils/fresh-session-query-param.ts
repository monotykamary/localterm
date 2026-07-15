export const FRESH_SESSION_QUERY_PARAM = "fresh";

// Explicit new-shell links carry this only until their first session lands so
// mobile resume cannot reinterpret a deliberate spawn as a bare launch.
export const removeFreshSessionQueryParam = (): void => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FRESH_SESSION_QUERY_PARAM)) return;
  url.searchParams.delete(FRESH_SESSION_QUERY_PARAM);
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* Safari rate-limits replaceState; not fatal */
  }
};
