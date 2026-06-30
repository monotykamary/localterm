// CDP-backed terminal-use parity: capture-pane --png and session mouse, built
// on the insight that the daemon's existing CDP socket (the one `localterm
// start` opened for background-tab automation) plus the tmux-parity surface
// compose without new deps. The browser (already a hard dep for the viewer) is
// the rasterizer; xterm.js (already speaking SGR mouse natively) is the mouse
// encoder. The tmux-parity capture renderer is the render-landed source of
// truth and the no-browser fallback for text capture.
//
// Reuse strategy: prefer a live viewer tab for the session (zero spawn latency,
// render already current) before opening an ephemeral background tab. A pinned
// session (the REST default) survives between calls with no tab burning a slot.

import type { CdpClient } from "./cdp/cdp-client.js";
import type { SessionManager } from "./session-manager.js";
import {
  CDP_MOUSE_TIMEOUT_MS,
  CDP_RENDER_LANDED_POLL_INTERVAL_MS,
  CDP_RENDER_LANDED_SETTLE_MS,
  CDP_SCREENSHOT_TIMEOUT_MS,
  LOCALTERM_MOUSE_CELLS_PROPERTY,
  LOCALTERM_PANE_TEXT_PROPERTY,
} from "./constants.js";
import type { MouseButton } from "./utils/sgr-mouse.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SessionAutomationDeps {
  cdpClient: CdpClient | null;
  // Builds the viewer-tab URL for a session (`?sid=<id>` at the daemon's local
  // origin so it never rides the tailnet — same as automation run tabs).
  buildTabUrl: (sessionId: string) => string;
}

// A tab resolved for automation: either an existing live viewer (reused, never
// closed) or an ephemeral one (closed after use). `sessionId` is the attached
// CDP session for cheap polling/dispatch.
interface ResolvedTab {
  targetId: string;
  cdpSessionId: string;
  close: () => Promise<void>;
}

// Find an existing viewer tab for `id` (a page whose URL carries `?sid=<id>`),
// or open an ephemeral background tab and attach it. Returns null when no
// browser is reachable (caller falls back to the headless SGR path for mouse,
// or reports no_browser for screenshot).
const resolveTab = async (deps: SessionAutomationDeps, id: string): Promise<ResolvedTab | null> => {
  const { cdpClient } = deps;
  if (!cdpClient) return null;
  const sidParam = `sid=${encodeURIComponent(id)}`;
  const existing = await cdpClient.findTargetByUrl((url) => url.includes(sidParam));
  const targetId = existing ?? (await cdpClient.openBackgroundTab(deps.buildTabUrl(id)));
  if (!targetId) return null;
  const cdpSessionId = await cdpClient.attachSession(targetId);
  if (!cdpSessionId) {
    if (!existing) await cdpClient.closeTab(targetId);
    return null;
  }
  return {
    targetId,
    cdpSessionId,
    close: existing ? async () => undefined : async () => cdpClient.closeTab(targetId),
  };
};

// Wait for the tab's xterm to render the session's current pane text. Robust
// against xterm's async write: polls the tab's `__localtermPaneText` and
// compares to the server-side `capturePane` (flushed, the source of truth) —
// when they're equal the grid is fully parsed; a short settle covers the
// canvas paint. Returns true on land, false on timeout (caller screenshots
// anyway, best effort).
const waitForRenderLanded = async (
  cdpClient: CdpClient,
  cdpSessionId: string,
  registry: SessionManager,
  id: string,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  const expr = `window[${JSON.stringify(LOCALTERM_PANE_TEXT_PROPERTY)}]?.() ?? null`;
  while (Date.now() < deadline) {
    const expected = await registry.capturePane(id).catch(() => null);
    const tabText = await cdpClient.evaluateInSession(cdpSessionId, expr);
    if (expected !== null && tabText === expected) {
      await sleep(CDP_RENDER_LANDED_SETTLE_MS);
      return true;
    }
    await sleep(CDP_RENDER_LANDED_POLL_INTERVAL_MS);
  }
  return false;
};

// `capture-pane --png`: render the session's current screen to a PNG via the
// browser. Reuses an existing viewer tab or opens an ephemeral one; clips to
// the `.xterm` element so the PNG is just the terminal. Returns the PNG bytes,
// or null when no browser is reachable (the caller reports `no_browser`; text
// `capture-pane` still works headlessly via the capture renderer).
export const capturePanePng = async (
  deps: SessionAutomationDeps,
  registry: SessionManager,
  id: string,
): Promise<Buffer | null> => {
  const { cdpClient } = deps;
  if (!cdpClient) return null;
  const tab = await resolveTab(deps, id);
  if (!tab) return null;
  try {
    await waitForRenderLanded(cdpClient, tab.cdpSessionId, registry, id, CDP_SCREENSHOT_TIMEOUT_MS);
    const clipExpr = `(() => {
      const el = document.querySelector(".xterm");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height });
    })()`;
    const clipRaw = await cdpClient.evaluateInSession(tab.cdpSessionId, clipExpr);
    const clip =
      typeof clipRaw === "string"
        ? (JSON.parse(clipRaw) as { x: number; y: number; width: number; height: number })
        : undefined;
    return cdpClient.captureScreenshotInSession(tab.cdpSessionId, clip);
  } finally {
    await tab.close();
  }
};

interface MouseTarget {
  col: number;
  row: number;
}

interface MouseActionBase {
  button: MouseButton;
}

interface MouseClickColRow extends MouseActionBase {
  action: "click";
  col: number;
  row: number;
  clicks: number;
}

interface MouseClickText extends MouseActionBase {
  action: "click";
  onText: string;
  clicks: number;
}

interface MouseDrag extends MouseActionBase {
  action: "drag";
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

interface MouseMove {
  action: "move";
  col: number;
  row: number;
}

interface MouseScroll {
  action: "scroll";
  direction: "up" | "down";
  amount: number;
  col: number;
  row: number;
}

export type MouseAction = MouseClickColRow | MouseClickText | MouseDrag | MouseMove | MouseScroll;

export interface MouseResult {
  ok: boolean;
  // How the gesture was delivered: "cdp" (via a viewer/ephemeral tab's xterm.js)
  // or "sgr" (direct SGR-1006 bytes, the headless fallback). Lets an agent tell
  // when a click reached a real xterm vs. was synthesized.
  mode: "cdp" | "sgr";
  // Resolved viewport coords (1-indexed for SGR; null when the gesture had no
  // single target, e.g. a scroll the app may place anywhere).
  col: number | null;
  row: number | null;
  // The label text that was found, for `--on-text`; null otherwise.
  text: string | null;
  // "disabled" when the session has no mouse mode on AND no CDP tab was
  // available (the SGR bytes would be wasted on an app that can't read them).
  reason: string | null;
}

// `session mouse`: dispatch a mouse gesture. Primary path is CDP — drive the
// browser's xterm.js, which generates the SGR sequence itself, so drag/scroll/
// click-count semantics are exactly right with no encoder. Falls back to
// direct SGR-1006 bytes written to the PTY when no browser is reachable (the
// true-headless case), gated on the session's mouse mode so the bytes aren't
// fed to an app that didn't enable mouse.
export const sendMouse = async (
  deps: SessionAutomationDeps,
  registry: SessionManager,
  id: string,
  action: MouseAction,
  // Headless SGR fallback (injected from the route to avoid a circular import
  // of the encoder here): writes the encoded sequence to the session PTY.
  sgrFallback: (id: string, action: MouseAction, col: number, row: number) => boolean,
): Promise<MouseResult> => {
  const { cdpClient } = deps;
  // Resolve the target cell for any coord-bearing action. `--on-text` reads the
  // server-side capture grid (no tab needed) so the fallback path can also
  // locate a label.
  let target: MouseTarget | null = null;
  let labelText: string | null = null;
  if (action.action === "click" && "onText" in action) {
    const found = await registry.findTextInViewport(id, action.onText);
    if (!found) {
      return {
        ok: false,
        mode: "sgr",
        col: null,
        row: null,
        text: action.onText,
        reason: "text_not_found",
      };
    }
    target = found;
    labelText = action.onText;
  } else if ("col" in action && "row" in action) {
    target = { col: action.col, row: action.row };
  }

  // Try the CDP path first: dispatch through the tab's xterm.js.
  if (cdpClient) {
    const tab = await resolveTab(deps, id);
    if (tab) {
      try {
        await waitForRenderLanded(cdpClient, tab.cdpSessionId, registry, id, CDP_MOUSE_TIMEOUT_MS);
        const cellsExpr = `window[${JSON.stringify(LOCALTERM_MOUSE_CELLS_PROPERTY)}]?.() ?? null`;
        const cellsRaw = await cdpClient.evaluateInSession(tab.cdpSessionId, cellsExpr);
        const cells =
          typeof cellsRaw === "string"
            ? (JSON.parse(cellsRaw) as {
                left: number;
                top: number;
                cellWidth: number;
                cellHeight: number;
                cols: number;
                rows: number;
              } | null)
            : null;
        if (!cells) {
          return {
            ok: false,
            mode: "cdp",
            col: null,
            row: null,
            text: labelText,
            reason: "no_xterm",
          };
        }
        // Coords for scroll: default to the viewport center so the wheel lands
        // on the terminal even when the caller didn't specify a cell.
        const t = target ?? { col: Math.floor(cells.cols / 2), row: Math.floor(cells.rows / 2) };
        if (t.col < 0 || t.col >= cells.cols || t.row < 0 || t.row >= cells.rows) {
          return {
            ok: false,
            mode: "cdp",
            col: t.col,
            row: t.row,
            text: labelText,
            reason: "out_of_bounds",
          };
        }
        const px = (col: number, row: number): { x: number; y: number } => ({
          x: cells.left + (col + 0.5) * cells.cellWidth,
          y: cells.top + (row + 0.5) * cells.cellHeight,
        });
        const buttonName =
          action.action === "click" || action.action === "drag" ? action.button : "left";
        const events: Parameters<typeof cdpClient.dispatchMouseEventsInSession>[1] = [];
        if (action.action === "click") {
          const at = px(t.col, t.row);
          for (let i = 0; i < action.clicks; i++) {
            events.push({ type: "mousePressed", ...at, button: buttonName, clickCount: 1 });
          }
          events.push({
            type: "mouseReleased",
            ...at,
            button: buttonName,
            clickCount: action.clicks,
          });
        } else if (action.action === "drag") {
          const from = px(action.fromCol, action.fromRow);
          const to = px(action.toCol, action.toRow);
          events.push({ type: "mousePressed", ...from, button: buttonName, clickCount: 1 });
          events.push({ type: "mouseMoved", ...to, button: buttonName, buttons: 1 });
          events.push({ type: "mouseReleased", ...to, button: buttonName, clickCount: 1 });
        } else if (action.action === "move") {
          const at = px(t.col, t.row);
          events.push({ type: "mouseMoved", ...at, button: "none" });
        } else {
          const at = px(t.col, t.row);
          const delta = action.direction === "up" ? -action.amount : action.amount;
          events.push({
            type: "mouseWheel",
            ...at,
            deltaX: 0,
            deltaY: delta * Math.max(cells.cellHeight, 1),
          });
        }
        await cdpClient.dispatchMouseEventsInSession(tab.cdpSessionId, events);
        // CDP dispatch via xterm.js always "succeeds" from our view — whether the
        // app responds depends on its mouse mode, which xterm gates internally.
        return { ok: true, mode: "cdp", col: t.col, row: t.row, text: labelText, reason: null };
      } finally {
        await tab.close();
      }
    }
  }

  // Headless fallback: write SGR-1006 bytes straight to the PTY. Gated on the
  // session's mouse mode so the bytes aren't fed to an app that can't read them.
  if (!registry.mouseEnabledFor(id)) {
    return {
      ok: false,
      mode: "sgr",
      col: target?.col ?? null,
      row: target?.row ?? null,
      text: labelText,
      reason: "mouse_disabled",
    };
  }
  // Scroll needs a cell to anchor the SGR event; default to viewport center.
  const fallbackTarget = target ?? { col: 0, row: 0 };
  const written = sgrFallback(id, action, fallbackTarget.col, fallbackTarget.row);
  return {
    ok: written,
    mode: "sgr",
    col: fallbackTarget.col,
    row: fallbackTarget.row,
    text: labelText,
    reason: written ? null : "not_found",
  };
};
