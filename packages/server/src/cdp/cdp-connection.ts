import { dismissDiaAllowPrompt } from "../utils/dismiss-dia-allow-prompt.js";
import {
  CDP_AUTO_ALLOW_DELAY_MS,
  CDP_HEARTBEAT_GRACE_MS,
  CDP_HEARTBEAT_INTERVAL_MS,
  CDP_HEARTBEAT_TIMEOUT_MS,
} from "../constants.js";
import {
  CDP_WEBSOCKET_CONNECTING_STATE,
  CDP_WEBSOCKET_OPEN_STATE,
  DEFAULT_CDP_CALL_TIMEOUT_MS,
  DEFAULT_CDP_CONNECT_TIMEOUT_MS,
} from "./constants.js";

// Cheap browser-level CDP round-trip used as a transport liveness probe by the
// keepalive: no session, no side effects, minimal reply.
const CDP_HEARTBEAT_PROBE_METHOD = "Target.getTargets";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface CdpConnectionOptions {
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  heartbeatGraceMs?: number;
  autoAllow?: boolean;
  autoAllowDelayMs?: number;
  dismissDiaAllowPrompt?: () => void;
  platform?: NodeJS.Platform;
  onDisconnect?: () => void;
}

/** A CDP error *reply* — the browser answered a call with an error result (e.g.
 * "No target with given id found"), as opposed to a transport drop or a call
 * timeout. A reply leaves the persistent socket healthy, so the open/close
 * teardown paths must NOT tear it down on a reply: that would drop the one
 * socket kept for the daemon's lifetime and force a reconnect, which re-fires
 * the browser's remote-debugging consent dialog on every automation run. */
export class CdpReplyError extends Error {}

export class CdpConnection {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatGraceMs: number;
  private readonly autoAllow: boolean;
  private readonly autoAllowDelayMs: number;
  private readonly dismissDiaAllowPrompt: () => void;
  private readonly platform: NodeJS.Platform;
  private readonly onDisconnect: () => void;
  /** Timestamp of the last inbound CDP frame (reply or event). */
  private lastReplyAt = 0;
  /** Background keepalive timer; unref'd so it never blocks daemon shutdown. */
  private heartbeatTimer: NodeJS.Timeout | undefined;
  // Event routing. CDP delivers events as `{ method, params, sessionId? }`
  // with no `id`; browser-level events (Target.targetCreated etc.) have no
  // sessionId, session-scoped events carry theirs. We key by
  // `${sessionId ?? ""}:${method}` so browser and session events never collide.
  private readonly eventHandlers = new Map<string, (params: unknown) => void>();

  constructor(options: CdpConnectionOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CDP_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CDP_CALL_TIMEOUT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? CDP_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? CDP_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatGraceMs = options.heartbeatGraceMs ?? CDP_HEARTBEAT_GRACE_MS;
    this.autoAllow = options.autoAllow ?? true;
    this.autoAllowDelayMs = options.autoAllowDelayMs ?? CDP_AUTO_ALLOW_DELAY_MS;
    this.dismissDiaAllowPrompt = options.dismissDiaAllowPrompt ?? dismissDiaAllowPrompt;
    this.platform = options.platform ?? process.platform;
    this.onDisconnect = options.onDisconnect ?? (() => {});
  }

  isConnected(): boolean {
    return this.ws?.readyState === CDP_WEBSOCKET_OPEN_STATE;
  }

  open(wsUrl: string, browserName?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      // Dia (The Browser Company) is the only Chromium browser that gates the
      // WS-open behind an "Allow debugging connection?" prompt (Return =
      // Allow). When auto-allow is on and the WS is still CONNECTING past the
      // delay, the prompt is up: fire one Return at the Dia process via osascript
      // so connect completes with no manual click. No-op for every other browser
      // and off macOS; cleared on open so a fast handshake never triggers it.
      const allowTimer =
        this.autoAllow && browserName === "Dia" && this.platform === "darwin"
          ? setTimeout(() => {
              if (settled || ws.readyState !== CDP_WEBSOCKET_CONNECTING_STATE) return;
              this.dismissDiaAllowPrompt();
            }, this.autoAllowDelayMs)
          : undefined;
      const clearAllow = (): void => {
        if (allowTimer) clearTimeout(allowTimer);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearAllow();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error(`timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearAllow();
        this.ws = ws;
        this.startHeartbeat();
        resolve();
      });
      ws.addEventListener("message", (event: MessageEvent) => this.onMessage(String(event.data)));
      ws.addEventListener("error", () => {
        if (settled) {
          this.failPending(ws, new Error("CDP websocket error"));
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearAllow();
        reject(new Error("websocket error (likely 403 or port closed)"));
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        clearAllow();
        this.failPending(ws, new Error("CDP websocket closed"));
        if (!settled) {
          settled = true;
          reject(new Error("websocket closed before open"));
        }
      });
    });
  }

  /** Reject in-flight calls, drop the socket, and clear ambient state. */
  private failPending(ws: WebSocket, error: Error): void {
    if (this.ws !== ws) return;
    this.stopHeartbeat();
    this.ws = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.eventHandlers.clear();
    this.onDisconnect();
  }

  private onMessage(raw: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: unknown;
      sessionId?: string;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    // Any inbound frame — a command reply or an unsolicited Target event —
    // proves the socket is live; reset the keepalive's quiet-window clock so
    // an active or chatty connection never gets a redundant probe.
    this.lastReplyAt = Date.now();
    if (typeof message.id === "number") {
      // A command reply: route to the pending call by id.
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new CdpReplyError(`CDP error: ${message.error.message ?? "unknown"}`));
      else pending.resolve(message.result);
      return;
    }
    // An event (no `id`): route by `sessionId:method`. Browser-level events
    // like Target.targetCreated carry no sessionId.
    if (typeof message.method !== "string") return;
    const handler = this.eventHandlers.get(`${message.sessionId ?? ""}:${message.method}`);
    if (handler) handler(message.params);
  }

  /** Install a CDP-event handler keyed by `(sessionId, method)`. Idempotent. */
  on(method: string, handler: (params: unknown) => void, sessionId?: string): void {
    this.eventHandlers.set(`${sessionId ?? ""}:${method}`, handler);
  }

  call(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== CDP_WEBSOCKET_OPEN_STATE) {
      return Promise.reject(new Error("CDP not connected"));
    }
    const id = this.nextId++;
    const deadline = timeoutMs ?? this.callTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out after ${deadline}ms`));
      }, deadline);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      // flatten:true routes session-scoped replies back over this one socket,
      // tagged by id, so the pending map matches them with no extra envelope.
      ws.send(
        JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }),
      );
    });
  }

  /** Background keepalive for the persistent socket. Its job is to detect a
   * half-open socket during idle rather than discovering it on the next
   * automation run: after a quiet window it probes liveness with a cheap
   * `Target.getTargets` round-trip. The socket often still reads OPEN after a
   * laptop sleep even though the browser was suspended and dropped the debug
   * WS, so without the probe the next `Target.createTarget` call stalls
   * against it for the full call timeout before the open-path catch closes
   * it. A probe that goes unanswered past that timeout tears the socket down
   * now, and the next `openBackgroundTab` reconnects cleanly instead of
   * paying that stall. When the socket genuinely survived the quiet period
   * (still OPEN and the browser still replies), the probe reuses it and
   * avoids a needless reopen. One probe at a time is fine — the interval is
   * larger than the call timeout, so probes never overlap. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastReplyAt = Date.now();
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private heartbeatTick(): void {
    if (!this.isConnected()) return;
    if (Date.now() - this.lastReplyAt < this.heartbeatTimeoutMs) return;
    // Quiet past the threshold: probe liveness rather than assume death. The
    // probe gets its own generous reply-wait (heartbeatGraceMs, not the per-call
    // timeout) so a slow-but-live browser — post-wake scheduling delay, a
    // momentary main-thread block — replies in time and is reused, not torn
    // down. One probe at a time is fine: the interval is larger than the grace
    // window, so probes never overlap.
    void this.call(CDP_HEARTBEAT_PROBE_METHOD, {}, undefined, this.heartbeatGraceMs)
      .then(() => {
        this.lastReplyAt = Date.now();
      })
      .catch((error: unknown) => {
        // A CDP error *reply* means the browser answered on a healthy socket
        // (onMessage already reset lastReplyAt) — keep it. Same guard as
        // openBackgroundTab/closeTab: a reply must never drop the one persistent
        // socket kept for the daemon's lifetime. Only a transport drop or a
        // probe timeout is a genuinely stale socket worth tearing down.
        if (error instanceof CdpReplyError) return;
        this.dropStale("CDP heartbeat probe failed; dropping socket");
      });
  }

  /** Close the (presumed dead) live socket and route teardown through
   * failPending so maps/handlers reset in one place. Safe against a concurrent
   * reconnect that already swapped in a fresh socket via the guard there. */
  dropStale(reason: string): void {
    const dead = this.ws;
    if (!dead) return;
    try {
      dead.close();
    } catch {
      /* ignore */
    }
    this.failPending(dead, new Error(reason));
  }

  close(): void {
    this.stopHeartbeat();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
    this.eventHandlers.clear();
  }
}
