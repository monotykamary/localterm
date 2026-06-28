import { DEFAULT_CWD_STORAGE_KEY } from "@/lib/constants";
import { createStringStoredSetting } from "@/utils/create-stored-setting";

const setting = createStringStoredSetting(DEFAULT_CWD_STORAGE_KEY, "");

export const loadStoredDefaultCwd = setting.load;
export const storeDefaultCwd = setting.store;
export const subscribeStoredDefaultCwd = setting.subscribe;
