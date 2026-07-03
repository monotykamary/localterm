/**
 * Prompt-free liveness check for detected CDP candidates.
 *
 * `detectChromiumBrowsers` only confirms a `DevToolsActivePort` file exists —
 * a crashed or force-quit browser leaves that file behind, so the file scan
 * reports a browser that isn't actually running (the stale Dia file bug). This
 * probe reuses `CdpClient.establish`'s "verify by actually connecting to the
 * candidate" approach — first candidate (most-recent first) that is reachable
 * wins — but at the TCP layer, not the WebSocket layer, for one specific
 * reason: the banner must stay prompt-free.
 *
 * Browsers like Chrome 144+, Dia, and Aside gate the DevTools endpoint behind a
 * remote-debugging consent dialog that fires on the WS/HTTP upgrade. The
 * daemon's `CdpClient` pays that prompt once and keeps the socket (by design —
 * see its header). A banner probe that opened a WS would fire the prompt too,
 * then close before the user could approve, racing the daemon and stacking
 * prompts. A bare TCP `connect` sends no HTTP/WS bytes, so the browser's
 * DevTools HTTP handler never runs and no consent dialog appears. It still
 * cleanly separates the two cases: a stale file points at a port nothing is
 * listening on (ECONNREFUSED, near-instant) and a live browser has bound its
 * debug port (TCP `connect` succeeds). The daemon's `establish()` still does
 * the real WS handshake + prompt afterward.
 */
import { createConnection } from "node:net";

import { CDP_LIVENESS_PROBE_TIMEOUT_MS } from "../constants.js";
import type { DetectedBrowser } from "./detect-chromium.js";

export interface ProbeCdpLivenessOptions {
  /** Per-candidate TCP-connect deadline. */
  timeoutMs?: number;
  /**
   * Override the per-candidate reachability probe (tests). Returns true when
   * the candidate's debug port accepts a connection within the deadline.
   * Defaults to a bare TCP `connect` to 127.0.0.1.
   */
  isLive?: (candidate: DetectedBrowser, timeoutMs: number) => Promise<boolean>;
}

/**
 * Return the first candidate (in the order given — most-recently-launched
 * first from the file scan, explicit-port candidate first when configured)
 * whose debug port accepts a TCP connection within the timeout, or
 * `undefined` when none do. The probe socket is destroyed immediately on
 * success so nothing is held open and no bytes are sent.
 */
export const probeCdpLiveness = async (
  candidates: DetectedBrowser[],
  options: ProbeCdpLivenessOptions = {},
): Promise<DetectedBrowser | undefined> => {
  const timeoutMs = options.timeoutMs ?? CDP_LIVENESS_PROBE_TIMEOUT_MS;
  const isLive = options.isLive ?? defaultIsLive;
  for (const candidate of candidates) {
    if (await isLive(candidate, timeoutMs)) return candidate;
  }
  return undefined;
};

/**
 * Bare TCP `connect` to the candidate's debug port: resolve `true` on
 * `connect`, `false` on `error`/timeout — destroying the socket immediately in
 * either case so no bytes are sent and no DevTools consent dialog is fired. A
 * stale `DevToolsActivePort` file (nothing listening) fails near-instantly via
 * ECONNREFUSED; a live browser has bound the port and the connect completes.
 */
const defaultIsLive = (candidate: DetectedBrowser, timeoutMs: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = createConnection({ host: "127.0.0.1", port: candidate.port });
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
