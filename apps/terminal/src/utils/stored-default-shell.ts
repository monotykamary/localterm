import { DEFAULT_SHELL_STORAGE_KEY } from "@/lib/constants";
import { createStringStoredSetting } from "@/utils/create-stored-setting";

const setting = createStringStoredSetting(DEFAULT_SHELL_STORAGE_KEY, "");

export const loadStoredDefaultShell = setting.load;
export const storeDefaultShell = setting.store;
export const subscribeStoredDefaultShell = setting.subscribe;
