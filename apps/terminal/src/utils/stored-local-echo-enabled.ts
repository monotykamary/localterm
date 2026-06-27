import { DEFAULT_TERMINAL_LOCAL_ECHO, TERMINAL_LOCAL_ECHO_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  TERMINAL_LOCAL_ECHO_STORAGE_KEY,
  DEFAULT_TERMINAL_LOCAL_ECHO,
);

export const loadStoredLocalEcho = setting.load;
export const storeStoredLocalEcho = setting.store;
export const subscribeStoredLocalEcho = setting.subscribe;
