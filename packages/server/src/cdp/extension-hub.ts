import { CDP_SOCKET_OPEN, type CdpSocket } from "./cdp-socket.js";

interface Waiter {
  resolve: (socket: CdpSocket) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let client: CdpSocket | undefined;
let waiters: Waiter[] = [];

export const setExtensionClient = (socket: CdpSocket): void => {
  if (client && client !== socket) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  client = socket;
  const ready = waiters.splice(0);
  for (const waiter of ready) {
    clearTimeout(waiter.timer);
    waiter.resolve(socket);
  }
  socket.addEventListener("close", () => {
    if (client === socket) client = undefined;
  });
};

export const getExtensionClient = (): CdpSocket | undefined =>
  client && client.readyState === CDP_SOCKET_OPEN ? client : undefined;

export const extensionConnected = (): boolean => getExtensionClient() !== undefined;

export const waitForExtension = (timeoutMs: number): Promise<CdpSocket> => {
  const existing = getExtensionClient();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        waiters = waiters.filter((entry) => entry !== waiter);
        reject(
          new Error(`timed out after ${timeoutMs}ms waiting for the localterm Chrome extension`),
        );
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
};

export const resetExtensionHub = (): void => {
  const prev = client;
  client = undefined;
  const ready = waiters.splice(0);
  for (const waiter of ready) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("extension hub reset"));
  }
  if (prev) {
    try {
      prev.close();
    } catch {
      /* ignore */
    }
  }
};
