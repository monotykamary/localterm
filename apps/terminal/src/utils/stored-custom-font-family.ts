import { CUSTOM_FONT_FAMILY_STORAGE_KEY } from "@/lib/constants";
import { createStringStoredSetting } from "@/utils/create-stored-setting";

const setting = createStringStoredSetting(CUSTOM_FONT_FAMILY_STORAGE_KEY, "");

export const loadStoredCustomFontFamily = setting.load;
export const storeCustomFontFamily = setting.store;
export const subscribeStoredCustomFontFamily = setting.subscribe;
