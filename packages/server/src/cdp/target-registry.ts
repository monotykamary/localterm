import { randomUUID } from "node:crypto";
import { LOCALTERM_TAB_TOKEN_EVENT, LOCALTERM_TAB_TOKEN_PROPERTY } from "../constants.js";

interface TargetRegistryConnection {
  isConnected: () => boolean;
  on: (method: string, handler: (params: unknown) => void, sessionId?: string) => void;
  call: (
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ) => Promise<unknown>;
}

interface TargetRegistryOptions {
  connection: TargetRegistryConnection;
  tabUrlFilter?: (candidateUrl: string) => boolean;
}

export class TargetRegistry {
  private readonly connection: TargetRegistryConnection;
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

  constructor(options: TargetRegistryOptions) {
    this.connection = options.connection;
    this.tabUrlFilter = options.tabUrlFilter;
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
  async observeTargets(): Promise<void> {
    if (!this.connection.isConnected()) return;
    // Idempotent: handlers overwrite in place if establish() runs again after
    // a socket drop.
    this.connection.on("Target.targetCreated", (params: unknown) => {
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
    this.connection.on("Target.targetDestroyed", (params: unknown) => {
      const targetId = (params as { targetId?: string } | undefined)?.targetId;
      if (typeof targetId !== "string") return;
      const token = this.targetIdToToken.get(targetId);
      if (token !== undefined) {
        this.tokenToTargetId.delete(token);
        this.targetIdToToken.delete(targetId);
      }
    });
    await this.connection.call("Target.setDiscoverTargets", { discover: true });
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
      const attached = (await this.connection.call("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId?: string };
      sessionId = attached?.sessionId;
      if (!sessionId) return;
      // Page domain must be enabled for addScriptToEvaluateOnNewDocument to
      // install (and for Runtime.evaluate to land against this tab).
      await this.connection.call("Page.enable", {}, sessionId);
      // Fires on every navigation (and reload) — the token survives across
      // the page's lifetime via this attached session.
      await this.connection.call(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: expression },
        sessionId,
      );
      // Best-effort immediate inject for an already-loaded page. Errors when
      // the document has no execution context yet (still loading) — the
      // addScript will run on context creation and dispatch the event then.
      try {
        await this.connection.call("Runtime.evaluate", { expression }, sessionId);
      } catch {
        /* execution context not yet ready; addScript covers it */
      }
    } catch {
      // attach/enable failed (target already closed, fork without attach
      // support). Leave the maps — targetDestroyed will clean up if/when it
      // fires; without it the entry is inert (no WS ever sends this token).
    }
  }

  findTargetIdForToken(token: string): string | undefined {
    return this.tokenToTargetId.get(token);
  }

  clear(): void {
    // Socket dropped → every prior targetId/token is invalid; the browser
    // session is gone (or different). Reset so the next observeTargets cycle
    // re-discovers from a clean slate.
    this.tokenToTargetId.clear();
    this.targetIdToToken.clear();
  }
}
