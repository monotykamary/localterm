import { LIGATURES_ENABLED_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(LIGATURES_ENABLED_STORAGE_KEY, false);

export const loadStoredLigaturesEnabled = setting.load;
export const storeLigaturesEnabled = setting.store;
export const subscribeStoredLigaturesEnabled = setting.subscribe;
