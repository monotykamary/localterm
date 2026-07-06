import type { TerminalTheme } from "@/lib/terminal-themes";
import { CUSTOM_THEMES_STORAGE_KEY } from "@/lib/constants";

const isTerminalTheme = (value: unknown): value is TerminalTheme => {
  if (typeof value !== "object" || value === null) return false;
  const theme = value as Record<string, unknown>;
  return (
    typeof theme.id === "string" &&
    typeof theme.name === "string" &&
    typeof theme.source === "string" &&
    typeof theme.colors === "object" &&
    theme.colors !== null
  );
};

const loadRaw = (): TerminalTheme[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTerminalTheme);
  } catch {
    return [];
  }
};

const storeRaw = (themes: readonly TerminalTheme[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    /* localStorage unavailable or full; imported themes apply in-session */
  }
};

export const loadStoredCustomThemes = (): TerminalTheme[] => loadRaw();

export const storeCustomThemes = (themes: readonly TerminalTheme[]): void => storeRaw(themes);

export const subscribeStoredCustomThemes = (onChange: (themes: TerminalTheme[]) => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== null && event.key !== CUSTOM_THEMES_STORAGE_KEY) return;
    onChange(loadRaw());
  };
  window.addEventListener("storage", handleStorageEvent);
  return () => window.removeEventListener("storage", handleStorageEvent);
};
