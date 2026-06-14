import { NERD_FONT_ENABLED_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(NERD_FONT_ENABLED_STORAGE_KEY, false);

export const loadStoredNerdFontEnabled = setting.load;
export const storeNerdFontEnabled = setting.store;
export const subscribeStoredNerdFontEnabled = setting.subscribe;
