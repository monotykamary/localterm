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

import { CdpConnection, CdpReplyError } from "./cdp-connection.js";
import { CDP_CLOSE_SETTLE_MS } from "./constants.js";
import { detectChromiumBrowsers, type DetectedBrowser } from "./detect-chromium.js";
import { TargetRegistry } from "./target-registry.js";

export interface CdpClientOptions {
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
  /** Reply-wait for the keepalive's liveness probe before it declares the socket stale. */
  heartbeatGraceMs?: number;
  /** Opt out of auto-dismissing Dia's "Allow debugging connection?" prompt
   *  (macOS, Dia only). On by default: when the WS-open stalls past
   *  `autoAllowDelayMs` the daemon fires a Return at the Dia process via
   *  osascript so its persistent CDP socket connects with no manual click — a
   *  no-op for every other browser and off macOS. Kept on the client so every
   *  connect/reconnect inherits it. Needs macOS Accessibility for the node
   *  binary; without it the keystroke is dropped and connect waits on its
   *  timeout (no regression vs. the feature being off). */
  autoAllow?: boolean;
  /** ms after the WS-open attempt before auto-dismissing Dia's prompt. Default
   *  600 — a live WS opens in ~100ms, so "still CONNECTING at 600ms" means the
   *  prompt is up. Measured from WebSocket creation. */
  autoAllowDelayMs?: number;
  /** Override the Dia-prompt dismiss (tests). Defaults to the osascript helper. */
  dismissDiaAllowPrompt?: () => void;
  /** Override the host platform (tests). The Dia auto-allow gate is macOS-only. */
  platform?: NodeJS.Platform;
  /**
   * Predicate over a candidate target's URL. Only page-type targets that pass
   * get an ambient token injected; everything else the user has open in their
   * debugged browser stays untouched. Called lazily on each targetCreated event
   * after a fresh socket is established, so a closure capturing a port bound
   * later is fine.
   */
  tabUrlFilter?: (candidateUrl: string) => boolean;
}

export class CdpClient {
  private connecting: Promise<void> | undefined;
  private readonly detect: () => Promise<DetectedBrowser[]>;
  private readonly connection: CdpConnection;
  private readonly targetRegistry: TargetRegistry;
  /** Serializes closeTab() so concurrent closes don't orphan tabs. */
  private closeQueue: Promise<void> = Promise.resolve();
  /** The browser the live socket is attached to, for diagnostics. */
  connectedBrowser: DetectedBrowser | undefined;

  constructor(options: CdpClientOptions = {}) {
    this.detect = options.detect ?? detectChromiumBrowsers;
    this.connection = new CdpConnection({
      connectTimeoutMs: options.connectTimeoutMs,
      callTimeoutMs: options.callTimeoutMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
      heartbeatGraceMs: options.heartbeatGraceMs,
      autoAllow: options.autoAllow,
      autoAllowDelayMs: options.autoAllowDelayMs,
      dismissDiaAllowPrompt: options.dismissDiaAllowPrompt,
      platform: options.platform,
      onDisconnect: () => {
        this.connectedBrowser = undefined;
        this.targetRegistry.clear();
      },
    });
    this.targetRegistry = new TargetRegistry({
      connection: this.connection,
      tabUrlFilter: options.tabUrlFilter,
    });
  }

  isConnected(): boolean {
    return this.connection.isConnected();
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
        await this.connection.open(browser.wsUrl, browser.name);
        this.connectedBrowser = browser;
        // Kick off ambient tab observation on the live socket. Fire-and-get:
        // discovery fails soft (closeTab falls back to window.close()), and the
        // connect() promise should resolve as soon as the socket is usable,
        // not wait on the first Target.setDiscoverTargets round-trip.
        void this.targetRegistry.observeTargets().catch(() => {
          /* discovery is best-effort; tabs fall back to window.close() */
        });
        return;
      } catch (error) {
        errors.push(`${browser.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`no detected browser accepted a connection (${errors.join("; ")})`);
  }

  /**
   * Resolve the CDP targetId an ambient token was injected for, so the WS
   * server can pair a `{type:"identify", token}` message with the right tab
   * for closeTab on shell exit. Returns undefined when the token is unknown
   * (no CDP reachable, or the page raced its identify in before injection).
   */
  findTargetIdForToken(token: string): string | undefined {
    return this.targetRegistry.findTargetIdForToken(token);
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
      const result = (await this.connection.call("Target.getTargets", {})) as {
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
      const attached = (await this.connection.call("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId?: string };
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
      const result = (await this.connection.call(
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
      await this.connection.call("Page.enable", {}, sessionId, timeoutMs);
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
      const result = (await this.connection.call("Page.captureScreenshot", params, sessionId)) as {
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
        await this.connection.call("Input.dispatchMouseEvent", event, sessionId);
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
      const result = (await this.connection.call("Network.setCookie", cookie)) as {
        success?: boolean;
      };
      return result?.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Add a virtual WebAuthn authenticator (CTAP2, resident key, user-verified,
   * auto-presence) on an attached page session so a test can drive a passkey
   * register/login ceremony with no real hardware — `navigator.credentials.create/
   * get` in that page auto-resolve against it. The WebAuthn domain is
   * session-scoped, so this must run against a `sessionId` from `attachSession`.
   * Returns the authenticator id (pass to `removeVirtualAuthenticator`), or null.
   */
  async addVirtualAuthenticator(sessionId: string): Promise<string | null> {
    try {
      await this.connection.call("WebAuthn.enable", {}, sessionId);
      const result = (await this.connection.call(
        "WebAuthn.addVirtualAuthenticator",
        {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            automaticPresenceSimulation: true,
            isUserVerified: true,
          },
        },
        sessionId,
      )) as { authenticatorId?: string };
      return typeof result?.authenticatorId === "string" ? result.authenticatorId : null;
    } catch {
      return null;
    }
  }

  /** Remove a virtual authenticator added by `addVirtualAuthenticator`. */
  async removeVirtualAuthenticator(sessionId: string, authenticatorId: string): Promise<void> {
    if (!this.isConnected()) return;
    try {
      await this.connection.call(
        "WebAuthn.removeVirtualAuthenticator",
        { authenticatorId },
        sessionId,
      );
    } catch {
      /* best-effort */
    }
  }

  /**
   * Open `url` as a FOREGROUND (active) tab. Unlike `openBackgroundTab`, the tab
   * receives focus — required by WebAuthn, whose `navigator.credentials.*`
   * reject with NotAllowedError on a background tab. For test driving only.
   */
  async openForegroundTab(url: string): Promise<string | null> {
    try {
      await this.connect();
    } catch {
      return null;
    }
    try {
      const result = (await this.connection.call("Target.createTarget", { url })) as {
        targetId?: unknown;
      };
      return typeof result?.targetId === "string" ? result.targetId : null;
    } catch {
      return null;
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
        const result = (await this.connection.call("Target.createTarget", {
          url,
          background: true,
        })) as { targetId?: unknown };
        return typeof result?.targetId === "string" ? result.targetId : null;
      } catch (error) {
        // A CDP error reply (e.g. createTarget "denied") leaves the socket
        // healthy — finish without dropping it, or the forced reconnect
        // re-fires the browser's remote-debugging consent prompt for nothing.
        // Only a transport drop or a call timeout is a stale socket; close it
        // explicitly (failPending doesn't close() on its own) and reset maps.
        if (error instanceof CdpReplyError) return null;
        this.connection.dropStale("CDP call failed; dropping stale socket");
      }
    }
    return null;
  }

  /**
   * Navigate an existing tab to `url` (used by workspace restore to repoint the
   * bootstrap `--open` tab into the first restored shell's cwd, so the reopen
   * lands exactly N tabs in the manifest's cwds rather than N−1 + one stray in
   * the default directory). Attaches once, fires `Page.navigate`, detaches.
   * Best-effort and never throws — a missing browser/target is a no-op. Does
   * not serialize on `closeQueue`: restore runs once at startup with no
   * concurrent closes to interleave with.
   */
  async navigateTab(targetId: string, url: string): Promise<void> {
    try {
      await this.connect();
    } catch {
      return;
    }
    let sessionId: string | undefined;
    try {
      const attached = (await this.connection.call("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId?: string };
      sessionId = attached?.sessionId;
    } catch {
      return;
    }
    if (!sessionId) return;
    try {
      await this.connection.call("Page.navigate", { url }, sessionId);
    } catch {
      /* tab may be navigating/closing — best-effort */
    }
    try {
      await this.connection.call("Target.detachFromTarget", { sessionId });
    } catch {
      /* detach is best-effort; the browser tears it down on navigation anyway */
    }
  }

  /**
   * Close a tab. Mirrors browser-harness-js: drive the browser's own close
   * path via `window.close()` (reliable on forks like Dia/Arc that ignore a
   * bare `Target.closeTarget`), then tear down the CDP target. Best-effort
   * and never throws — a missing browser/target is treated as already closed.
   *
   * Reconnects the persistent socket if it has dropped (sleep/wake, transient
   * error, heartbeat teardown). The Ctrl+D shell-exit path drives this from
   * `onClientExit` the instant the PTY dies; if the debug WS is momentarily
   * down then, the tab/targetId is still valid (same browser session) and a
   * reconnect lands the close. Without it, `window.close()` is a no-op on
   * URL-opened tabs and the dead-session mask is left behind. One reconnect is
   * attempted if the close itself fails on a stale socket — same shape as
   * `openBackgroundTab`.
   *
   * Closes are SERIALIZED through `closeQueue`: each waits for the previous to
   * finish. Without this, concurrent closes over the one shared socket can
   * interleave — a `Target.closeTarget` detaching a session before another
   * tab's `window.close()` has taken effect in the browser — which leaves stale
   * tabs behind. (Same reason browser-harness-js serializes.)
   */
  closeTab(targetId: string): Promise<void> {
    const doClose = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.connect();
        } catch {
          return; // no reachable browser — treat as already closed
        }
        try {
          const attached = (await this.connection.call("Target.attachToTarget", {
            targetId,
            flatten: true,
          })) as { sessionId?: string };
          if (attached?.sessionId) {
            try {
              await this.connection.call(
                "Runtime.evaluate",
                { expression: "window.close()" },
                attached.sessionId,
              );
            } catch {
              /* tab may already be navigating/closing */
            }
            await new Promise((resolve) => setTimeout(resolve, CDP_CLOSE_SETTLE_MS));
          }
        } catch {
          /* attach failed (already gone, or fork without attach) — try closeTarget */
        }
        try {
          await this.connection.call("Target.closeTarget", { targetId });
          return;
        } catch (error) {
          // A CDP error reply (e.g. "No target with given id found") means the
          // tab is already closed (window.close() above did it) and the socket
          // is healthy — finish without dropping it, or the forced reconnect
          // re-fires the browser's remote-debugging consent prompt on every
          // automation run. Only a transport drop or a call timeout is a stale
          // socket worth tearing down for the retry to reconnect.
          if (error instanceof CdpReplyError) return;
          this.connection.dropStale("CDP closeTab call failed; dropping stale socket");
        }
      }
    };
    // Chain onto the queue with doClose as both handlers so a failed close
    // never wedges the chain. Callers get the tail (fine for fire-and-forget).
    this.closeQueue = this.closeQueue.then(doClose, doClose);
    return this.closeQueue;
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
    this.connection.dropStale(reason);
  }

  close(): void {
    this.connection.close();
    this.connectedBrowser = undefined;
    this.targetRegistry.clear();
  }
}
