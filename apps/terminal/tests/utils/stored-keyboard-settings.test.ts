import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_KEYBOARD_HAPTICS_ENABLED,
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED,
  DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED,
  KEYBOARD_HAPTICS_STORAGE_KEY,
  KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
  KEYBOARD_HEIGHT_SCALE_STORAGE_KEY,
  KEYBOARD_KEY_PREVIEW_STORAGE_KEY,
  KEYBOARD_KEY_REPEAT_STORAGE_KEY,
} from "../../src/lib/constants";
import {
  loadStoredKeyboardHaptics,
  storeKeyboardHaptics,
} from "../../src/utils/stored-keyboard-haptics";
import {
  loadStoredKeyboardHeightScale,
  storeKeyboardHeightScale,
} from "../../src/utils/stored-keyboard-height-scale";
import {
  loadStoredKeyboardKeyPreview,
  storeKeyboardKeyPreview,
} from "../../src/utils/stored-keyboard-key-preview";
import {
  loadStoredKeyboardKeyRepeat,
  storeKeyboardKeyRepeat,
} from "../../src/utils/stored-keyboard-key-repeat";

const installFakeLocalStorage = (initial: Record<string, string> = {}) => {
  const values = new Map<string, string>(Object.entries(initial));
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => Array.from(values.keys())[index] ?? null,
  };
  vi.stubGlobal("localStorage", storage);
};

describe("stored keyboard settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads compact, tactile defaults when no preferences exist", () => {
    installFakeLocalStorage();
    expect(loadStoredKeyboardHeightScale()).toBe(DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT);
    expect(loadStoredKeyboardHaptics()).toBe(DEFAULT_KEYBOARD_HAPTICS_ENABLED);
    expect(loadStoredKeyboardKeyPreview()).toBe(DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED);
    expect(loadStoredKeyboardKeyRepeat()).toBe(DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED);
  });

  it("loads stored preferences and clamps the height scale", () => {
    installFakeLocalStorage({
      [KEYBOARD_HEIGHT_SCALE_STORAGE_KEY]: "999",
      [KEYBOARD_HAPTICS_STORAGE_KEY]: "false",
      [KEYBOARD_KEY_PREVIEW_STORAGE_KEY]: "false",
      [KEYBOARD_KEY_REPEAT_STORAGE_KEY]: "false",
    });
    expect(loadStoredKeyboardHeightScale()).toBe(KEYBOARD_HEIGHT_SCALE_MAX_PERCENT);
    expect(loadStoredKeyboardHaptics()).toBe(false);
    expect(loadStoredKeyboardKeyPreview()).toBe(false);
    expect(loadStoredKeyboardKeyRepeat()).toBe(false);
  });

  it("stores every preference independently", () => {
    installFakeLocalStorage();
    storeKeyboardHeightScale(90);
    storeKeyboardHaptics(false);
    storeKeyboardKeyPreview(false);
    storeKeyboardKeyRepeat(false);
    expect(localStorage.getItem(KEYBOARD_HEIGHT_SCALE_STORAGE_KEY)).toBe("90");
    expect(localStorage.getItem(KEYBOARD_HAPTICS_STORAGE_KEY)).toBe("false");
    expect(localStorage.getItem(KEYBOARD_KEY_PREVIEW_STORAGE_KEY)).toBe("false");
    expect(localStorage.getItem(KEYBOARD_KEY_REPEAT_STORAGE_KEY)).toBe("false");
  });
});
