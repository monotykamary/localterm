import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { buildWebSocketUrl } from "@/lib/api";
import {
  DEFAULT_DOCUMENT_TITLE,
  RECONNECT_DELAY_MS,
  RESIZE_DEBOUNCE_MS,
  TERMINAL_BACKGROUND_HEX,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCROLLBACK_LINES,
  WS_CLOSE_SESSION_NOT_FOUND,
} from "@/lib/constants";
import { serverToClientMessageSchema } from "@/lib/schemas";
import type { ClientToServerMessage } from "@/lib/types";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
}

const TERMINAL_THEME_VESPER = {
  background: TERMINAL_BACKGROUND_HEX,
  foreground: "#ffffff",
  cursor: "#ffc799",
  cursorAccent: TERMINAL_BACKGROUND_HEX,
  selectionBackground: "#2a2a2a",
  selectionForeground: "#ffffff",
  black: TERMINAL_BACKGROUND_HEX,
  red: "#ff8080",
  green: "#99ffe4",
  yellow: "#ffc799",
  blue: "#a0a0a0",
  magenta: "#ffc799",
  cyan: "#99ffe4",
  white: "#ffffff",
  brightBlack: "#505050",
  brightRed: "#ff9999",
  brightGreen: "#b3ffe4",
  brightYellow: "#ffd1a8",
  brightBlue: "#b0b0b0",
  brightMagenta: "#ffc799",
  brightCyan: "#66ddcc",
  brightWhite: "#ffffff",
};

const TERMINAL_FONT_FAMILY =
  '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const reloadToFreshSession = () => {
  window.location.assign(window.location.pathname);
};

export const Terminal = ({ sessionId }: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let resizeTimer: number | null = null;

    void document.fonts.load(`${TERMINAL_FONT_SIZE_PX}px "Geist Mono"`).catch(() => {});

    const terminal = new XtermTerminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE_PX,
      lineHeight: TERMINAL_LINE_HEIGHT,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: TERMINAL_THEME_VESPER,
      macOptionIsMeta: true,
      scrollOnUserInput: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new ClipboardAddon());
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = "11";

    terminal.open(container);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      /* webgl unavailable; xterm falls back to canvas */
    }

    const send = (message: ClientToServerMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const sendResize = (cols: number, rows: number) => send({ type: "resize", cols, rows });

    const fitToContainer = () => {
      try {
        fit.fit();
        sendResize(terminal.cols, terminal.rows);
      } catch {
        /* container not yet measured */
      }
    };

    const scheduleFit = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        fitToContainer();
      }, RESIZE_DEBOUNCE_MS);
    };

    terminal.onData((data) => send({ type: "input", data }));
    terminal.onResize(({ cols, rows }) => sendResize(cols, rows));

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    fitToContainer();
    terminal.focus();

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(buildWebSocketUrl(sessionId));

      socket.addEventListener("open", () => sendResize(terminal.cols, terminal.rows));

      socket.addEventListener("message", (event) => {
        if (disposed) return;
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
          document.title = message.title || DEFAULT_DOCUMENT_TITLE;
        } else if (message.type === "output") {
          terminal.write(message.data);
        } else if (message.type === "title") {
          document.title = message.title || DEFAULT_DOCUMENT_TITLE;
        } else if (message.type === "exit") {
          reloadToFreshSession();
        }
      });

      socket.addEventListener("close", (event) => {
        socket = null;
        if (disposed) return;
        if (event.code === WS_CLOSE_SESSION_NOT_FOUND) {
          reloadToFreshSession();
          return;
        }
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });

      socket.addEventListener("error", () => {
        try {
          socket?.close();
        } catch {
          /* socket already closing */
        }
      });
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      observer.disconnect();
      try {
        socket?.close();
      } catch {
        /* socket already closed */
      }
      socket = null;
      terminal.dispose();
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [sessionId]);

  return (
    <div className="relative h-dvh w-dvw" style={{ background: TERMINAL_BACKGROUND_HEX }}>
      <div ref={containerRef} aria-label="terminal session" className="h-full w-full" />
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="open new shell in a new browser tab"
        title="new shell (opens in a new browser tab)"
        className="absolute top-1 right-1 grid size-9 select-none place-items-center rounded-md font-mono text-xl leading-none text-white/40 transition-colors hover:bg-white/25 hover:text-white focus-visible:bg-white/25 focus-visible:text-white focus-visible:outline-none active:bg-white/35"
      >
        +
      </a>
    </div>
  );
};
