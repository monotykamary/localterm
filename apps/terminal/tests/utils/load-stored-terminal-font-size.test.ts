import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  TERMINAL_FONT_SIZE_MAX_PX,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
} from "../../src/lib/constants";
import { loadStoredTerminalFontSize } from "../../src/utils/stored-terminal-font-size";

const installFakeLocalStorage = (initial: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(initial));
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
};

const installThrowingLocalStorage = () => {
  const fakeStorage: Storage = {
    length: 0,
    clear: () => {},
    getItem: () => {
      throw new Error("storage access denied");
    },
    setItem: () => {},
    removeItem: () => {},
    key: () => null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
};

describe("loadStoredTerminalFontSize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the default when no value is stored", () => {
    installFakeLocalStorage();
    expect(loadStoredTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("returns the default when the stored value is the empty string", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "" });
    expect(loadStoredTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("returns the stored value when it parses to a valid integer in range", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "16" });
    expect(loadStoredTerminalFontSize()).toBe(16);
  });

  it("clamps a stored value below the minimum up to the minimum", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "1" });
    expect(loadStoredTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_MIN_PX);
  });

  it("clamps a stored value above the maximum down to the maximum", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "999" });
    expect(loadStoredTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_MAX_PX);
  });

  it("falls back to the default when the stored value is non-numeric", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "huge" });
    expect(loadStoredTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("falls back to the default when the stored value has trailing garbage (rejects 12abc)", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "12abc" });
    expect(loadStoredTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("falls back to the default when localStorage access throws", () => {
    installThrowingLocalStorage();
    expect(loadStoredTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });
});
