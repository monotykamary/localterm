// Minimal view of a client WebSocket the session manager and route layer share.
// Matches Hono's WSContext shape (the `ws` from onOpen) closely
// enough to call send/close and read the underlying socket's buffered amount
// for flow control, without taking a hard dependency on that package's types.
export interface ClientSocket {
  readyState: number;
  send: (raw: string | ArrayBuffer | Uint8Array<ArrayBuffer>) => void;
  close: (code?: number, reason?: string) => void;
  raw?: unknown;
}

// Bytes queued in the underlying socket's send buffer. The manager uses this to
// pause a session's PTY when any attached client falls behind (OS pipe
// backpressure stops the child producing more) instead of dropping the socket.
export const getBufferedAmount = (ws: ClientSocket): number => {
  const raw = ws.raw;
  if (!raw || typeof raw !== "object") return 0;
  const candidate = Reflect.get(raw, "bufferedAmount");
  return typeof candidate === "number" ? candidate : 0;
};
