import {
  DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED,
  KEYBOARD_KEY_PREVIEW_STORAGE_KEY,
} from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  KEYBOARD_KEY_PREVIEW_STORAGE_KEY,
  DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED,
);

export const loadStoredKeyboardKeyPreview = setting.load;
export const storeKeyboardKeyPreview = setting.store;
export const subscribeStoredKeyboardKeyPreview = setting.subscribe;
