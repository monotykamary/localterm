import { useCallback, useEffect, useState } from "react";
import {
  loadStoredCtrlNTakeover,
  storeCtrlNTakeover,
  subscribeStoredCtrlNTakeover,
} from "@/utils/stored-ctrl-n-takeover";
import {
  loadStoredKeyboardFloatingButton,
  storeKeyboardFloatingButton,
  subscribeStoredKeyboardFloatingButton,
} from "@/utils/stored-keyboard-floating-button";

export interface KeyboardAccessSettingsControls {
  readonly floatingKeyboardButtonEnabled: boolean;
  readonly ctrlNTakeoverEnabled: boolean;
  readonly handleFloatingKeyboardButtonEnabledChange: (enabled: boolean) => void;
  readonly handleCtrlNTakeoverEnabledChange: (enabled: boolean) => void;
}

export const useKeyboardAccessSettings = (): KeyboardAccessSettingsControls => {
  const [floatingKeyboardButtonEnabled, setFloatingKeyboardButtonEnabled] = useState(
    loadStoredKeyboardFloatingButton,
  );
  const [ctrlNTakeoverEnabled, setCtrlNTakeoverEnabled] = useState(loadStoredCtrlNTakeover);

  const handleFloatingKeyboardButtonEnabledChange = useCallback((enabled: boolean) => {
    setFloatingKeyboardButtonEnabled(enabled);
    storeKeyboardFloatingButton(enabled);
  }, []);

  const handleCtrlNTakeoverEnabledChange = useCallback((enabled: boolean) => {
    setCtrlNTakeoverEnabled(enabled);
    storeCtrlNTakeover(enabled);
  }, []);

  useEffect(() => {
    const unsubscribes = [
      subscribeStoredKeyboardFloatingButton(setFloatingKeyboardButtonEnabled),
      subscribeStoredCtrlNTakeover(setCtrlNTakeoverEnabled),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return {
    floatingKeyboardButtonEnabled,
    ctrlNTakeoverEnabled,
    handleFloatingKeyboardButtonEnabledChange,
    handleCtrlNTakeoverEnabledChange,
  };
};
