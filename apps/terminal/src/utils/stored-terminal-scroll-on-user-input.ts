import {
  DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT,
  TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY,
} from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY,
  DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT,
);

export const loadStoredTerminalScrollOnUserInput = setting.load;
export const storeTerminalScrollOnUserInput = setting.store;
export const subscribeStoredTerminalScrollOnUserInput = setting.subscribe;
