import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildWebSocketUrl } from "@/lib/api";
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RESIZE_DEBOUNCE_MS,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCROLLBACK_LINES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_SESSION_NOT_FOUND,
} from "@/lib/constants";
import { serverToClientMessageSchema } from "@/lib/schemas";
import type { ClientToServerMessage } from "@/lib/types";
import { useSessions } from "@/lib/use-sessions";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  sessionId: string;
  isActive: boolean;
}

const TERMINAL_THEME_DARK = {
  background: "#0a0a0a",
  foreground: "#ededed",
  cursor: "#ededed",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#3f3f46",
  black: "#0a0a0a",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#fafafa",
};

export const TerminalView = ({ sessionId, isActive }: TerminalViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const isDisposedRef = useRef(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "closed" | "gone">(
    "connecting",
  );

  const patchTitle = useSessions((state) => state.patchTitle);
  const markExited = useSessions((state) => state.markExited);
  const removeLocal = useSessions((state) => state.removeLocal);
  const refresh = useSessions((state) => state.refresh);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientToServerMessage = { type: "input", data };
    ws.send(JSON.stringify(message));
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientToServerMessage = { type: "resize", cols, rows };
    ws.send(JSON.stringify(message));
  }, []);

  const performFit = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal) return;
    try {
      fit.fit();
      sendResize(terminal.cols, terminal.rows);
    } catch {
      /* container not measured yet */
    }
  }, [sendResize]);

  const scheduleFit = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      performFit();
    }, RESIZE_DEBOUNCE_MS);
  }, [performFit]);

  useEffect(() => {
    if (!containerRef.current) return;
    isDisposedRef.current = false;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', Consolas, monospace",
      fontSize: TERMINAL_FONT_SIZE_PX,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: TERMINAL_THEME_DARK,
      macOptionIsMeta: true,
      allowTransparency: false,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new ClipboardAddon());
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = "11";

    terminal.open(containerRef.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      /* webgl unavailable; canvas/dom fallback is fine */
    }

    terminal.onData((data) => sendInput(data));
    terminal.onResize(({ cols, rows }) => sendResize(cols, rows));

    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    scheduleFit();

    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(containerRef.current);
    resizeObserverRef.current = observer;

    let attempt = 0;
    const connect = () => {
      if (isDisposedRef.current) return;
      attempt += 1;
      setConnectionState("connecting");
      const ws = new WebSocket(buildWebSocketUrl(sessionId));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        attempt = 0;
        setConnectionState("open");
        sendResize(terminal.cols, terminal.rows);
      });

      ws.addEventListener("message", (event) => {
        let raw: unknown;
        try {
          raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        const parsed = serverToClientMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "snapshot") {
          terminal.reset();
          terminal.write(message.data);
          patchTitle(sessionId, message.title);
        } else if (message.type === "output") {
          terminal.write(message.data);
        } else if (message.type === "title") {
          patchTitle(sessionId, message.title);
        } else if (message.type === "exit") {
          markExited(sessionId, message.code);
        }
      });

      ws.addEventListener("close", (event) => {
        wsRef.current = null;
        if (isDisposedRef.current) return;
        if (event.code === WS_CLOSE_SESSION_NOT_FOUND) {
          setConnectionState("gone");
          void refresh().then(() => {
            const stillExists = useSessions
              .getState()
              .sessions.some((session) => session.id === sessionId);
            if (!stillExists) removeLocal(sessionId);
          });
          return;
        }
        const isBackpressure = event.code === WS_CLOSE_BACKPRESSURE;
        setConnectionState("closed");
        const baseDelay = isBackpressure ? 0 : RECONNECT_BASE_DELAY_MS * attempt;
        const delay = Math.min(baseDelay, RECONNECT_MAX_DELAY_MS);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          /* socket already errored into closed state */
        }
      });
    };
    connect();

    return () => {
      isDisposedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      try {
        wsRef.current?.close();
      } catch {
        /* socket already torn down */
      }
      wsRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [sessionId, sendInput, sendResize, scheduleFit, patchTitle, markExited, removeLocal, refresh]);

  useEffect(() => {
    if (!isActive) return;
    const focusHandle = window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
      scheduleFit();
    });
    return () => window.cancelAnimationFrame(focusHandle);
  }, [isActive, scheduleFit]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowSearch(true);
      } else if (event.key === "Escape" && showSearch) {
        event.preventDefault();
        setShowSearch(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, showSearch]);

  const findNext = useCallback(() => {
    searchRef.current?.findNext(searchQuery, { incremental: false });
  }, [searchQuery]);

  const findPrev = useCallback(() => {
    searchRef.current?.findPrevious(searchQuery, { incremental: false });
  }, [searchQuery]);

  const overlay = useMemo(() => {
    if (connectionState === "connecting") return "connecting…";
    if (connectionState === "closed") return "reconnecting…";
    if (connectionState === "gone") return "session ended";
    return null;
  }, [connectionState]);

  return (
    <div
      className="relative h-full w-full bg-[#0a0a0a]"
      style={{ display: isActive ? "block" : "none" }}
      role="tabpanel"
      id={`terminal-panel-${sessionId}`}
      aria-label="terminal session"
    >
      <div ref={containerRef} className="h-full w-full" />
      {overlay ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs text-zinc-200 backdrop-blur"
        >
          {overlay}
        </div>
      ) : null}
      {showSearch ? (
        <div
          role="search"
          className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-popover/95 p-1 shadow backdrop-blur"
        >
          <Search aria-hidden="true" className="ml-1 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) findPrev();
                else findNext();
              }
            }}
            placeholder="find"
            aria-label="search terminal output"
            className="h-7 w-48 border-0 bg-transparent px-1 focus-visible:ring-0"
          />
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => findPrev()}
            aria-label="previous match"
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => findNext()} aria-label="next match">
            <ChevronDown aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setShowSearch(false)}
            aria-label="close search"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
};
