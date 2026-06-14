const loadRaw = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return null;
    return raw;
  } catch {
    return null;
  }
};

const storeRaw = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable (private mode, full quota); setting still applies in-session */
  }
};

// The browser fires a `storage` event in every OTHER same-origin tab when this
// tab mutates localStorage — the native cross-tab channel. `event.key === null`
// means the whole store was cleared (localStorage.clear()), which should also
// re-sync. Returns an unsubscribe.
const subscribeToStorageKey = (key: string, onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return;
    onChange();
  };
  window.addEventListener("storage", handleStorageEvent);
  return () => window.removeEventListener("storage", handleStorageEvent);
};

interface StoredSetting<T> {
  load: () => T;
  store: (value: T) => void;
  subscribe: (onChange: (value: T) => void) => () => void;
}

export const createNumericStoredSetting = (
  key: string,
  defaultValue: number,
  clamp: (value: number) => number,
): StoredSetting<number> => {
  const load = (): number => {
    const raw = loadRaw(key);
    if (raw === null) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultValue;
    return clamp(parsed);
  };
  return {
    load,
    store: (value) => storeRaw(key, String(value)),
    subscribe: (onChange) => subscribeToStorageKey(key, () => onChange(load())),
  };
};

export const createBooleanStoredSetting = (
  key: string,
  defaultValue: boolean,
): StoredSetting<boolean> => {
  const load = (): boolean => {
    const raw = loadRaw(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
  };
  return {
    load,
    store: (value) => storeRaw(key, String(value)),
    subscribe: (onChange) => subscribeToStorageKey(key, () => onChange(load())),
  };
};

export const createStringValidatedStoredSetting = <T extends string>(
  key: string,
  defaultValue: T,
  isValid: (value: string) => value is T,
): StoredSetting<T> => {
  const load = (): T => {
    const raw = loadRaw(key);
    if (raw !== null && isValid(raw)) return raw;
    return defaultValue;
  };
  return {
    load,
    store: (value) => storeRaw(key, value),
    subscribe: (onChange) => subscribeToStorageKey(key, () => onChange(load())),
  };
};

export const createStringLookupStoredSetting = <T>(
  key: string,
  lookup: (raw: string | null) => T,
  getId: (value: T) => string,
): StoredSetting<T> => {
  const load = (): T => lookup(loadRaw(key));
  return {
    load,
    store: (value) => storeRaw(key, getId(value)),
    subscribe: (onChange) => subscribeToStorageKey(key, () => onChange(load())),
  };
};
