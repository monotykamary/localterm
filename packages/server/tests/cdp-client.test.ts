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
  close: () => Promise<void>;
};

const servers: MockBrowser[] = [];

/** A CDP-browser-level WS endpoint that answers Target.createTarget. */
const startMockBrowser = async (mode: MockMode = "ok"): Promise<MockBrowser> => {
  const created: CreatedTab[] = [];
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  const browser: MockBrowser = {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/mock`,
    created,
    connections: 0,
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
        params?: { url?: string; background?: boolean };
      };
      if (message.method !== "Target.createTarget") return;
      if (mode === "silent") return;
      if (mode === "error") {
        socket.send(JSON.stringify({ id: message.id, error: { code: -32000, message: "denied" } }));
        return;
      }
      created.push({
        url: message.params?.url ?? "",
        background: message.params?.background ?? false,
      });
      socket.send(JSON.stringify({ id: message.id, result: { targetId: "target-1" } }));
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
  it("creates the tab with background:true and resolves true", async () => {
    const browser = await startMockBrowser("ok");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    const ok = await client.openBackgroundTab("http://localterm.localhost/?run=abc");
    expect(ok).toBe(true);
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

  it("returns false on a CDP error reply", async () => {
    const browser = await startMockBrowser("error");
    const client = new CdpClient({ detect: async () => [detected(browser.wsUrl)] });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBe(false);
    client.close();
  });

  it("returns false when no browser is detected", async () => {
    const client = new CdpClient({ detect: async () => [] });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBe(false);
  });

  it("returns false (never throws) when detection fails", async () => {
    const client = new CdpClient({
      detect: async () => {
        throw new Error("boom");
      },
    });
    expect(await client.openBackgroundTab("http://x/?run=1")).toBe(false);
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
    expect(await client.openBackgroundTab("http://x/?run=1")).toBe(true);
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

    expect(await client.openBackgroundTab("http://x/?run=1")).toBe(true);
    expect(client.isConnected()).toBe(true);

    // Browser quits: close its endpoint, then a fresh one comes up on a new port.
    await first.close();
    const second = await startMockBrowser("ok");
    current = second;

    expect(await client.openBackgroundTab("http://x/?run=2")).toBe(true);
    expect(second.created).toEqual([{ url: "http://x/?run=2", background: true }]);
    client.close();
  });
});
