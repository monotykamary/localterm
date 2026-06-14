import { TERMINAL_SCROLLBACK_STORAGE_KEY } from "@/lib/constants";
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  isTerminalScrollbackValue,
} from "@/lib/terminal-scrollback";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const scrollbackClamp = (value: number): number =>
  isTerminalScrollbackValue(value) ? value : DEFAULT_TERMINAL_SCROLLBACK_LINES;

const setting = createNumericStoredSetting(
  TERMINAL_SCROLLBACK_STORAGE_KEY,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  scrollbackClamp,
);

export const loadStoredTerminalScrollback = setting.load;
export const storeTerminalScrollback = setting.store;
export const subscribeStoredTerminalScrollback = setting.subscribe;
