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
