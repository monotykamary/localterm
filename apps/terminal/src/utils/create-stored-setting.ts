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

interface NumericStoredSetting {
  load: () => number;
  store: (value: number) => void;
}

export const createNumericStoredSetting = (
  key: string,
  defaultValue: number,
  clamp: (value: number) => number,
): NumericStoredSetting => ({
  load: () => {
    const raw = loadRaw(key);
    if (raw === null) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultValue;
    return clamp(parsed);
  },
  store: (value) => storeRaw(key, String(value)),
});

interface BooleanStoredSetting {
  load: () => boolean;
  store: (value: boolean) => void;
}

export const createBooleanStoredSetting = (
  key: string,
  defaultValue: boolean,
): BooleanStoredSetting => ({
  load: () => {
    const raw = loadRaw(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
  },
  store: (value) => storeRaw(key, String(value)),
});

interface StringValidatedStoredSetting<T extends string> {
  load: () => T;
  store: (value: T) => void;
}

export const createStringValidatedStoredSetting = <T extends string>(
  key: string,
  defaultValue: T,
  isValid: (value: string) => value is T,
): StringValidatedStoredSetting<T> => ({
  load: () => {
    const raw = loadRaw(key);
    if (raw !== null && isValid(raw)) return raw;
    return defaultValue;
  },
  store: (value) => storeRaw(key, value),
});

interface StringLookupStoredSetting<T> {
  load: () => T;
  store: (value: T) => void;
}

export const createStringLookupStoredSetting = <T>(
  key: string,
  lookup: (raw: string | null) => T,
  getId: (value: T) => string,
): StringLookupStoredSetting<T> => ({
  load: () => {
    const raw = loadRaw(key);
    return lookup(raw);
  },
  store: (value) => storeRaw(key, getId(value)),
});
