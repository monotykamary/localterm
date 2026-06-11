import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT,
  TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY,
} from "../../src/lib/constants";
import { loadStoredTerminalScrollOnUserInput } from "../../src/utils/stored-terminal-scroll-on-user-input";

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
    setItem: () => {
      throw new Error("storage access denied");
    },
    removeItem: () => {},
    key: () => null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadStoredTerminalScrollOnUserInput", () => {
  it("returns the default when nothing is stored", () => {
    installFakeLocalStorage();
    expect(loadStoredTerminalScrollOnUserInput()).toBe(DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT);
  });

  it("returns true when 'true' is stored", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY]: "true" });
    expect(loadStoredTerminalScrollOnUserInput()).toBe(true);
  });

  it("returns false when 'false' is stored", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY]: "false" });
    expect(loadStoredTerminalScrollOnUserInput()).toBe(false);
  });

  it("falls back to the default when the value is unparseable", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY]: "yes" });
    expect(loadStoredTerminalScrollOnUserInput()).toBe(DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT);
  });

  it("falls back to the default when localStorage throws", () => {
    installThrowingLocalStorage();
    expect(loadStoredTerminalScrollOnUserInput()).toBe(DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT);
  });
});
