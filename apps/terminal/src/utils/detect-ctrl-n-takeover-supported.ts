import { detectKeyboardLockSupported } from "@/utils/detect-keyboard-lock-supported";

export const detectCtrlNTakeoverSupported = (): boolean =>
  detectKeyboardLockSupported() &&
  typeof document !== "undefined" &&
  typeof document.documentElement.requestFullscreen === "function" &&
  typeof document.exitFullscreen === "function";
