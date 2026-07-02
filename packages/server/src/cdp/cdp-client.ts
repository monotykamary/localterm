/**
 * Persistent Chrome DevTools Protocol client for opening background tabs.
 *
 * One WebSocket to a debug-enabled Chromium browser, established once and kept
 * open for the daemon's lifetime, so the user only clears the browser's
 * remote-debugging prompt a single time (at `start`) instead of on every run.
 *
 * `Target.createTarget({ background: true })` creates the tab *behind* the
 * active one — a true background tab that never steals focus. The `background`
 * flag is the deterministic switch; without it the browser foregrounds the tab.
 *
 * Connection logic is ported from the sibling browser-harness-js CDP SDK. If
 * the socket drops (browser quit/restarted) it transparently re-detects and
 * reconnects on the next open; when no browser is reachable, `openBackgroundTab`
 * resolves null so the caller can fall back to the OS opener.
 */

import { randomUUID } from "node:crypto";
import { detectChromiumBrowsers, type DetectedBrowser } from "./detect-chromium.js";
import {
  CDP_HEARTBEAT_INTERVAL_MS,
  CDP_HEARTBEAT_TIMEOUT_MS,
  LOCALTERM_TAB_TOKEN_EVENT,
  LOCALTERM_TAB_TOKEN_PROPERTY,
} from "../constants.js";

const WS_OPEN = 1; // WebSocket.OPEN

// Cheap browser-level CDP round-trip used as a transport liveness probe by the
// keepalive: no session, no side effects, minimal reply.
const CDP_HEARTBEAT_PROBE_METHOD = "Target.getTargets";

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 5_000;
// Give the browser a beat to process window.close() before tearing down the
// CDP target — some Chromium forks (Dia, Arc) leave the tab in the strip
// otherwise (see browser-harness-js closeTab).
const CLOSE_SETTLE_MS = 100;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export type CdpClientOptions = {
  /** Override browser detection (tests). Defaults to detectChromiumBrowsers. */
  detect?: () => Promise<DetectedBrowser[]>;
  /** Per-candidate WS-open timeout. */
  connectTimeoutMs?: number;
  /** Per-CDP-call timeout. */
  callTimeoutMs?: number;
  /** Background keepalive interval for the persistent socket. */
  heartbeatIntervalMs?: number;
  /** Quiet window after which the keepalive treats the socket as stale and probes it. */
  heartbeatTimeoutMs?: number;
  /**
   * Predicate over a candidate target's URL. Only page-type targets that pass
   * get an ambient token injected; everything else the user has open in their
   * debugged browser stays untouched. Called lazily on each targetCreated event
   * after a fresh socket is established, so a closure capturing a port bound
   * later is fine.
   */
  tabUrlFilter?: (candidateUrl: string) => boolean;
};

export class CdpClient {
  private ws: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly detect: () => Promise<DetectedBrowser[]>;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  /** Timestamp of the last inbound CDP frame (reply or event). */
  private lastReplyAt = 0;
  /** Background keepalive timer; unref'd so it never blocks daemon shutdown. */
  private heartbeatTimer: NodeJS.Timeout | undefined;
  /** Serializes closeTab() so concurrent closes don't orphan tabs. */
  private closeQueue: Promise<void> = Promise.resolve();
  /** The browser the live socket is attached to, for diagnostics. */
  connectedBrowser: DetectedBrowser | undefined;
  private readonly tabUrlFilter?: (candidateUrl: string) => boolean;
  // Ambient tab provenance. The CDP-injected `token` <-> `targetId` pairs let
  // the WS server match a localterm WS socket (which echoes the token back in
  // its `{type:"identify"}` message) to the browser tab it belongs to, so
  // onExit can drive closeTab on the right target without any open-path
  // coordination. One entry per page-type target on our origin; cleared
  // whenever the socket drops (a fresh browser session invalidates every
  // prior targetId).
  private readonly tokenToTargetId = new Map<string, string>();
  private readonly targetIdToToken = new Map<string, string>();
  // Event routing. CDP delivers events as `{ method, params, sessionId? }`
  // with no `id`; browser-level events (Target.targetCreated etc.) have no
  // sessionId, session-scoped events carry theirs. We key by
  // `${sessionId ?? ""}:${method}` so browser and session events never collide.
  private readonly eventHandlers = new Map<string, (params: unknown) => void>();

  constructor(options: CdpClientOptions = {}) {
    this.detect = options.detect ?? detectChromiumBrowsers;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? CDP_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? CDP_HEARTBEAT_TIMEOUT_MS;
    this.tabUrlFilter = options.tabUrlFilter;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  /**
   * Ensure a live socket, detecting and attaching to the most-recently-launched
   * debug-enabled browser. Concurrent callers ride the same in-flight attempt.
   * Throws when no browser is reachable.
   */
  async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (!this.connecting) {
      this.connecting = this.establish().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async establish(): Promise<void> {
    const browsers = await this.detect();
    if (browsers.length === 0) {
      throw new Error("no debug-enabled Chromium browser detected");
    }
    const errors: string[] = [];
    for (const browser of browsers) {
      try {
        await this.openSocket(browser.wsUrl);
        this.connectedBrowser = browser;
        // Kick off ambient tab observation on the live socket. Fire-and-get:
        // discovery fails soft (closeTab falls back to window.close()), and the
        // connect() promise should resolve as soon as the socket is usable,
        // not wait on the first Target.setDiscoverTargets round-trip.
        void this.observeTargets().catch(() => {
          /* discovery is best-effort; tabs fall back to window.close() */
        });
        return;
      } catch (error) {
        errors.push(`${browser.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`no detected browser accepted a connection (${errors.join("; ")})`);
  }

  private openSocket(wsUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
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
        reject(new Error("websocket error (likely 403 or port closed)"));
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
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
    this.connectedBrowser = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    // Socket dropped → every prior targetId/token is invalid; the browser
    // session is gone (or different). Reset so the next observeTargets cycle
    // re-discovers from a clean slate.
    this.tokenToTargetId.clear();
    this.targetIdToToken.clear();
    this.eventHandlers.clear();
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
        pending.reject(new Error(`CDP error: ${message.error.message ?? "unknown"}`));
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
  private on(method: string, handler: (params: unknown) => void, sessionId?: string): void {
    this.eventHandlers.set(`${sessionId ?? ""}:${method}`, handler);
  }

  private call(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) {
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

  /**
   * Begin observing target lifecycle. `Target.setDiscoverTargets` makes the
   * browser emit `Target.targetCreated` for every existing page-type target
   * (tabs already open) plus every subsequently-created one; for each on our
   * origin we inject an ambient token the page echoes over its WS so the
   * server can pair the socket with the targetId (for closeTab on shell exit).
   * `Target.targetDestroyed` cleans up our maps. Best-effort and never throws
   * — discovery is a soft layer on top of the persistent socket.
   */
  private async observeTargets(): Promise<void> {
    if (!this.isConnected()) return;
    // Idempotent: handlers overwrite in place if establish() runs again after
    // a socket drop.
    this.on("Target.targetCreated", (params: unknown) => {
      const target = (
        params as { targetInfo?: { type?: string; targetId?: string; url?: string } } | undefined
      )?.targetInfo;
      if (!target || target.type !== "page" || typeof target.targetId !== "string") return;
      if (this.targetIdToToken.has(target.targetId)) return; // already injected
      if (typeof target.url !== "string" || (this.tabUrlFilter && !this.tabUrlFilter(target.url)))
        return;
      void this.injectToken(target.targetId).catch(() => {
        /* injection is best-effort; never blocks observeTargets */
      });
    });
    this.on("Target.targetDestroyed", (params: unknown) => {
      const targetId = (params as { targetId?: string } | undefined)?.targetId;
      if (typeof targetId !== "string") return;
      const token = this.targetIdToToken.get(targetId);
      if (token !== undefined) {
        this.tokenToTargetId.delete(token);
        this.targetIdToToken.delete(targetId);
      }
    });
    await this.call("Target.setDiscoverTargets", { discover: true });
  }

  /**
   * Attach to one target and inject an ambient token the page echoes back over
   * its WS so the server can pair the socket with this targetId. The robust
   * hook is `Page.addScriptToEvaluateOnNewDocument`: it re-runs on every
   * navigation (reload, push to a new document), so the token survives the
   * page's lifetime without per-event re-injection plumbing. Followed by a
   * best-effort immediate `Runtime.evaluate` so a page that has already loaded
   * (the daemon observed an existing tab) gets the token without waiting for a
   * navigation. Never throws.
   */
  private async injectToken(targetId: string): Promise<void> {
    const token = randomUUID();
    this.targetIdToToken.set(targetId, token);
    this.tokenToTargetId.set(token, targetId);
    // The injected expression assigns the token under a well-known window
    // property the client reads on WS-open, then dispatches a named event the
    // client also listens for — covering the case where injection lands after
    // the WS has already connected with `token:null`.
    const expression = `window[${JSON.stringify(
      LOCALTERM_TAB_TOKEN_PROPERTY,
    )}]=${JSON.stringify(token)};window.dispatchEvent(new Event(${JSON.stringify(
      LOCALTERM_TAB_TOKEN_EVENT,
    )}))`;
    let sessionId: string | undefined;
    try {
      const attached = (await this.call("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId?: string };
      sessionId = attached?.sessionId;
      if (!sessionId) return;
      // Page domain must be enabled for addScriptToEvaluateOnNewDocument to
      // install (and for Runtime.evaluate to land against this tab).
      await this.call("Page.enable", {}, sessionId);
      // Fires on every navigation (and reload) — the token survives across
      // the page's lifetime via this attached session.
      await this.call("Page.addScriptToEvaluateOnNewDocument", { source: expression }, sessionId);
      // Best-effort immediate inject for an already-loaded page. Errors when
      // the document has no execution context yet (still loading) — the
      // addScript will run on context creation and dispatch the event then.
      try {
        await this.call("Runtime.evaluate", { expression }, sessionId);
      } catch {
        /* execution context not yet ready; addScript covers it */
      }
    } catch {
      // attach/enable failed (target already closed, fork without attach
      // support). Leave the maps — targetDestroyed will clean up if/when it
      // fires; without it the entry is inert (no WS ever sends this token).
    }
  }

  /**
   * Resolve the CDP targetId an ambient token was injected for, so the WS
   * server can pair a `{type:"identify", token}` message with the right tab
   * for closeTab on shell exit. Returns undefined when the token is unknown
   * (no CDP reachable, or the page raced its identify in before injection).
   */
  findTargetIdForToken(token: string): string | undefined {
    return this.tokenToTargetId.get(token);
  }

  /**
   * Find an existing page-type target whose URL passes `predicate` — used to
   * reuse a live viewer tab for screenshot/mouse instead of opening an
   * ephemeral one (zero spawn latency, render already current). Calls
   * `Target.getTargets` over the existing socket; returns the first matching
   * targetId or null. Never throws: a dropped socket or empty list yields null.
   */
  async findTargetByUrl(predicate: (url: string) => boolean): Promise<string | null> {
    try {
      await this.connect();
    } catch {
      return null;
    }
    try {
      const result = (await this.call("Target.getTargets", {})) as {
        targetInfos?: Array<{ type?: string; targetId?: string; url?: string }>;
      };
      const targets = result?.targetInfos ?? [];
      for (const target of targets) {
        if (
          target.type === "page" &&
          typeof target.targetId === "string" &&
          typeof target.url === "string" &&
          predicate(target.url)
        ) {
          return target.targetId;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Attach to `targetId` and return the CDP sessionId for subsequent
   * session-scoped calls (evaluateInSession/captureScreenshotInSession). Used
   * by screenshot/mouse to attach once and poll cheaply instead of
   * re-attaching on every render-landed probe. Returns null on attach failure.
   */
  async attachSession(targetId: string): Promise<string | null> {
    try {
      const attached = (await this.call("Target.attachToTarget", { targetId, flatten: true })) as {
        sessionId?: string;
      };
      return attached?.sessionId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * `Runtime.evaluate` against a sessionId from `attachSession`, returning the
   * value by JSON value (or null for undefined/a thrown error). Cheap: one
   * round-trip, no re-attach. Used by the render-landed poll loop.
   */
  async evaluateInSession(
    sessionId: string,
    expression: string,
    timeoutMs?: number,
  ): Promise<unknown> {
    try {
      const result = (await this.call(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
        timeoutMs,
      )) as { result?: { value?: unknown } };
      return result?.result?.value ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Attach to `targetId`, enable the Page domain, and `Runtime.evaluate` an
   * expression, returning its JSON value (or null for undefined/a thrown
   * error). One-shot convenience for a single read (mouse cell metrics, a
   * single render-seq check) where re-attaching is acceptable. Never throws.
   */
  async evaluate(targetId: string, expression: string, timeoutMs?: number): Promise<unknown> {
    const sessionId = await this.attachSession(targetId);
    if (!sessionId) return null;
    try {
      await this.call("Page.enable", {}, sessionId, timeoutMs);
    } catch {
      /* page domain optional for a plain evaluate */
    }
    return this.evaluateInSession(sessionId, expression, timeoutMs);
  }

  /**
   * `Page.captureScreenshot` against a pre-attached sessionId (from
   * attachSession), clipped to `clip` ({x,y,width,height} in CSS px) or the
   * full viewport when omitted. Returns the PNG as a Node Buffer, or null on
   * failure. Reuses the existing socket; the browser (already a hard dep for
   * the viewer) is the rasterizer, so there is no new image dependency.
   */
  async captureScreenshotInSession(
    sessionId: string,
    clip?: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer | null> {
    try {
      const params: Record<string, unknown> = { format: "png" };
      if (clip) params.clip = { ...clip, scale: 1 };
      const result = (await this.call("Page.captureScreenshot", params, sessionId)) as {
        data?: string;
      };
      return result?.data ? Buffer.from(result.data, "base64") : null;
    } catch {
      return null;
    }
  }

  /**
   * Dispatch a sequence of `Input.dispatchMouseEvent` calls against a
   * pre-attached sessionId so the page's own xterm.js — which speaks SGR mouse
   * natively — generates the sequence, avoiding a from-scratch encoder for the
   * browser case. The caller composes presses/releases/moves/wheels from
   * already-resolved CSS-pixel coords and a button name.
   */
  async dispatchMouseEventsInSession(
    sessionId: string,
    events: Array<{
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "left" | "middle" | "right" | "none";
      buttons?: number;
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }>,
  ): Promise<void> {
    for (const event of events) {
      try {
        await this.call("Input.dispatchMouseEvent", event, sessionId);
      } catch {
        /* tab closed mid-sequence; the gesture is best-effort */
        return;
      }
    }
  }

  /**
   * Set a cookie in the browser's jar (CDP `Network.setCookie`, a browser-level
   * call usable before a tab is created). Used in auth-gated mode to mint the
   * daemon's own viewer tabs a session cookie so their `/ws` upgrade passes the
   * auth gate — those tabs carry no browser session of their own. The `url`
   * implies the cookie's domain and secure bit. Best-effort, never throws.
   */
  async setCookie(cookie: {
    name: string;
    value: string;
    url: string;
    secure?: boolean;
  }): Promise<boolean> {
    try {
      await this.connect();
    } catch {
      return false;
    }
    try {
      const result = (await this.call("Network.setCookie", cookie)) as { success?: boolean };
      return result?.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Open `url` as a background tab. Returns the new target's id on success
   * (used later to close the tab), or null when no browser is reachable
   * (connect failed) or the call errored — the caller's cue to fall back to the
   * OS opener. One reconnect is attempted if the persistent socket has gone
   * stale. Never throws.
   */
  async openBackgroundTab(url: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.connect();
      } catch {
        return null; // no reachable browser — fall back
      }
      try {
        const result = (await this.call("Target.createTarget", { url, background: true })) as {
          targetId?: unknown;
        };
        return typeof result?.targetId === "string" ? result.targetId : null;
      } catch {
        // Socket went stale between runs (browser restarted, or a call timed
        // out while still OPEN). Close it explicitly — failPending doesn't
        // close() on its own — to avoid leaking a second live socket alongside
        // the next connect()'s new one, and reset maps/handlers in one place.
        const stale = this.ws;
        if (stale) {
          try {
            stale.close();
          } catch {
            /* ignore */
          }
          this.failPending(stale, new Error("CDP call failed; dropping stale socket"));
        }
      }
    }
    return null;
  }

  /**
   * Close a tab previously opened by `openBackgroundTab`. Mirrors
   * browser-harness-js: drive the browser's own close path via
   * `window.close()` (reliable on forks like Dia/Arc that ignore a bare
   * `Target.closeTarget`), then tear down the CDP target. Best-effort and never
   * throws — a missing browser/target is treated as already closed.
   *
   * Closes are SERIALIZED through `closeQueue`: each waits for the previous to
   * finish. Without this, concurrent closes over the one shared socket can
   * interleave — a `Target.closeTarget` detaching a session before another
   * tab's `window.close()` has taken effect in the browser — which leaves stale
   * tabs behind. (Same reason browser-harness-js serializes.)
   */
  closeTab(targetId: string): Promise<void> {
    const doClose = async () => {
      if (!this.isConnected()) return;
      try {
        const attached = (await this.call("Target.attachToTarget", {
          targetId,
          flatten: true,
        })) as { sessionId?: string };
        if (attached?.sessionId) {
          try {
            await this.call(
              "Runtime.evaluate",
              { expression: "window.close()" },
              attached.sessionId,
            );
          } catch {
            /* tab may already be navigating/closing */
          }
          await new Promise((resolve) => setTimeout(resolve, CLOSE_SETTLE_MS));
        }
      } catch {
        /* attach failed (already gone, or fork without attach) — try closeTarget */
      }
      try {
        await this.call("Target.closeTarget", { targetId });
      } catch {
        /* already closed */
      }
    };
    // Chain onto the queue with doClose as both handlers so a failed close
    // never wedges the chain. Callers get the tail (fine for fire-and-forget).
    this.closeQueue = this.closeQueue.then(doClose, doClose);
    return this.closeQueue;
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
    // Quiet past the threshold: probe liveness rather than assume death. A
    // reply resets lastReplyAt (via onMessage) and keeps the socket; a timeout
    // or transport error tears it down. One probe at a time is fine — the
    // interval is larger than the call timeout, so probes never overlap.
    void this.call(CDP_HEARTBEAT_PROBE_METHOD, {})
      .then(() => {
        this.lastReplyAt = Date.now();
      })
      .catch(() => {
        this.teardownStale("CDP heartbeat probe failed; dropping socket");
      });
  }

  /** Close the (presumed dead) live socket and route teardown through
   * failPending so maps/handlers reset in one place. Safe against a concurrent
   * reconnect that already swapped in a fresh socket via the guard there. */
  private teardownStale(reason: string): void {
    const dead = this.ws;
    if (!dead) return;
    try {
      dead.close();
    } catch {
      /* ignore */
    }
    this.failPending(dead, new Error(reason));
  }

  /**
   * Drop the live socket so the next `connect()` re-runs detection — used when
   * the configured CDP endpoint changes via `PUT /api/config`, so the new port
   * takes effect without a daemon restart. Best-effort: a no-op when already
   * disconnected, and safe against a concurrent reconnect (the guard in
   * failPending ignores a stale socket). The caller may follow up with
   * `connect()` to re-establish promptly; otherwise the next
   * `openBackgroundTab` reconnects lazily.
   */
  resetConnection(reason = "cdp connection reset"): void {
    this.teardownStale(reason);
  }

  close(): void {
    this.stopHeartbeat();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
    this.connectedBrowser = undefined;
    this.tokenToTargetId.clear();
    this.targetIdToToken.clear();
    this.eventHandlers.clear();
  }
}
