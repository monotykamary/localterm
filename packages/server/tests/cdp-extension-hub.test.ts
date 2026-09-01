import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  CDP_SOCKET_CLOSED,
  CDP_SOCKET_OPEN,
  createInboundCdpSocket,
  type CdpSocket,
  type CdpSocketEventType,
  type CdpSocketListener,
} from "../src/cdp/cdp-socket.js";
import {
  extensionConnected,
  getExtensionClient,
  resetExtensionHub,
  setExtensionClient,
  waitForExtension,
} from "../src/cdp/extension-hub.js";

class FakeSocket implements CdpSocket {
  readyState = CDP_SOCKET_OPEN;
  private readonly listeners: Record<CdpSocketEventType, CdpSocketListener[]> = {
    message: [],
    close: [],
    error: [],
    open: [],
  };
  send(_data: string): void {}
  close(): void {
    this.readyState = CDP_SOCKET_CLOSED;
    for (const listener of this.listeners.close) listener({});
  }
  addEventListener(type: CdpSocketEventType, listener: CdpSocketListener): void {
    this.listeners[type].push(listener);
  }
}

describe("extension hub", () => {
  afterEach(() => {
    resetExtensionHub();
  });

  it("resolves waitForExtension immediately when a client is already up", async () => {
    const socket = new FakeSocket();
    setExtensionClient(socket);
    expect(extensionConnected()).toBe(true);
    await expect(waitForExtension(10)).resolves.toBe(socket);
    expect(getExtensionClient()).toBe(socket);
  });

  it("resolves waitForExtension when the client connects later", async () => {
    const pending = waitForExtension(200);
    const socket = new FakeSocket();
    setExtensionClient(socket);
    await expect(pending).resolves.toBe(socket);
  });

  it("times out when nothing connects", async () => {
    await expect(waitForExtension(20)).rejects.toThrow(/timed out after 20ms/);
  });

  it("drops a closed client", () => {
    const socket = new FakeSocket();
    setExtensionClient(socket);
    socket.close();
    expect(getExtensionClient()).toBeUndefined();
    expect(extensionConnected()).toBe(false);
  });

  it("ingest on an inbound socket delivers a message", () => {
    const sent: string[] = [];
    const inbound = createInboundCdpSocket({
      readyState: CDP_SOCKET_OPEN,
      send: (raw) => {
        sent.push(raw);
      },
      close: () => {},
    });
    let received = "";
    inbound.addEventListener("message", (event) => {
      received = String(event.data ?? "");
    });
    inbound.ingest("hello");
    inbound.send("out");
    expect(received).toBe("hello");
    expect(sent).toEqual(["out"]);
  });
});
