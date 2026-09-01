import { afterEach, describe, expect, it } from "vite-plus/test";
import { CdpClient } from "../src/cdp/cdp-client.js";
import {
  CDP_SOCKET_CLOSED,
  CDP_SOCKET_OPEN,
  type CdpSocket,
  type CdpSocketEventType,
  type CdpSocketListener,
} from "../src/cdp/cdp-socket.js";
import { resetExtensionHub, setExtensionClient } from "../src/cdp/extension-hub.js";

class FakeRelay implements CdpSocket {
  readyState = CDP_SOCKET_OPEN;
  sent: string[] = [];
  private readonly listeners: Record<CdpSocketEventType, CdpSocketListener[]> = {
    message: [],
    close: [],
    error: [],
    open: [],
  };
  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as { id: number; method: string };
    const result =
      message.method === "Target.getTargets"
        ? { targetInfos: [] }
        : message.method === "Target.setDiscoverTargets"
          ? {}
          : {};
    queueMicrotask(() => {
      for (const listener of this.listeners.message) {
        listener({ data: JSON.stringify({ id: message.id, result }) });
      }
    });
  }
  close(): void {
    this.readyState = CDP_SOCKET_CLOSED;
    for (const listener of this.listeners.close) listener({});
  }
  addEventListener(type: CdpSocketEventType, listener: CdpSocketListener): void {
    this.listeners[type].push(listener);
  }
}

describe("CdpClient extension transport", () => {
  afterEach(() => {
    resetExtensionHub();
  });

  it("connect prefers a live extension socket over remote debugging", async () => {
    const relay = new FakeRelay();
    setExtensionClient(relay);
    const client = new CdpClient({
      detect: async () => {
        throw new Error("detect should not run when the extension is connected");
      },
      extensionWaitMs: 20,
    });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getTransport()).toBe("extension");
    const result = (await client.findTargetByUrl(() => true)) ?? null;
    expect(result).toBeNull();
    client.close();
  });

  it("connect falls back to detection when the extension is absent", async () => {
    const client = new CdpClient({
      detect: async () => [],
      extensionWaitMs: 20,
    });
    await expect(client.connect()).rejects.toThrow(/no debug-enabled Chromium browser detected/);
    expect(client.isConnected()).toBe(false);
  });
});
