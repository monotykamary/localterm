import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_KEYBOARD_HAPTICS_ENABLED,
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED,
  DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED,
} from "@/lib/constants";
import { clampKeyboardHeightScale } from "@/utils/clamp-keyboard-height-scale";
import {
  loadStoredKeyboardHaptics,
  storeKeyboardHaptics,
  subscribeStoredKeyboardHaptics,
} from "@/utils/stored-keyboard-haptics";
import {
  loadStoredKeyboardHeightScale,
  storeKeyboardHeightScale,
  subscribeStoredKeyboardHeightScale,
} from "@/utils/stored-keyboard-height-scale";
import {
  loadStoredKeyboardKeyPreview,
  storeKeyboardKeyPreview,
  subscribeStoredKeyboardKeyPreview,
} from "@/utils/stored-keyboard-key-preview";
import {
  loadStoredKeyboardKeyRepeat,
  storeKeyboardKeyRepeat,
  subscribeStoredKeyboardKeyRepeat,
} from "@/utils/stored-keyboard-key-repeat";

export interface OnScreenKeyboardSettingsControls {
  readonly heightScalePercent: number;
  readonly hapticsEnabled: boolean;
  readonly keyPreviewEnabled: boolean;
  readonly keyRepeatEnabled: boolean;
  readonly handleHeightScaleChange: (heightScalePercent: number) => void;
  readonly handleHapticsEnabledChange: (enabled: boolean) => void;
  readonly handleKeyPreviewEnabledChange: (enabled: boolean) => void;
  readonly handleKeyRepeatEnabledChange: (enabled: boolean) => void;
  readonly resetKeyboardSettings: () => void;
}

export const useOnScreenKeyboardSettings = (): OnScreenKeyboardSettingsControls => {
  const [heightScalePercent, setHeightScalePercent] = useState(loadStoredKeyboardHeightScale);
  const [hapticsEnabled, setHapticsEnabled] = useState(loadStoredKeyboardHaptics);
  const [keyPreviewEnabled, setKeyPreviewEnabled] = useState(loadStoredKeyboardKeyPreview);
  const [keyRepeatEnabled, setKeyRepeatEnabled] = useState(loadStoredKeyboardKeyRepeat);

  const handleHeightScaleChange = useCallback((nextHeightScalePercent: number) => {
    const clampedHeightScalePercent = clampKeyboardHeightScale(nextHeightScalePercent);
    setHeightScalePercent(clampedHeightScalePercent);
    storeKeyboardHeightScale(clampedHeightScalePercent);
  }, []);

  const handleHapticsEnabledChange = useCallback((enabled: boolean) => {
    setHapticsEnabled(enabled);
    storeKeyboardHaptics(enabled);
  }, []);

  const handleKeyPreviewEnabledChange = useCallback((enabled: boolean) => {
    setKeyPreviewEnabled(enabled);
    storeKeyboardKeyPreview(enabled);
  }, []);

  const handleKeyRepeatEnabledChange = useCallback((enabled: boolean) => {
    setKeyRepeatEnabled(enabled);
    storeKeyboardKeyRepeat(enabled);
  }, []);

  const resetKeyboardSettings = useCallback(() => {
    setHeightScalePercent(DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT);
    setHapticsEnabled(DEFAULT_KEYBOARD_HAPTICS_ENABLED);
    setKeyPreviewEnabled(DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED);
    setKeyRepeatEnabled(DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED);
    storeKeyboardHeightScale(DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT);
    storeKeyboardHaptics(DEFAULT_KEYBOARD_HAPTICS_ENABLED);
    storeKeyboardKeyPreview(DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED);
    storeKeyboardKeyRepeat(DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED);
  }, []);

  useEffect(() => {
    const unsubscribes = [
      subscribeStoredKeyboardHeightScale(setHeightScalePercent),
      subscribeStoredKeyboardHaptics(setHapticsEnabled),
      subscribeStoredKeyboardKeyPreview(setKeyPreviewEnabled),
      subscribeStoredKeyboardKeyRepeat(setKeyRepeatEnabled),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return {
    heightScalePercent,
    hapticsEnabled,
    keyPreviewEnabled,
    keyRepeatEnabled,
    handleHeightScaleChange,
    handleHapticsEnabledChange,
    handleKeyPreviewEnabledChange,
    handleKeyRepeatEnabledChange,
    resetKeyboardSettings,
  };
};
