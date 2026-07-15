import { MOBILE_RESUME_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(MOBILE_RESUME_STORAGE_KEY, true);

export const loadStoredMobileResume = setting.load;
export const storeMobileResume = setting.store;
export const subscribeStoredMobileResume = setting.subscribe;
