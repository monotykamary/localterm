import {
  NOTIFICATION_TAG_PREFIX,
  NOTIFICATION_TITLE,
} from "@/lib/constants";
import type { TerminalTheme } from "@/lib/terminal-themes";
import type { CaffeinateMode } from "@/components/keep-awake-menu";
import { shouldSuppressSessionNotification } from "@/utils/should-suppress-session-notification";
import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";
import type {
  AutomationWithNextRun,
  FontsResponse,
  GitBranchPr,
  GitDiffSummary,
  ServerToClientMessage,
} from "@monotykamary/localterm-server/protocol";
import type { Dispatch, SetStateAction } from "react";

interface CurrentRef<Value> {
  current: Value;
}

interface TerminalPtySize {
  cols: number;
  rows: number;
}

interface TerminalThemesState {
  activeThemeId: string;
  customThemes: readonly TerminalTheme[];
}

export interface TerminalControlMessageCallbacks {
  setPtySize: (value: TerminalPtySize | null) => void;
  setLiveCwd: (cwd: string | null) => void;
  setAutomations: (value: AutomationWithNextRun[]) => void;
  setCaffeinateSupported: (value: boolean) => void;
  setCaffeinateActive: (value: boolean) => void;
  setCaffeinatePeerActive: (value: boolean) => void;
  setCaffeinateMode: (value: CaffeinateMode) => void;
  setCaffeinateDefaultCommands: (value: string[]) => void;
  setCaffeinateCommands: (value: string[]) => void;
  setCaffeinateActivityGate: (value: boolean) => void;
  setCaffeinatePeerKeepAwake: (value: boolean) => void;
  setCaffeinateBatteryThreshold: (value: number | null) => void;
  setCaffeinateActiveTrigger: (value: string | null) => void;
  setGitDiffSummary: (summary: GitDiffSummary | null) => void;
  setGitDirtyVersion: Dispatch<SetStateAction<number | undefined>>;
  setPushedPr: (pr: GitBranchPr | null) => void;
  applyThemesState: (state: TerminalThemesState) => void;
  applyFontsState: (state: FontsResponse) => void;
}

interface TerminalControlMessageActivity {
  handleForegroundProcess: (process: string | null) => void;
}

interface TerminalControlMessageSessionLifecycle {
  setCdpControlled: (controlled: boolean) => void;
}

interface DispatchTerminalControlMessageOptions {
  activity: TerminalControlMessageActivity;
  callbacks: TerminalControlMessageCallbacks;
  fitToContainer: () => void;
  lifecycle: TerminalControlMessageSessionLifecycle;
  liveSessionIdRef: CurrentRef<string | null>;
  ptySizeRef: CurrentRef<TerminalPtySize | null>;
  qrPeerAttachedRef: CurrentRef<(() => void) | null>;
}

export const dispatchTerminalControlMessage = (
  message: ServerToClientMessage,
  {
    activity,
    callbacks,
    fitToContainer,
    lifecycle,
    liveSessionIdRef,
    ptySizeRef,
    qrPeerAttachedRef,
  }: DispatchTerminalControlMessageOptions,
): boolean => {
  if (message.type === "automations") {
    callbacks.setAutomations(message.automations);
  } else if (message.type === "themes") {
    callbacks.applyThemesState({
      activeThemeId: message.activeThemeId,
      customThemes: message.customThemes,
    });
  } else if (message.type === "fonts") {
    callbacks.applyFontsState({
      activeFontId: message.activeFontId,
      customFontFamily: message.customFontFamily,
      nerdFontEnabled: message.nerdFontEnabled,
      ligaturesEnabled: message.ligaturesEnabled,
      initialized: message.initialized,
    });
  } else if (message.type === "caffeinate") {
    callbacks.setCaffeinateSupported(message.supported);
    callbacks.setCaffeinateActive(message.active);
    callbacks.setCaffeinatePeerActive(message.peerActive);
    callbacks.setCaffeinateMode(message.mode);
    callbacks.setCaffeinateDefaultCommands(message.defaultCommands);
    callbacks.setCaffeinateCommands(message.commands);
    callbacks.setCaffeinateActivityGate(message.activityGate);
    callbacks.setCaffeinatePeerKeepAwake(message.peerKeepAwake);
    callbacks.setCaffeinateBatteryThreshold(message.batteryThreshold);
    callbacks.setCaffeinateActiveTrigger(message.activeTrigger);
  } else if (message.type === "cwd") {
    callbacks.setLiveCwd(message.cwd);
    callbacks.setGitDiffSummary(null);
  } else if (message.type === "git-diff-summary") {
    callbacks.setGitDiffSummary(message.summary);
    callbacks.setGitDirtyVersion((version) => (version ?? 0) + 1);
  } else if (message.type === "git-branch-pr") {
    callbacks.setPushedPr(message.pr);
  } else if (message.type === "foreground") {
    activity.handleForegroundProcess(message.process);
  } else if (message.type === "notification") {
    if ("Notification" in window && Notification.permission === "granted") {
      // Show via the SW so the click fires the SW's notificationclick,
      // which can focus a background tab through WindowClient.focus() —
      // the API browsers honor, unlike a main-thread window.focus(). The
      // per-session tag coalesces the copies the daemon fanned out to the
      // user's other tabs into one OS notification. Falls back to a
      // page-owned Notification when no SW is active (dev / not controlling).
      const sessionId = message.sessionId;
      const isViewer = sessionId === liveSessionIdRef.current;
      // The foreground viewer tab can already see the result on screen, so
      // it skips the OS notification — see shouldSuppressSessionNotification
      // for the cross-tab + foreground suppression rules.
      if (
        shouldSuppressSessionNotification({
          isViewer,
          hasViewers: message.hasViewers,
          documentVisible: document.visibilityState === "visible",
          documentFocused: document.hasFocus(),
        })
      ) {
        return true;
      }
      const serviceWorker = navigator.serviceWorker;
      if (serviceWorker?.controller) {
        void serviceWorker.ready.then((registration) =>
          registration.showNotification(NOTIFICATION_TITLE, {
            body: message.body,
            tag: `${NOTIFICATION_TAG_PREFIX}${sessionId}`,
            data: { sid: sessionId, hasViewers: message.hasViewers },
          }),
        );
      } else {
        const notification = new Notification(message.body);
        notification.onclick = () => {
          window.focus();
          if (!isViewer && sessionId) {
            // Orphaned (suppression only shows this when !hasViewers):
            // open a fresh tab on the session instead of hijacking this one.
            const url = new URL(window.location.href);
            url.searchParams.set(SESSION_ID_QUERY_PARAM, sessionId);
            window.open(url.toString(), "_blank");
          }
          notification.close();
        };
      }
    }
  } else if (message.type === "cdp-controlled") {
    lifecycle.setCdpControlled(message.controlled);
  } else if (message.type === "peer-attached") {
    qrPeerAttachedRef.current?.();
  } else if (message.type === "pty-size") {
    ptySizeRef.current = { cols: message.cols, rows: message.rows };
    callbacks.setPtySize({ cols: message.cols, rows: message.rows });
    // Refit immediately (not the debounced scheduleFit) so the grid
    // reflows to the new effective size in the same tick the mask
    // recomputes — a debounced refit would leave the old grid sitting
    // under the new mask position for a frame, bleeding the prior
    // effective width through the wash. pty-size frames are infrequent
    // (peer attach/detach/resize), so the synchronous reflow cost is fine.
    fitToContainer();
  } else {
    return false;
  }
  return true;
};
