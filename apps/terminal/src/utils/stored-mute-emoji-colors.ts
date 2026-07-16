import { DEFAULT_MUTE_EMOJI_COLORS, MUTE_EMOJI_COLORS_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  MUTE_EMOJI_COLORS_STORAGE_KEY,
  DEFAULT_MUTE_EMOJI_COLORS,
);

export const loadStoredMuteEmojiColors = setting.load;
export const storeMuteEmojiColors = setting.store;
export const subscribeStoredMuteEmojiColors = setting.subscribe;
