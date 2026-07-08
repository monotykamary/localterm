import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { CdpClient } from "../src/cdp/cdp-client.js";
import type { DetectedBrowser } from "../src/cdp/detect-chromium.js";

type MockMode = "ok" | "error" | "silent";

type CreatedTab = { url: string; background: boolean };

type TargetInfo = { type: string; targetId: string; url: string };

type MockBrowser = {
  wsUrl: string;
  created: CreatedTab[];
  connections: number;
  /** targetIds torn down via Target.closeTarget. */
  closed: string[];
  /** targetIds that received a window.close() Runtime.evaluate. */
  windowClosed: string[];
  /** Highest number of close sequences (attach..closeTarget) overlapping. */
  maxCloseConcurrency: number;
  /** Set once Target.setDiscoverTargets has been received (connect × observe). */
  discoveredTargets: boolean;
  /** targetId → ambient tab token, captured from Page.addScriptToEvaluateOnNewDocument. */
  injectedTokens: Record<string, string>;
  /** Server-side push of a Target.targetCreated event to the connected socket. */
  emitTargetCreated: (targetInfo: TargetInfo) => void;
  /** Server-side push of a Target.targetDestroyed event to the connected socket. */
  emitTargetDestroyed: (targetId: string) => void;
  /** Terminate the active client socket without stopping the server — models a
   * dropped debug WS while the tab/targetId stays valid (sleep/wake, transient
   * error, heartbeat teardown). */
  dropConnection: () => void;
  close: () => Promise<void>;
};

const servers: MockBrowser[] = [];

/** A CDP-browser-level WS endpoint that answers the calls CdpClient makes. */
const startMockBrowser = async (
  mode: MockMode = "ok",
  options: { silenceProbe?: boolean; windowCloseDestroysTarget?: boolean } = {},
): Promise<MockBrowser> => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  let targetCounter = 0;
  // sessionId -> targetId, so a window.close() evaluate can be attributed.
  const sessionTargets = new Map<string, string>();
  // targetIds window.close() already destroyed (when windowCloseDestroysTarget
  // is set) so a follow-up Target.closeTarget errors "No target with given id
  // found" — the real-browser path where window.close() does the actual close.
  const closedByWindow = new Set<string>();
  let closeInFlight = 0;
  // Active client socket — captured on each connect so emit* helpers can push
  // unsolicited Target events to the CdpClient the way a real browser does
  // when a new page opens.
  let activeSocket: WebSocket | null = null;
  const browser: MockBrowser = {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/mock`,
    created: [],
    connections: 0,
    closed: [],
    windowClosed: [],
    maxCloseConcurrency: 0,
    discoveredTargets: false,
    injectedTokens: {},
    emitTargetCreated: (targetInfo) => {
      activeSocket?.send(
        JSON.stringify({ method: "Target.targetCreated", params: { targetInfo } }),
      );
    },
    emitTargetDestroyed: (targetId) => {
      activeSocket?.send(
        JSON.stringify({ method: "Target.targetDestroyed", params: { targetId } }),
      );
    },
    dropConnection: () => {
      // Terminate the CdpClient's socket the way a sleep/wake or transient WS
      // error does — the server stays up so a reconnect lands on the same
      // browser with the same targetId space.
      if (activeSocket) {
        activeSocket.terminate();
        activeSocket = null;
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };

  wss.on("connection", (socket) => {
    activeSocket = socket;
    browser.connections++;
    socket.on("message", (raw: RawData) => {
      const message = JSON.parse(String(raw)) as {
        id: number;
        method: string;
        sessionId?: string;
        params?: {
          url?: string;
          background?: boolean;
          targetId?: string;
          expression?: string;
          discover?: boolean;
          source?: string;
        };
      };
      const reply = (result: unknown) => socket.send(JSON.stringify({ id: message.id, result }));

      if (message.method === "Target.createTarget") {
        if (mode === "silent") return;
        if (mode === "error") {
          socket.send(
            JSON.stringify({ id: message.id, error: { code: -32000, message: "denied" } }),
          );
          return;
        }
        const targetId = `target-${++targetCounter}`;
        browser.created.push({
          url: message.params?.url ?? "",
          background: message.params?.background ?? false,
        });
        reply({ targetId });
        return;
      }
      if (message.method === "Target.attachToTarget") {
        // A close sequence (attach..closeTarget) just began.
        closeInFlight++;
        browser.maxCloseConcurrency = Math.max(browser.maxCloseConcurrency, closeInFlight);
        const targetId = message.params?.targetId ?? "";
        const sessionId = `session-${targetId}`;
        sessionTargets.set(sessionId, targetId);
        reply({ sessionId });
        return;
      }
      if (message.method === "Runtime.evaluate") {
        const targetId = message.sessionId ? sessionTargets.get(message.sessionId) : undefined;
        if (targetId && message.params?.expression === "window.close()") {
          browser.windowClosed.push(targetId);
          if (options.windowCloseDestroysTarget) closedByWindow.add(targetId);
        }
        reply({ result: { type: "undefined" } });
        return;
      }
      if (message.method === "Target.closeTarget") {
        const targetId = message.params?.targetId;
        closeInFlight--;
        if (targetId && closedByWindow.has(targetId)) {
          // window.close() already destroyed the target — mirror a real
          // browser returning "No target with given id found" (the closeTab
          // path where window.close() did the actual close).
          socket.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: "No target with given id found" },
            }),
          );
          return;
        }
        if (targetId) browser.closed.push(targetId);
        reply({ success: true });
        return;
      }
      if (message.method === "Target.setDiscoverTargets") {
        browser.discoveredTargets = true;
        reply({});
        return;
      }
      if (message.method === "Target.getTargets") {
        // Heartbeat liveness probe. `silenceProbe` simulates a half-open
        // socket (OPEN but never replies) so the keepalive's probe times out
        // and tears the socket down instead of stalling a real call.
        if (!options.silenceProbe) reply({ targetInfos: [] });
        return;
      }
      if (message.method === "Page.enable") {
        reply({});
        return;
      }
      if (message.method === "Page.addScriptToEvaluateOnNewDocument") {
        const targetId = message.sessionId ? sessionTargets.get(message.sessionId) : undefined;
        // Pull the token out of the injected expression the CdpClient sends:
        //   window["__LOCALTERM_TAB_TOKEN"]="<token>";window.dispatchEvent(...)
        // Captured so a test can drive findTargetIdForToken with the actual
        // token the page would have echoed on its WS.
        const match = /window\["__LOCALTERM_TAB_TOKEN"\]="([^"]+)"/.exec(
          message.params?.source ?? "",
        );
        if (targetId && match) browser.injectedTokens[targetId] = match[1];
        reply({ identifier: 1 });
        return;
      }
    });
  });

  servers.push(browser);
  return browser;
};

const detected = (wsUrl: string, mtimeMs = 0): DetectedBrowser => ({
  name: "Mock",
  profileDir: "/tmp/mock",
  port: 0,
  wsPath: "/devtools/browser/mock",
  wsUrl,
  mtimeMs,
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("CdpClient.openBackgroundTab", { tags: ["integration"] }, () => {
  it("creates the tab with background:true and resolves the target id", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    const handle = await client.openBackgroundTab("http://localterm.localhost/?run=abc");
    expect(handle).toBe("target-1");
    expect(browser.created).toEqual([
      { url: "http://localterm.localhost/?run=abc", background: true },
    ]);
    client.close();
  });

  it("reuses one persistent connection across runs", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    await client.openBackgroundTab("http://x/?run=1");
    await client.openBackgroundTab("http://x/?run=2");
    await client.openBackgroundTab("http://x/?run=3");
    expect(browser.created).toHaveLength(3);
    // A single WebSocket connection served all three runs.
    expect(browser.connections).toBe(1);
    client.close();
  });

  it("returns null on a CDP error reply", async () => {
    const browser = await startMockBrowser("error");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBeNull();
    // A CDP denial is a reply on a healthy socket — no reconnect, no second WS
    // upgrade (which would re-fire the browser's remote-debugging prompt).
    expect(browser.connections).toBe(1);
    client.close();
  });

  it("returns null when no browser is detected", async () => {
    const client = new CdpClient({ detect: async () => [] });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBeNull();
  });

  it("returns null (never throws) when detection fails", async () => {
    const client = new CdpClient({
      detect: async () => {
        throw new Error("boom");
      },
    });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBeNull();
  });

  it("falls through to the next detected browser when the first refuses", async () => {
    const live = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [
        detected("ws://127.0.0.1:1/devtools/browser/dead", 100),
        detected(live.wsUrl, 50),
      ],
      connectTimeoutMs: 500,
    });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBe("target-1");
    expect(live.created).toHaveLength(1);
    client.close();
  });

  it("reconnects after the browser drops the socket", async () => {
    const first = await startMockBrowser("ok");
    let current = first;
    const client = new CdpClient({
      detect: async () => [detected(current.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });

    expect(await client.openBackgroundTab("http://x/?run=1")).toBe("target-1");
    expect(client.isConnected()).toBe(true);

    // Browser quits: close its endpoint, then a fresh one comes up on a new port.
    await first.close();
    const second = await startMockBrowser("ok");
    current = second;

    expect(await client.openBackgroundTab("http://x/?run=2")).toBe("target-1");
    expect(second.created).toEqual([{ url: "http://x/?run=2", background: true }]);
    client.close();
  });
});

describe("CdpClient.closeTab", { tags: ["integration"] }, () => {
  it("drives window.close() then Target.closeTarget for the tab", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");

    await client.closeTab(handle as string);
    expect(browser.windowClosed).toEqual(["target-1"]);
    expect(browser.closed).toEqual(["target-1"]);
    client.close();
  });

  it("is a no-op when not connected (never throws)", async () => {
    const client = new CdpClient({ detect: async () => [] });
    await expect(client.closeTab("target-x")).resolves.toBeUndefined();
  });

  it("reuses the persistent connection (open + close on one socket)", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    const handle = await client.openBackgroundTab("http://x/?run=1");
    await client.closeTab(handle as string);
    expect(browser.connections).toBe(1);
    client.close();
  });

  it("serializes concurrent closes so they never interleave (no orphaned tabs)", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    const handles = await Promise.all(
      [1, 2, 3, 4].map((n) => client.openBackgroundTab(`http://x/?run=${n}`)),
    );
    // Fire all four closes at once — without serialization their attach/
    // closeTarget steps would overlap on the shared socket.
    await Promise.all(handles.map((handle) => client.closeTab(handle as string)));
    expect(browser.closed.sort()).toEqual(["target-1", "target-2", "target-3", "target-4"]);
    expect(browser.maxCloseConcurrency).toBe(1);
    client.close();
  });

  it("reconnects after the socket drops and still closes the tab", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");
    expect(client.isConnected()).toBe(true);

    // The persistent debug WS drops (sleep/wake, transient error, heartbeat
    // teardown) while the tab/targetId stays valid — the exact Ctrl+D case that
    // orphaned tabs before the fix (closeTab bailed on !isConnected).
    browser.dropConnection();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.isConnected()).toBe(false);

    await client.closeTab("target-1");
    expect(browser.windowClosed).toEqual(["target-1"]);
    expect(browser.closed).toEqual(["target-1"]);
    // One connection for the open, a second for the close-time reconnect.
    expect(browser.connections).toBe(2);
    client.close();
  });

  it("keeps the persistent socket when closeTarget reports the tab already closed", async () => {
    // Real browsers close the tab via window.close(); the follow-up
    // Target.closeTarget then errors "No target with given id found" while the
    // debug WS stays perfectly healthy. Tearing down on that reply drops the one
    // socket kept for the daemon's lifetime — and the forced reconnect re-fires
    // the browser's remote-debugging consent dialog on every close (i.e. every
    // automation run). closeTab must swallow the reply, not reconnect.
    const browser = await startMockBrowser("ok", { windowCloseDestroysTarget: true });
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");
    expect(browser.connections).toBe(1);

    await client.closeTab("target-1");
    // window.close() ran (the real close); closeTarget was attempted but the
    // tab was already gone, so it errored and recorded no close.
    expect(browser.windowClosed).toEqual(["target-1"]);
    expect(browser.closed).toEqual([]);
    // The persistent socket stayed up — no second WS upgrade, no re-prompt.
    expect(client.isConnected()).toBe(true);
    expect(browser.connections).toBe(1);
    client.close();
  });
});

const relaxForObserve = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("CdpClient ambient tab observation", { tags: ["integration"] }, () => {
  it("sends Target.setDiscoverTargets once on connect", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    await client.connect();
    // observeTargets is fire-and-forget; give the setDiscoverTargets
    // round-trip a tick to land before the assertion.
    await relaxForObserve();
    expect(browser.discoveredTargets).toBe(true);
    client.close();
  });

  it("injects an ambient token for a page target on our origin and resolves it via findTargetIdForToken", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      tabUrlFilter: () => true,
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    await client.connect();
    await relaxForObserve();
    expect(browser.discoveredTargets).toBe(true);

    browser.emitTargetCreated({ type: "page", targetId: "page-1", url: "http://x/" });
    // injectToken round-trips attach → Page.enable → addScript → Runtime.evaluate.
    await relaxForObserve();

    const token = browser.injectedTokens["page-1"];
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(client.findTargetIdForToken(token)).toBe("page-1");
    client.close();
  });

  it("does not inject a token for a target the filter rejects", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      tabUrlFilter: () => false,
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    await client.connect();
    await relaxForObserve();

    browser.emitTargetCreated({
      type: "page",
      targetId: "off-origin",
      url: "https://example.com/",
    });
    await relaxForObserve();

    expect(browser.injectedTokens["off-origin"]).toBeUndefined();
    client.close();
  });

  it("clears targetId↔token maps on Target.targetDestroyed", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      tabUrlFilter: () => true,
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
    });
    await client.connect();
    await relaxForObserve();

    browser.emitTargetCreated({ type: "page", targetId: "page-1", url: "http://x/" });
    await relaxForObserve();
    const token = browser.injectedTokens["page-1"];
    expect(client.findTargetIdForToken(token)).toBe("page-1");

    browser.emitTargetDestroyed("page-1");
    await relaxForObserve();
    expect(client.findTargetIdForToken(token)).toBeUndefined();
    client.close();
  });
});

describe("CdpClient keepalive (wake-from-sleep)", { tags: ["integration"] }, () => {
  it("tears down a half-open socket when the liveness probe goes unanswered, then reconnects", async () => {
    // silenceProbe: the WebSocket stays OPEN but never replies to the keepalive's
    // Target.getTargets probe — the same shape as a loopback socket that went
    // stale across an OS sleep without an explicit close/error event.
    const browser = await startMockBrowser("ok", { silenceProbe: true });
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 50,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 1,
    });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(browser.connections).toBe(1);

    // Wait past the probe's call timeout so the keepalive tears the socket
    // down proactively, rather than the next real call stalling on it.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(client.isConnected()).toBe(false);

    // The next run reconnects on a fresh socket instead of wedging
    // Target.createTarget against the dead one.
    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");
    expect(browser.connections).toBe(2);
    client.close();
  });

  it("reuses a live socket across a quiet window (probe succeeds, no reopen)", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({
      detect: async () => [detected(browser.wsUrl)],
      connectTimeoutMs: 500,
      callTimeoutMs: 500,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 1,
    });
    await client.connect();
    const connectionsBefore = browser.connections;

    // A quiet window elapses; the keepalive probes Target.getTargets. A live
    // socket replies (resetting lastReplyAt via onMessage) and is reused — no
    // teardown, no fresh socket, so no re-trigger of the browser's debugging
    // prompt. This is the wake-from-sleep recovery path.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(client.isConnected()).toBe(true);
    expect(browser.connections).toBe(connectionsBefore);

    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");
    expect(browser.connections).toBe(connectionsBefore);
    client.close();
  });
});

describe("CdpClient.resetConnection", { tags: ["integration"] }, () => {
  it("drops the live socket so the next open reconnects on a fresh socket", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(browser.connections).toBe(1);

    client.resetConnection("port reconfigured");
    expect(client.isConnected()).toBe(false);

    // The next run re-runs detection and opens a second socket — the path a
    // `PUT /api/config` port change takes so the new endpoint is used.
    const handle = await client.openBackgroundTab("http://x/?run=1");
    expect(handle).toBe("target-1");
    expect(browser.connections).toBe(2);
    client.close();
  });

  it("is a no-op when already disconnected", () => {
    const client = new CdpClient({ detect: async () => [] });
    expect(() => client.resetConnection()).not.toThrow();
    expect(client.isConnected()).toBe(false);
    client.close();
  });
});
