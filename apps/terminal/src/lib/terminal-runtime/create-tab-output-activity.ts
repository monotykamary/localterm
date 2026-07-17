import { FAVICON_READY_DEBOUNCE_MS, FAVICON_RUNNING_DEBOUNCE_MS } from "@/lib/constants";
import { setTabFaviconState } from "@/utils/set-tab-favicon-state";

interface BeginTabOutputSessionOptions {
  foregroundProcess: string | null;
  isSwitch: boolean;
}

interface TabOutputActivity {
  beginSession: (options: BeginTabOutputSessionOptions) => void;
  getHasForegroundProcess: () => boolean;
  handleForegroundProcess: (process: string | null) => void;
  handleVisibilityChange: () => void;
  noteOutputActivity: () => void;
  reset: () => void;
}

export const createTabOutputActivity = (
  isInactive: () => boolean,
  setForegroundProcess: (process: string | null) => void,
): TabOutputActivity => {
  let faviconRunningTimer: number | null = null;
  let faviconReadyTimer: number | null = null;
  let lastOutputTimestamp = 0;
  let faviconState: "ready" | "running" | "alive-quiet" = "ready";
  let faviconBadge = false;
  let hadForegroundThisCycle = false;
  let hasForegroundProcess = false;

  const checkReadyAfterOutput = () => {
    const silence = performance.now() - lastOutputTimestamp;
    if (silence < FAVICON_READY_DEBOUNCE_MS) {
      faviconReadyTimer = window.setTimeout(
        checkReadyAfterOutput,
        FAVICON_READY_DEBOUNCE_MS - silence,
      );
      return;
    }
    faviconReadyTimer = null;
    if (faviconRunningTimer !== null) {
      window.clearTimeout(faviconRunningTimer);
      faviconRunningTimer = null;
    }
    if (faviconState === "running") {
      if (document.hidden && hadForegroundThisCycle) {
        faviconBadge = true;
      }
      if (!hasForegroundProcess) hadForegroundThisCycle = false;
      if (hasForegroundProcess) {
        faviconState = "alive-quiet";
        setTabFaviconState("alive-quiet", faviconBadge);
      } else {
        faviconState = "ready";
        setTabFaviconState("ready", faviconBadge);
      }
    }
  };

  const clearTimers = () => {
    if (faviconRunningTimer !== null) {
      window.clearTimeout(faviconRunningTimer);
      faviconRunningTimer = null;
    }
    if (faviconReadyTimer !== null) {
      window.clearTimeout(faviconReadyTimer);
      faviconReadyTimer = null;
    }
  };

  return {
    beginSession: ({ foregroundProcess, isSwitch }) => {
      // Re-sync the foreground flag from the PTY's current state, then re-seed
      // the favicon to match. The server's foreground watcher only emits on
      // change, so without this a reattaching client (page refresh, silent
      // reattach) or a fresh PTY after a daemon restart keeps hasForegroundProcess
      // at its stale prior value — stuck blue after a restart (stale true) or
      // grey-after-green on refresh (stale false, the deduped watcher never
      // re-emits). On a switch to a different PTY, drop the prior PTY's pending
      // favicon timers so they don't fire against the new one. A same-PTY
      // reattach keeps its timers — clearing the ready timer would interrupt
      // an in-progress green→blue quiet transition (leaving the icon stuck
      // green, never blue). Never clobber an active "running" (green): output
      // drives that, and checkReadyAfterOutput picks up the re-synced
      // hasForegroundProcess when output goes quiet.
      hasForegroundProcess = foregroundProcess !== null;
      setForegroundProcess(foregroundProcess);
      hadForegroundThisCycle = hasForegroundProcess;
      if (isSwitch) clearTimers();
      if (isSwitch || faviconState !== "running") {
        faviconBadge = false;
        faviconState = hasForegroundProcess ? "alive-quiet" : "ready";
        setTabFaviconState(faviconState);
      }
    },
    getHasForegroundProcess: () => hasForegroundProcess,
    handleForegroundProcess: (process) => {
      const nowHasProcess = process !== null;
      if (nowHasProcess) {
        hadForegroundThisCycle = true;
      } else if (faviconState === "alive-quiet") {
        if (document.hidden && hadForegroundThisCycle) faviconBadge = true;
        faviconState = "ready";
        hadForegroundThisCycle = false;
        setTabFaviconState("ready", faviconBadge);
      }
      hasForegroundProcess = nowHasProcess;
      setForegroundProcess(process);
    },
    handleVisibilityChange: () => {
      if (!document.hidden && faviconBadge) {
        faviconBadge = false;
        setTabFaviconState(faviconState);
      }
    },
    noteOutputActivity: () => {
      if (faviconState !== "running" && faviconRunningTimer === null) {
        faviconRunningTimer = window.setTimeout(() => {
          faviconRunningTimer = null;
          if (isInactive()) return;
          faviconState = "running";
          faviconBadge = false;
          setTabFaviconState("running");
        }, FAVICON_RUNNING_DEBOUNCE_MS);
      }
      lastOutputTimestamp = performance.now();
      if (faviconReadyTimer !== null) return;
      faviconReadyTimer = window.setTimeout(checkReadyAfterOutput, FAVICON_READY_DEBOUNCE_MS);
    },
    reset: () => {
      clearTimers();
      if (faviconState !== "ready" || faviconBadge) {
        faviconState = "ready";
        faviconBadge = false;
        setTabFaviconState("ready");
      }
      hadForegroundThisCycle = false;
    },
  };
};
