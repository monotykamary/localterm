import { useCallback, useEffect, useState } from "react";

export type KeyboardLockPermissionState = PermissionState | "unknown";

interface KeyboardLockPermissionControls {
  readonly permissionState: KeyboardLockPermissionState;
  readonly refreshPermissionState: () => void;
}

export const useKeyboardLockPermission = (): KeyboardLockPermissionControls => {
  const [permissionState, setPermissionState] = useState<KeyboardLockPermissionState>("unknown");
  const refreshPermissionState = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.permissions === undefined) return;
    void navigator.permissions
      .query({ name: "keyboard-lock" })
      .then((permissionStatus) => setPermissionState(permissionStatus.state))
      .catch(() => setPermissionState("unknown"));
  }, []);

  useEffect(() => {
    refreshPermissionState();
    window.addEventListener("focus", refreshPermissionState);
    return () => window.removeEventListener("focus", refreshPermissionState);
  }, [refreshPermissionState]);

  return { permissionState, refreshPermissionState };
};
