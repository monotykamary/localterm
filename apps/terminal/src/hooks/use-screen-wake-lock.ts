import { useEffect } from "react";

/**
 * Keeps this device's screen awake while the server's keep-awake is engaged.
 * caffeinate holds the Mac awake; this mirrors it on whatever device is
 * running the PWA (notably an Android phone) via the Screen Wake Lock API.
 * Browsers auto-release the lock when the page hides, so it is re-acquired on
 * visibilitychange. Silently no-ops where the API is unavailable.
 */
export const useScreenWakeLock = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (cancelled) {
          if (!acquired.released) void acquired.release();
          return;
        }
        sentinel = acquired;
      } catch {
        // Battery saver, a restrictive permissions-policy, or OEM power
        // modes can deny the lock; stay quiet so a denial never surfaces as
        // a broken control alongside the active coffee button.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sentinel !== null && !sentinel.released) void sentinel.release();
      sentinel = null;
    };
  }, [active]);
};
