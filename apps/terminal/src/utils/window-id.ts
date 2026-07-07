import { WINDOW_ID_STORAGE_KEY } from "@/lib/constants";

// The WS `?wid=` query param — mirrors the server constant so the wire
// protocol stays authoritative (no parallel literals).
export const WINDOW_ID_QUERY_PARAM = "wid";

// Mint a uuid v4 without `crypto.randomUUID` (jsdom/older runtimes may lack it).
const mintUuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

// The stable per-browser-profile handle for this tab. Read from `localStorage`
// (partitioned per browser profile, so every tab of one profile shares it);
// minted and persisted on first miss so it survives reloads. Returns "" when
// storage is unavailable (SSR, private mode that throws) — the session still
// works, just groups under the unknown profile.
export const loadWindowId = (): string => {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(WINDOW_ID_STORAGE_KEY);
    if (stored && stored.trim() !== "") return stored;
    const minted = mintUuid();
    window.localStorage.setItem(WINDOW_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    return "";
  }
};
