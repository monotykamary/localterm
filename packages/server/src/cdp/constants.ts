export const CDP_WEBSOCKET_CONNECTING_STATE = 0; // WebSocket.CONNECTING
export const CDP_WEBSOCKET_OPEN_STATE = 1; // WebSocket.OPEN
export const DEFAULT_CDP_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_CDP_CALL_TIMEOUT_MS = 5_000;
// Give the browser a beat to process window.close() before tearing down the
// CDP target — some Chromium forks (Dia, Arc) leave the tab in the strip
// otherwise (see browser-harness-js closeTab).
export const CDP_CLOSE_SETTLE_MS = 100;
