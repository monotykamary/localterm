import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { showServiceWorkerNotification } from "../../src/utils/show-service-worker-notification";

interface MockServiceWorkerContainer {
  controller: { postMessage: (message: unknown) => void } | null;
}

const originalServiceWorker = navigator.serviceWorker;

const setServiceWorker = (serviceWorker: MockServiceWorkerContainer): void => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
};

describe("showServiceWorkerNotification", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("asks the controlling service worker to show a session notification", () => {
    const postMessage = vi.fn();
    setServiceWorker({ controller: { postMessage } });

    expect(
      showServiceWorkerNotification({
        body: "Agent finished",
        hasViewers: true,
        sessionId: "session-one",
        tag: "localterm:session-one",
        title: "localterm",
      }),
    ).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "show-session-notification",
      body: "Agent finished",
      hasViewers: true,
      sessionId: "session-one",
      tag: "localterm:session-one",
      title: "localterm",
    });
  });

  it("reports that the page-owned fallback is needed without a controller", () => {
    setServiceWorker({ controller: null });

    expect(
      showServiceWorkerNotification({
        body: "Agent finished",
        hasViewers: false,
        sessionId: "session-one",
        tag: "localterm:session-one",
        title: "localterm",
      }),
    ).toBe(false);
  });
});
