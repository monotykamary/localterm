import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { type RawData, WebSocketServer } from "ws";
import { CdpClient } from "../src/cdp/cdp-client.js";
import type { DetectedBrowser } from "../src/cdp/detect-chromium.js";

type MockMode = "ok" | "error" | "silent";

type CreatedTab = { url: string; background: boolean };

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
  close: () => Promise<void>;
};

const servers: MockBrowser[] = [];

/** A CDP-browser-level WS endpoint that answers the calls CdpClient makes. */
const startMockBrowser = async (mode: MockMode = "ok"): Promise<MockBrowser> => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  let targetCounter = 0;
  // sessionId -> targetId, so a window.close() evaluate can be attributed.
  const sessionTargets = new Map<string, string>();
  let closeInFlight = 0;
  const browser: MockBrowser = {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/mock`,
    created: [],
    connections: 0,
    closed: [],
    windowClosed: [],
    maxCloseConcurrency: 0,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };

  wss.on("connection", (socket) => {
    browser.connections++;
    socket.on("message", (raw: RawData) => {
      const message = JSON.parse(String(raw)) as {
        id: number;
        method: string;
        sessionId?: string;
        params?: { url?: string; background?: boolean; targetId?: string; expression?: string };
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
        }
        reply({ result: { type: "undefined" } });
        return;
      }
      if (message.method === "Target.closeTarget") {
        if (message.params?.targetId) browser.closed.push(message.params.targetId);
        closeInFlight--;
        reply({ success: true });
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

describe("CdpClient.openBackgroundTab", () => {
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

describe("CdpClient.closeTab", () => {
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
});
