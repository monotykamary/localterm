import {
  DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED,
  KEYBOARD_KEY_REPEAT_STORAGE_KEY,
} from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  KEYBOARD_KEY_REPEAT_STORAGE_KEY,
  DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED,
);

export const loadStoredKeyboardKeyRepeat = setting.load;
export const storeKeyboardKeyRepeat = setting.store;
export const subscribeStoredKeyboardKeyRepeat = setting.subscribe;
