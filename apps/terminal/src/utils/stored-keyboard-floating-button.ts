import { KEYBOARD_FLOATING_BUTTON_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";
import { detectHybridTouchDevice } from "@/utils/detect-hybrid-touch-device";

// The default is resolved lazily per device: on for hybrid touchscreens (the
// gesture path never fires there), off everywhere else — touch-primary devices
// already auto-open the keyboard, and mouse-only desktops stay uncluttered
// until the user opts in.
const setting = createBooleanStoredSetting(
  KEYBOARD_FLOATING_BUTTON_STORAGE_KEY,
  detectHybridTouchDevice,
);

export const loadStoredKeyboardFloatingButton = setting.load;
export const storeKeyboardFloatingButton = setting.store;
export const subscribeStoredKeyboardFloatingButton = setting.subscribe;
