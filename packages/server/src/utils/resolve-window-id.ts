import { MAX_WINDOW_ID_LENGTH } from "../constants.js";

// Normalize the WS `?wid=` query param (a client-minted per-browser-profile
// handle) into a value safe to store on the client record and surface in the
// session list. An empty/oversized/garbage value degrades to "" — the unknown
// profile group — so a back-compat client (an older bundled terminal that
// doesn't send `wid`) or a hostile value can't corrupt the per-profile
// breakdown, only lose its own profile attribution.
export const resolveWindowId = (raw: string | undefined | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_WINDOW_ID_LENGTH) return "";
  return trimmed;
};
