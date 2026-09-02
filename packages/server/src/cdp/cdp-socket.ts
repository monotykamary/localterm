export type CdpSocketEventType = "message" | "close" | "error" | "open";

interface CdpSocketEvent {
  data?: unknown;
}

export type CdpSocketListener = (event: CdpSocketEvent) => void;

/** Send/close/listen surface shared by Chrome's debug WS and the inbound extension relay. */
export interface CdpSocket {
  readonly readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: CdpSocketEventType, listener: CdpSocketListener) => void;
}

export interface InboundCdpSocket extends CdpSocket {
  ingest: (raw: string) => void;
  ingestClose: () => void;
}

interface ClientSend {
  readyState: number;
  send: (raw: string) => void;
  close: () => void;
}

const CDP_SOCKET_OPEN = 1;
const CDP_SOCKET_CLOSED = 3;

/** Adapter for a Hono WSContext: the route feeds frames via ingest/ingestClose. */
export const createInboundCdpSocket = (client: ClientSend): InboundCdpSocket => {
  const listeners: Record<CdpSocketEventType, CdpSocketListener[]> = {
    message: [],
    close: [],
    error: [],
    open: [],
  };
  let readyState = client.readyState === CDP_SOCKET_OPEN ? CDP_SOCKET_OPEN : client.readyState;
  const emit = (type: CdpSocketEventType, event: CdpSocketEvent): void => {
    for (const listener of listeners[type]) listener(event);
  };
  return {
    get readyState() {
      return readyState;
    },
    send(data: string) {
      if (readyState !== CDP_SOCKET_OPEN) return;
      client.send(data);
    },
    close() {
      client.close();
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    ingest(raw: string) {
      if (readyState !== CDP_SOCKET_OPEN) return;
      emit("message", { data: raw });
    },
    ingestClose() {
      if (readyState === CDP_SOCKET_CLOSED) return;
      readyState = CDP_SOCKET_CLOSED;
      emit("close", {});
    },
  };
};

export { CDP_SOCKET_CLOSED, CDP_SOCKET_OPEN };
