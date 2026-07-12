import {
  fontsResponseSchema,
  type FontsResponse,
  type UpdateFontsInput,
  type MigrateFontsInput,
} from "@monotykamary/localterm-server/protocol";

const FONTS_ENDPOINT = "/api/fonts";

// The daemon is the source of truth for the active font id + the custom
// family + the Nerd Font / ligatures toggles, shared with the `localterm font`
// CLI. The browser keeps a localStorage cache for instant initial render (no
// flash of the default) and reconciles against this read on mount so a CLI or
// other-tab change reaches open tabs.
export const fetchFonts = async (signal?: AbortSignal): Promise<FontsResponse | null> => {
  try {
    const response = await fetch(new URL(FONTS_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = fontsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// One-time push of the browser's legacy localStorage font state into the
// daemon's store, so an upgrade from the localStorage-only era doesn't lose the
// user's font selection / toggles. Only acts on a fresh (uninitialized)
// store; returns the post-migration state so the caller can reconcile.
export const migrateFonts = async (state: MigrateFontsInput): Promise<FontsResponse | null> => {
  try {
    const response = await fetch(new URL(`${FONTS_ENDPOINT}/migrate`, window.location.href), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!response.ok) return null;
    const parsed = fontsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Push a partial font update (only the field that changed). Returns the
// reconciled state on success; null on failure (the hook keeps its cache).
export const updateFonts = async (patch: UpdateFontsInput): Promise<FontsResponse | null> => {
  try {
    const response = await fetch(new URL(FONTS_ENDPOINT, window.location.href), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return null;
    const parsed = fontsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
