import {
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  KEYBOARD_HEIGHT_SCALE_STORAGE_KEY,
} from "@/lib/constants";
import { clampKeyboardHeightScale } from "@/utils/clamp-keyboard-height-scale";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const setting = createNumericStoredSetting(
  KEYBOARD_HEIGHT_SCALE_STORAGE_KEY,
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  clampKeyboardHeightScale,
);

export const loadStoredKeyboardHeightScale = setting.load;
export const storeKeyboardHeightScale = setting.store;
export const subscribeStoredKeyboardHeightScale = setting.subscribe;
