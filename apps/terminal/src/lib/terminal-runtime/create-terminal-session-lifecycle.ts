import { syncSessionIdQueryParam } from "@/utils/sync-session-id-query-param";

interface CurrentRef<Value> {
  current: Value;
}

interface CreateTerminalSessionLifecycleOptions {
  liveSessionIdRef: CurrentRef<string | null>;
  previousSessionIdRef: CurrentRef<string | null>;
}

interface TerminalConnectionRequest {
  sessionId: string | null;
  shouldSpawnFreshSession: boolean;
}

interface TerminalSessionTransition {
  isSwitch: boolean;
  priorSessionId: string | null;
}

type TerminalConnectionCloseAction =
  | { type: "ignore" }
  | { type: "reconnect" }
  | { type: "retry" }
  | {
      type: "connection-lost";
      closeCode: number;
      closeReason: string;
      wasClean: boolean;
    };

interface TerminalSessionLifecycle {
  beginManualReconnect: () => void;
  completeInitialMobileResume: (sessionId: string | null) => boolean;
  getCdpControlled: () => boolean;
  getExited: () => boolean;
  handleConnectionClose: (
    closeCode: number,
    closeReason: string,
    wasClean: boolean,
  ) => TerminalConnectionCloseAction;
  handleSession: (sessionId: string | null | undefined) => TerminalSessionTransition;
  markConnectionLost: () => boolean;
  markShellDead: () => boolean;
  noteConnected: () => void;
  prepareConnection: () => TerminalConnectionRequest;
  requestFreshSession: () => void;
  requestSessionSwitch: (sessionId: string) => boolean;
  setCdpControlled: (controlled: boolean) => void;
  startInitialMobileResume: () => void;
}

export const createTerminalSessionLifecycle = ({
  liveSessionIdRef,
  previousSessionIdRef,
}: CreateTerminalSessionLifecycleOptions): TerminalSessionLifecycle => {
  let exited = false;
  let wasEverConnected = false;
  // Server-side PTY id (sent in the {type:"session"} message). Preserved
  // across reconnects and forwarded as `?sid=` so the daemon can attach to
  // the live PTY instead of spawning a fresh shell. Cleared on genuine shell
  // exit (markShellDead) so the dead session is never reattached on a manual
  // Reconnect. Mirrored into liveSessionIdRef so the session picker can badge
  // the PTY this tab is currently viewing and skip re-switching to it.
  let liveSessionId: string | null = null;
  // Override sid for the next connect(): set by switchSession() so the next
  // WebSocket opens against the picked PTY instead of the current one. The
  // session-frame handler leaves liveSessionId alone until the new frame
  // lands, so the new id compares unequal to the old one and the handler
  // treats it as a switch (reset + scrollback replay). A fresh in-place
  // switch keeps liveSessionId for the same comparison but omits it from every
  // retry until the replacement session frame lands.
  let nextConnectSid: string | null = null;
  let shouldSpawnFreshSession = false;
  let initialMobileResumePending = false;
  // Silent-reattach state: on a WS close while we still have a liveSessionId,
  // we skip the connection-lost modal and try one quiet reconnect — the
  // daemon keeps the PTY alive across transient drops (portless teardown on
  // wake, brief network blip). If the reconnect's session frame has the same
  // id the shell survived and the user sees nothing; if the id differs the
  // shell was reaped while dormant and a fresh shell spawned (the session
  // handler resets the terminal and replays its scrollback). Cleared on
  // session landing or on a second close (silent reconnect failed). Stashed
  // close info is reused for the failed-reconnect modal so we don't lose the
  // original code/reason.
  let reattachPending = false;
  let reattachCloseCode = 0;
  let reattachCloseReason = "";
  // Whether the server paired this WS socket with a CDP target via the
  // `{type:"identify"}` handshake → the server will drive closeTab on a
  // clean shell exit, so the client defers window.close() to give the
  // CDP-driven close time to land. Reset whenever the socket changes; the
  // next identify acks with the up-to-date value over the new WS.
  let cdpControlled = false;

  return {
    beginManualReconnect: () => {
      initialMobileResumePending = false;
      // Reset the per-session "we're done" flags so a Reconnect after a shell
      // exit *or* a transport-level connection loss actually opens a fresh WS.
      // The server always spawns a new PTY on connect; the alternative ("must
      // open a new tab") loses the user's tab state for a recoverable failure.
      exited = false;
      wasEverConnected = false;
      cdpControlled = false;
      reattachPending = false;
      reattachCloseCode = 0;
      reattachCloseReason = "";
    },
    completeInitialMobileResume: (sessionId) => {
      if (!initialMobileResumePending) return false;
      initialMobileResumePending = false;
      if (sessionId) nextConnectSid = sessionId;
      return true;
    },
    getCdpControlled: () => cdpControlled,
    getExited: () => exited,
    handleConnectionClose: (closeCode, closeReason, wasClean) => {
      cdpControlled = false;
      if (exited) return { type: "ignore" };
      if (wasEverConnected) {
        // Silent-reattach attempt: the daemon keeps the PTY alive across
        // this drop, and on a successful reattach the user should see nothing
        // — mid-keystroke interactive CLIs continue uninterrupted. We stash
        // the close info and schedule a direct reconnect (bypassing the
        // connection-lost/modal path that fires `exited = true`). If the
        // silent reconnect itself closes before a session frame lands
        // (daemon genuinely down), fall through to markConnectionLost with
        // the stashed close info.
        if (liveSessionId && !reattachPending) {
          reattachPending = true;
          reattachCloseCode = closeCode;
          reattachCloseReason = closeReason;
          return { type: "reconnect" };
        }
        if (reattachPending) {
          const stashedCode = reattachCloseCode;
          const stashedReason = reattachCloseReason;
          reattachPending = false;
          reattachCloseCode = 0;
          reattachCloseReason = "";
          return {
            type: "connection-lost",
            closeCode: stashedCode,
            closeReason: stashedReason,
            wasClean,
          };
        }
        return { type: "connection-lost", closeCode, closeReason, wasClean };
      }
      return { type: "retry" };
    },
    handleSession: (sessionId) => {
      const priorSessionId = liveSessionId;
      const didSpawnFreshSession = shouldSpawnFreshSession;
      shouldSpawnFreshSession = false;
      reattachPending = false;
      reattachCloseCode = 0;
      reattachCloseReason = "";
      if (sessionId) {
        if (priorSessionId !== null && sessionId !== priorSessionId) {
          previousSessionIdRef.current = priorSessionId;
        }
        liveSessionId = sessionId;
        liveSessionIdRef.current = sessionId;
        syncSessionIdQueryParam(sessionId);
      }
      return {
        isSwitch: didSpawnFreshSession || (priorSessionId !== null && sessionId !== priorSessionId),
        priorSessionId,
      };
    },
    markConnectionLost: () => {
      if (exited) return false;
      exited = true;
      return true;
    },
    markShellDead: () => {
      if (exited) return false;
      exited = true;
      // The PTY is gone — drop its id so a manual Reconnect spawns a fresh
      // shell instead of trying to reattach to the dead one, and clear the
      // address-bar ?sid= so a refresh here never targets the dead PTY.
      liveSessionId = null;
      liveSessionIdRef.current = null;
      syncSessionIdQueryParam(null);
      return true;
    },
    noteConnected: () => {
      wasEverConnected = true;
    },
    prepareConnection: () => {
      const connectSid = nextConnectSid;
      const shouldSpawnFresh = shouldSpawnFreshSession;
      nextConnectSid = null;
      return {
        sessionId: shouldSpawnFresh ? null : (connectSid ?? liveSessionId),
        shouldSpawnFreshSession: shouldSpawnFresh,
      };
    },
    requestFreshSession: () => {
      nextConnectSid = null;
      shouldSpawnFreshSession = true;
    },
    requestSessionSwitch: (sessionId) => {
      if (sessionId === liveSessionId) return false;
      nextConnectSid = sessionId;
      shouldSpawnFreshSession = false;
      return true;
    },
    setCdpControlled: (controlled) => {
      cdpControlled = controlled;
    },
    startInitialMobileResume: () => {
      initialMobileResumePending = true;
    },
  };
};
