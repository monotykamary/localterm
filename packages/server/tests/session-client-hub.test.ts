import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { SESSION_PENDING_PROMOTE_TIMEOUT_MS } from "../src/constants.js";
import { SessionClientHub } from "../src/session-client-hub.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";

describe("SessionClientHub Git coordinators", () => {
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
