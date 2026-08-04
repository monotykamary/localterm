import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { detectCtrlNTakeoverSupported } from "@/utils/detect-ctrl-n-takeover-supported";

const TAKEOVER_KEY_CODES = ["KeyN"];
const FULLSCREEN_REQUEST_ERROR =
  "Fullscreen was blocked. Enter fullscreen manually to activate Ctrl+N takeover.";
const KEYBOARD_LOCK_ERROR =
  "Keyboard Lock was refused. Allow Keyboard Lock in this site's browser permissions, then try again.";

interface UseCtrlNTakeoverOptions {
  enabled: boolean;
  onError?: (message: string) => void;
  onKeyboardLockFailure?: () => void;
}

const applyCtrlNLock = (
  onError?: (message: string) => void,
  onKeyboardLockFailure?: () => void,
) => {
  void navigator.keyboard?.lock(TAKEOVER_KEY_CODES).catch(() => {
    onKeyboardLockFailure?.();
    onError?.(KEYBOARD_LOCK_ERROR);
  });
};

// Chromium browsers on non-Mac reserve Ctrl+N (new window) below the page — the
// keydown never reaches the DOM, while macOS uses Cmd+N and passes Ctrl+N
// through. Keyboard Lock hands the combo to the page only in fullscreen.
// The returned activation callback must run directly inside the settings click
// so requestFullscreen retains transient user activation; the effect handles
// persisted settings, later fullscreen transitions, and cleanup.
export const useCtrlNTakeover = ({
  enabled,
  onError,
  onKeyboardLockFailure,
}: UseCtrlNTakeoverOptions): (() => void) => {
  const enabledRef = useRef(enabled);
  const hookRequestedFullscreenRef = useRef(false);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    return () => {
      enabledRef.current = false;
    };
  }, [enabled]);

  const activateCtrlNTakeover = useCallback(() => {
    if (!detectCtrlNTakeoverSupported() || document.fullscreenElement !== null) return;
    hookRequestedFullscreenRef.current = true;
    let fullscreenRequest: Promise<void>;
    try {
      fullscreenRequest = document.documentElement.requestFullscreen();
    } catch {
      hookRequestedFullscreenRef.current = false;
      onError?.(FULLSCREEN_REQUEST_ERROR);
      return;
    }
    void fullscreenRequest
      .then(() => {
        if (!enabledRef.current) {
          hookRequestedFullscreenRef.current = false;
          void document.exitFullscreen();
          return;
        }
        applyCtrlNLock(onError, onKeyboardLockFailure);
      })
      .catch(() => {
        hookRequestedFullscreenRef.current = false;
        onError?.(FULLSCREEN_REQUEST_ERROR);
      });
  }, [onError, onKeyboardLockFailure]);

  useEffect(() => {
    if (!enabled || !detectCtrlNTakeoverSupported()) return;
    if (document.fullscreenElement !== null) {
      applyCtrlNLock(onError, onKeyboardLockFailure);
    }
    const handleFullscreenChange = () => {
      if (document.fullscreenElement === null) {
        hookRequestedFullscreenRef.current = false;
        return;
      }
      applyCtrlNLock(onError, onKeyboardLockFailure);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      navigator.keyboard?.unlock();
      if (hookRequestedFullscreenRef.current && document.fullscreenElement !== null) {
        hookRequestedFullscreenRef.current = false;
        void document.exitFullscreen();
      }
    };
  }, [enabled, onError, onKeyboardLockFailure]);

  return activateCtrlNTakeover;
};
