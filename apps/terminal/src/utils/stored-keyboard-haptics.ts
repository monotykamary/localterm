import { DEFAULT_KEYBOARD_HAPTICS_ENABLED, KEYBOARD_HAPTICS_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  KEYBOARD_HAPTICS_STORAGE_KEY,
  DEFAULT_KEYBOARD_HAPTICS_ENABLED,
);

export const loadStoredKeyboardHaptics = setting.load;
export const storeKeyboardHaptics = setting.store;
export const subscribeStoredKeyboardHaptics = setting.subscribe;
