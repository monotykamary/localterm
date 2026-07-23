import { themesResponseSchema, type ThemesResponse } from "@monotykamary/localterm-server/protocol";
import type { TerminalTheme } from "@/lib/terminal-themes";

const THEMES_ENDPOINT = "/api/themes";

// The daemon is the source of truth for the active theme id + the custom-theme
// library (~/.localterm/themes.json), shared with the `localterm theme` CLI. The
// browser keeps a localStorage cache for instant initial render (no flash of
// the default) and reconciles against this read on mount + on a slow poll so a
// CLI change reaches open tabs.
export const fetchThemes = async (signal?: AbortSignal): Promise<ThemesResponse | null> => {
  try {
    const response = await fetch(new URL(THEMES_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = themesResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// One-time push of the browser's legacy localStorage themes into the daemon's
// store, so an upgrade from the localStorage-only era doesn't lose the user's
// imported themes / active selection. Only acts on a fresh (uninitialized)
// store; returns the post-migration state so the caller can reconcile.
export const migrateThemes = async (
  activeThemeId: string,
  customThemes: readonly TerminalTheme[],
  lightThemeId: string,
  darkThemeId: string,
): Promise<ThemesResponse | null> => {
  try {
    const response = await fetch(new URL(`${THEMES_ENDPOINT}/migrate`, window.location.href), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeThemeId, customThemes, lightThemeId, darkThemeId }),
    });
    if (!response.ok) return null;
    const parsed = themesResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export type ImportThemeResult = { theme: TerminalTheme } | { error: string };

// Import a theme from raw file text (JSON or an iTerm .itermcolors plist). The
// daemon parses — one parser, shared with `localterm theme import` — and
// returns the stored theme (with its server-minted id) or a stable error string.
export const importTheme = async (text: string, filename: string): Promise<ImportThemeResult> => {
  try {
    const response = await fetch(new URL(`${THEMES_ENDPOINT}/import`, window.location.href), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, filename }),
    });
    if (response.status === 201) {
      const body = (await response.json()) as { theme: TerminalTheme };
      return { theme: body.theme };
    }
    if (response.status === 400) {
      const body = (await response.json()) as { error?: string; message?: string };
      return { error: body.message ?? body.error ?? "invalid theme file" };
    }
    if (response.status === 409) return { error: "too many custom themes" };
    return { error: "import failed" };
  } catch {
    return { error: "import failed" };
  }
};

// Make a theme active (a built-in id, "auto", or a custom id). Returns true on
// success; the hook then re-reads /api/themes to confirm + refresh its cache.
export const setActiveTheme = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(new URL(`${THEMES_ENDPOINT}/active`, window.location.href), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const setSystemThemes = async (
  lightThemeId: string,
  darkThemeId: string,
): Promise<boolean> => {
  try {
    const response = await fetch(new URL(`${THEMES_ENDPOINT}/system`, window.location.href), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lightThemeId, darkThemeId }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

// Delete an imported custom theme. Returns the new active id (the daemon resets
// to the default when the active theme is deleted) so the hook can update its
// cache, or null on failure.
export const deleteTheme = async (id: string): Promise<string | null> => {
  try {
    const response = await fetch(
      new URL(`${THEMES_ENDPOINT}/${encodeURIComponent(id)}`, window.location.href),
      { method: "DELETE" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { activeThemeId: string };
    return body.activeThemeId;
  } catch {
    return null;
  }
};
