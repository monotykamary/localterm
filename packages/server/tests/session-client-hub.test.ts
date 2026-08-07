import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { SESSION_PENDING_PROMOTE_TIMEOUT_MS } from "../src/constants.js";
import { SessionClientHub } from "../src/session-client-hub.js";
import type { ManagedSession } from "../src/session-manager.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";

describe("SessionClientHub Git coordinators", () => {
  it("attaches a returning tab to its live cwd instead of its original cwd", () => {
    const originalCwd = "/original-repo";
    const liveCwd = "/current-non-repo";
    const managed = {
      id: "session",
      owner: null,
      clients: new Set(),
      resizeOwner: null,
      session: {
        cwd: originalCwd,
        lastEmittedCwd: liveCwd,
        isExited: false,
      },
    } as unknown as ManagedSession;
    const socket: ClientSocket = { readyState: 1, send: () => {}, close: () => {} };
    const sendControl = () => {};
    const hub = new SessionClientHub({
      outputTransport: new SessionOutputTransport(sendControl),
      sendControl,
      pendingPromoteTimeoutMs: SESSION_PENDING_PROMOTE_TIMEOUT_MS,
      sessionFor: () => managed,
      cancelGrace: () => {},
      startGrace: () => {},
      onSessionActivity: () => {},
    });

    hub.attach(socket, managed.id);

    expect(hub.hasCoordinatorFor(liveCwd)).toBe(true);
    expect(hub.hasCoordinatorFor(originalCwd)).toBe(false);
    hub.detach(socket);
  });

  it("does not allocate a coordinator for a dirty signal without viewers", () => {
    const sendControl = () => {};
    const hub = new SessionClientHub({
      outputTransport: new SessionOutputTransport(sendControl),
      sendControl,
      pendingPromoteTimeoutMs: SESSION_PENDING_PROMOTE_TIMEOUT_MS,
      sessionFor: () => null,
      cancelGrace: () => {},
      startGrace: () => {},
      onSessionActivity: () => {},
    });

    hub.signalCoordinatorForCwd(os.tmpdir());

    expect(hub.hasCoordinatorFor(os.tmpdir())).toBe(false);
  });
});

describe("SessionClientHub focus reporting (mode 1004)", () => {
  const FOCUS_IN = "\x1b[I";
  const FOCUS_OUT = "\x1b[O";

  function makeManaged(reportingEnabled: { current: boolean }) {
    const written: string[] = [];
    const managed = {
      id: "focus-session",
      owner: null,
      clients: new Set(),
      resizeOwner: null,
      session: {
        cwd: "/app",
        lastEmittedCwd: "",
        isExited: false,
        get focusReportingEnabled() {
          return reportingEnabled.current;
        },
        write: (data: string) => {
          written.push(data);
        },
      },
    } as unknown as ManagedSession;
    return { managed, written };
  }

  function makeHubFor(managed: ManagedSession) {
    const sendControl = () => {};
    return new SessionClientHub({
      outputTransport: new SessionOutputTransport(sendControl),
      sendControl,
      pendingPromoteTimeoutMs: SESSION_PENDING_PROMOTE_TIMEOUT_MS,
      sessionFor: () => managed,
      cancelGrace: () => {},
      startGrace: () => {},
      onSessionActivity: () => {},
    });
  }

  const socket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} });

  it("injects CSI I on viewer focus only while the app enabled reporting", () => {
    const reporting = { current: true };
    const { managed, written } = makeManaged(reporting);
    const hub = makeHubFor(managed);
    const ws = socket();
    hub.attach(ws, managed.id);

    reporting.current = false;
    hub.setClientFocus(ws, true);
    expect(written).toEqual([]);

    reporting.current = true;
    hub.setClientFocus(ws, false);
    hub.setClientFocus(ws, true);
    expect(written).toEqual([FOCUS_IN]);
    hub.detach(ws);
  });

  it("injects CSI O when the last focused viewer blurs or detaches", () => {
    const reporting = { current: true };
    const { managed, written } = makeManaged(reporting);
    const hub = makeHubFor(managed);
    const ws = socket();
    hub.attach(ws, managed.id);
    hub.setClientFocus(ws, true);
    expect(written).toEqual([FOCUS_IN]);

    hub.setClientFocus(ws, false);
    expect(written).toEqual([FOCUS_IN, FOCUS_OUT]);

    hub.setClientFocus(ws, true);
    hub.detach(ws);
    expect(written).toEqual([FOCUS_IN, FOCUS_OUT, FOCUS_IN, FOCUS_OUT]);
  });

  it("keeps the focused signal while any attached viewer is focused", () => {
    const reporting = { current: true };
    const { managed, written } = makeManaged(reporting);
    const hub = makeHubFor(managed);
    const first = socket();
    const second = socket();
    hub.attach(first, managed.id);
    hub.attach(second, managed.id);

    hub.setClientFocus(first, true);
    hub.setClientFocus(second, true);
    expect(written).toEqual([FOCUS_IN]);

    hub.setClientFocus(first, false);
    expect(written).toEqual([FOCUS_IN]);

    hub.setClientFocus(second, false);
    expect(written).toEqual([FOCUS_IN, FOCUS_OUT]);
    hub.detach(first);
    hub.detach(second);
  });

  it("delivers the initial focus state when reporting turns on over a focused viewer", () => {
    const reporting = { current: false };
    const { managed, written } = makeManaged(reporting);
    const hub = makeHubFor(managed);
    const ws = socket();
    hub.attach(ws, managed.id);
    hub.setClientFocus(ws, true);
    expect(written).toEqual([]);

    reporting.current = true;
    hub.syncFocusReporting(managed);
    expect(written).toEqual([FOCUS_IN]);
    hub.detach(ws);
  });

  it("resets signal state when reporting is disabled, then re-signals on enable", () => {
    const reporting = { current: true };
    const { managed, written } = makeManaged(reporting);
    const hub = makeHubFor(managed);
    const ws = socket();
    hub.attach(ws, managed.id);
    hub.setClientFocus(ws, true);
    expect(written).toEqual([FOCUS_IN]);

    reporting.current = false;
    hub.syncFocusReporting(managed);
    reporting.current = true;
    hub.syncFocusReporting(managed);
    expect(written).toEqual([FOCUS_IN, FOCUS_IN]);
    hub.detach(ws);
  });
});
