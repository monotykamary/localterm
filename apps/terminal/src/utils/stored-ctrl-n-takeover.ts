import { CTRL_N_TAKEOVER_STORAGE_KEY, DEFAULT_CTRL_N_TAKEOVER_ENABLED } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  CTRL_N_TAKEOVER_STORAGE_KEY,
  DEFAULT_CTRL_N_TAKEOVER_ENABLED,
);

export const loadStoredCtrlNTakeover = setting.load;
export const storeCtrlNTakeover = setting.store;
export const subscribeStoredCtrlNTakeover = setting.subscribe;
