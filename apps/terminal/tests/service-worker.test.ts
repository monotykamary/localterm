import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

interface ServiceWorkerEvent {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface MockWindowClient {
  focus: ReturnType<typeof vi.fn>;
  id: string;
  postMessage: ReturnType<typeof vi.fn>;
  url: string;
}

const loadServiceWorkerListeners = (
  clients: MockWindowClient[],
): Map<string, (event: unknown) => void> => {
  const listeners = new Map<string, (event: unknown) => void>();
  const source = readFileSync(path.resolve("scripts/sw-template.js"), "utf8")
    .replace('"__SW_VERSION__"', '"test"')
    .replace("__PRECACHE_URLS_JSON__", '"[]"');
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const serviceWorker = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    clients: {
      get: (clientId: string) => Promise.resolve(clientById.get(clientId)),
      matchAll: () => Promise.resolve(clients),
      openWindow: vi.fn(),
    },
    location: { origin: "https://localterm.localhost" },
    registration: { showNotification: vi.fn() },
  };
  vm.runInNewContext(source, {
    URL,
    caches: {},
    fetch: vi.fn(),
    self: serviceWorker,
  });
  return listeners;
};

const requireListener = (
  listeners: Map<string, (event: unknown) => void>,
  type: string,
): ((event: unknown) => void) => {
  const listener = listeners.get(type);
  if (!listener) throw new Error(`Missing ${type} listener`);
  return listener;
};

describe("service worker notification routing", () => {
  it("focuses and restores the source tab when it switched sessions before the click", async () => {
    const wrongTab: MockWindowClient = {
      focus: vi.fn(() => Promise.resolve()),
      id: "wrong-tab",
      postMessage: vi.fn(),
      url: "https://localterm.localhost/?sid=other-session",
    };
    const sourceTab: MockWindowClient = {
      focus: vi.fn(() => Promise.resolve()),
      id: "source-tab",
      postMessage: vi.fn(),
      url: "https://localterm.localhost/?sid=new-session",
    };
    const listeners = loadServiceWorkerListeners([wrongTab, sourceTab]);
    let clickWork: Promise<unknown> | undefined;
    const event: ServiceWorkerEvent & {
      notification: { close: ReturnType<typeof vi.fn>; data: object };
    } = {
      notification: {
        close: vi.fn(),
        data: {
          sid: "emitting-session",
          hasViewers: true,
          sourceClientId: sourceTab.id,
        },
      },
      waitUntil: (promise) => {
        clickWork = promise;
      },
    };

    requireListener(listeners, "notificationclick")(event);
    await clickWork;

    expect(sourceTab.focus).toHaveBeenCalledOnce();
    expect(sourceTab.postMessage).toHaveBeenCalledWith({
      type: "focus-session",
      sid: "emitting-session",
    });
    expect(wrongTab.focus).not.toHaveBeenCalled();
  });
});
