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
 * resolves false so the caller can fall back to the OS opener.
 */

import { detectChromiumBrowsers, type DetectedBrowser } from "./detect-chromium.js";

const WS_OPEN = 1; // WebSocket.OPEN

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 5_000;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export type CdpClientOptions = {
  /** Override browser detection (tests). Defaults to detectChromiumBrowsers. */
  detect?: () => Promise<DetectedBrowser[]>;
  /** Per-candidate WS-open timeout. */
  connectTimeoutMs?: number;
  /** Per-CDP-call timeout. */
  callTimeoutMs?: number;
};

export class CdpClient {
  private ws: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly detect: () => Promise<DetectedBrowser[]>;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  /** The browser the live socket is attached to, for diagnostics. */
  connectedBrowser: DetectedBrowser | undefined;

  constructor(options: CdpClientOptions = {}) {
    this.detect = options.detect ?? detectChromiumBrowsers;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
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

  /** Reject in-flight calls and drop the socket when it's the active one. */
  private failPending(ws: WebSocket, error: Error): void {
    if (this.ws !== ws) return;
    this.ws = undefined;
    this.connectedBrowser = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private onMessage(raw: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id !== "number") return; // an event, not a reply
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error)
      pending.reject(new Error(`CDP error: ${message.error.message ?? "unknown"}`));
    else pending.resolve(message.result);
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error("CDP not connected"));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out after ${this.callTimeoutMs}ms`));
      }, this.callTimeoutMs);
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
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Open `url` as a background tab. Returns true on success, false when no
   * browser is reachable (connect failed) or the call errored — the caller's
   * cue to fall back to the OS opener. One reconnect is attempted if the
   * persistent socket has gone stale. Never throws.
   */
  async openBackgroundTab(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.connect();
      } catch {
        return false; // no reachable browser — fall back
      }
      try {
        const result = (await this.call("Target.createTarget", { url, background: true })) as {
          targetId?: unknown;
        };
        return typeof result?.targetId === "string";
      } catch {
        // Socket likely went stale between runs (browser restarted). Drop it and
        // let the next loop iteration re-detect and reconnect once.
        this.ws = undefined;
        this.connectedBrowser = undefined;
      }
    }
    return false;
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
    this.connectedBrowser = undefined;
  }
}
