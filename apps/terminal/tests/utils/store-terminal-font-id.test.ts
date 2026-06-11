import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TERMINAL_FONT_STORAGE_KEY } from "../../src/lib/constants";
import { storeTerminalFontId } from "../../src/utils/stored-terminal-font-id";

const installFakeLocalStorage = (): { setItemMock: ReturnType<typeof vi.fn> } => {
  const store = new Map<string, string>();
  const setItemMock = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: setItemMock,
    removeItem: (key: string) => {
      store.delete(key);
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
  return { setItemMock };
};

const installThrowingLocalStorage = (): { setItemMock: ReturnType<typeof vi.fn> } => {
  const setItemMock = vi.fn(() => {
    throw new Error("quota exceeded");
  });
  const fakeStorage: Storage = {
    length: 0,
    clear: () => {},
    getItem: () => null,
    setItem: setItemMock,
    removeItem: () => {},
    key: () => null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
  return { setItemMock };
};

describe("storeTerminalFontId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes the given font id to localStorage under the registered key", () => {
    const { setItemMock } = installFakeLocalStorage();

    storeTerminalFontId("jetbrains-mono");

    expect(setItemMock).toHaveBeenCalledWith(TERMINAL_FONT_STORAGE_KEY, "jetbrains-mono");
  });

  it("swallows localStorage errors so a quota or private-mode failure never throws", () => {
    const { setItemMock } = installThrowingLocalStorage();

    expect(() => storeTerminalFontId("jetbrains-mono")).not.toThrow();
    expect(setItemMock).toHaveBeenCalledTimes(1);
  });
});
