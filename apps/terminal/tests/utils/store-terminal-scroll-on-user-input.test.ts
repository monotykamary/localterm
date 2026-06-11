import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY } from "../../src/lib/constants";
import { storeTerminalScrollOnUserInput } from "../../src/utils/stored-terminal-scroll-on-user-input";

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

describe("storeTerminalScrollOnUserInput", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes 'true' under the registered key when scrolling is pinned", () => {
    const { setItemMock } = installFakeLocalStorage();

    storeTerminalScrollOnUserInput(true);

    expect(setItemMock).toHaveBeenCalledWith(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY, "true");
  });

  it("writes 'false' when the user opts out of pin-to-bottom", () => {
    const { setItemMock } = installFakeLocalStorage();

    storeTerminalScrollOnUserInput(false);

    expect(setItemMock).toHaveBeenCalledWith(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY, "false");
  });

  it("swallows localStorage failures so a quota or private-mode error never throws", () => {
    const { setItemMock } = installThrowingLocalStorage();

    expect(() => storeTerminalScrollOnUserInput(true)).not.toThrow();
    expect(setItemMock).toHaveBeenCalledTimes(1);
  });
});
