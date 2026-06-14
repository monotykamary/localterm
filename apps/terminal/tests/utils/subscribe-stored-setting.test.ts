import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY } from "../../src/lib/constants";
import { subscribeStoredTerminalScrollOnUserInput } from "../../src/utils/stored-terminal-scroll-on-user-input";

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
  return store;
};

const dispatchStorage = (key: string | null) => {
  window.dispatchEvent(new StorageEvent("storage", { key }));
};

describe("subscribeStoredTerminalScrollOnUserInput", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("invokes the callback with the freshly loaded value on a matching key change", () => {
    const store = installFakeLocalStorage({ [TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY]: "false" });
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredTerminalScrollOnUserInput(onChange);

    dispatchStorage(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY);
    expect(onChange).toHaveBeenLastCalledWith(false);

    store.set(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY, "true");
    dispatchStorage(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY);
    expect(onChange).toHaveBeenLastCalledWith(true);

    unsubscribe();
  });

  it("ignores storage events for unrelated keys", () => {
    installFakeLocalStorage();
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredTerminalScrollOnUserInput(onChange);

    dispatchStorage("localterm:some-other-key");
    expect(onChange).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("re-syncs on a full localStorage clear (null key)", () => {
    installFakeLocalStorage();
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredTerminalScrollOnUserInput(onChange);

    dispatchStorage(null);
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("stops invoking the callback after unsubscribe", () => {
    installFakeLocalStorage();
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredTerminalScrollOnUserInput(onChange);

    unsubscribe();
    dispatchStorage(TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY);
    expect(onChange).not.toHaveBeenCalled();
  });
});
