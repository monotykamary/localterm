import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Terminal } from "../../src/components/terminal";
import {
  DEFAULT_MUTE_EMOJI_COLORS,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO,
  LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
  RECONNECT_DELAY_MS,
  TERMINAL_CURSOR_BLINK_STORAGE_KEY,
  TERMINAL_CURSOR_STYLE_STORAGE_KEY,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_STORAGE_KEY,
  TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY,
  TERMINAL_SCROLLBACK_STORAGE_KEY,
  TERMINAL_TAB_SEQUENCE,
  TERMINAL_BACK_TAB_SEQUENCE,
  TERMINAL_CURSOR_LINE_END_SEQUENCE,
  TERMINAL_CURSOR_LINE_START_SEQUENCE,
  TERMINAL_DELETE_TO_LINE_START_SEQUENCE,
  KITTY_KEYBOARD_DISAMBIGUATE_FLAG,
  KITTY_KEYBOARD_REPORT_EVENT_TYPES_FLAG,
  LIGATURES_ENABLED_STORAGE_KEY,
  MUTE_EMOJI_COLORS_STORAGE_KEY,
  MOBILE_RESUME_STORAGE_KEY,
  DEFAULT_CWD_STORAGE_KEY,
  CUSTOM_FONT_FAMILY_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  TERMINAL_FONT_STORAGE_KEY,
  TERMINAL_THEME_STORAGE_KEY,
} from "../../src/lib/constants";
import { DEFAULT_TERMINAL_CURSOR_STYLE } from "../../src/lib/terminal-cursor";
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from "../../src/lib/terminal-scrollback";
import { CUSTOM_FONT_ID } from "../../src/lib/terminal-fonts";
import { setTabFaviconState } from "@/utils/set-tab-favicon-state";
import { FRESH_SESSION_QUERY_PARAM } from "@/utils/fresh-session-query-param";

interface FakeWebSocketHandle {
  url: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fireOpen: () => void;
  fireMessage: (payload: unknown) => void;
  fireClose: (code?: number, reason?: string, wasClean?: boolean) => void;
  fireError: () => void;
}

interface FakeCsiHandlerEntry {
  prefix: string | undefined;
  final: string;
  callback: (params: (number | number[])[]) => boolean | Promise<boolean>;
}

interface FakeXtermHandle {
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null;
  customWheelEventHandler: ((event: WheelEvent) => boolean) | null;
  fireTitleChange: (title: string) => void;
  fireData: (data: string) => void;
  fireTerminalResponse: (data: string) => void;
  getOptions: () => Record<string, unknown>;
  setBufferState: (state: { baseY: number; viewportY: number }) => void;
  scrollLines: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  registerCharacterJoiner: ReturnType<typeof vi.fn>;
  deregisterCharacterJoiner: ReturnType<typeof vi.fn>;
  invokeCsiHandler: (prefix: string | undefined, final: string, params: number[]) => boolean;
}

interface FakeSearchAddonHandle {
  findNext: ReturnType<typeof vi.fn>;
  findPrevious: ReturnType<typeof vi.fn>;
  clearDecorations: ReturnType<typeof vi.fn>;
  fireResults: (results: { resultIndex: number; resultCount: number }) => void;
}

interface FakeWebglAddonOptions {
  muteEmojiColors?: boolean;
}

interface FakeWebglAddonHandle {
  muteEmojiColors: boolean | undefined;
  setEmojiColorsMuted: ReturnType<typeof vi.fn>;
}

interface KeyboardModifiers {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

interface DispatchedKeyResult {
  preventDefaultCalls: number;
  handlerResult: boolean;
}

const fakeWebSockets: FakeWebSocketHandle[] = [];
const fakeXterms: FakeXtermHandle[] = [];
const fakeSearchAddons: FakeSearchAddonHandle[] = [];
const fakeWebglAddons: FakeWebglAddonHandle[] = [];

const installFakeWebSocket = () => {
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState: number = FakeWebSocket.CONNECTING;
    private listeners = new Map<string, Set<(event: unknown) => void>>();

    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = FakeWebSocket.CLOSED;
    });

    constructor(url: string) {
      this.url = url;
      fakeWebSockets.push({
        url,
        send: this.send,
        close: this.close,
        fireOpen: () => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch("open", {});
        },
        fireMessage: (payload) => {
          // Output frames travel as binary ArrayBuffers to match the production wire
          // format. Tests don't send a {compress} frame, so negotiatedCompressMode
          // stays null and the binary handler reads frames as raw (no header byte) —
          // exactly the back-compat/old-server path. Everything else goes out as JSON.
          if (
            typeof payload === "object" &&
            payload !== null &&
            (payload as Record<string, unknown>).type === "output"
          ) {
            const data = (payload as { data: string }).data;
            this.dispatch("message", { data: new TextEncoder().encode(data).buffer });
            return;
          }
          this.dispatch("message", { data: JSON.stringify(payload) });
        },
        fireClose: (code = 1006, reason = "", wasClean = false) => {
          this.readyState = FakeWebSocket.CLOSED;
          this.dispatch("close", { code, reason, wasClean });
        },
        fireError: () => {
          this.dispatch("error", {});
        },
      });
    }

    addEventListener(name: string, handler: (event: unknown) => void): void {
      const set = this.listeners.get(name) ?? new Set();
      set.add(handler);
      this.listeners.set(name, set);
    }

    private dispatch(name: string, event: unknown): void {
      const set = this.listeners.get(name);
      if (!set) return;
      for (const handler of set) handler(event);
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
};

vi.mock("@xterm/xterm", () => {
  class FakeXtermTerminal {
    cols = 80;
    rows = 24;
    unicode = { activeVersion: "11", register: () => {} };
    options: Record<string, unknown> = {};
    buffer = { active: { baseY: 0, viewportY: 0 } };
    scrollLines = vi.fn();
    scrollToBottom = vi.fn();
    selectAll = vi.fn();
    write = vi.fn((_data: string, callback?: () => void) => callback?.());
    focus = vi.fn();
    registerCharacterJoiner = vi.fn((_handler: (text: string) => [number, number][]) => 1);
    deregisterCharacterJoiner = vi.fn((_joinerId: number) => {});
    private titleListeners = new Set<(title: string) => void>();
    private dataListeners = new Set<(data: string) => void>();
    private userInputListeners = new Set<() => void>();
    private csiHandlers: FakeCsiHandlerEntry[] = [];
    private handle: FakeXtermHandle;

    parser = {
      registerCsiHandler: (
        id: { prefix?: string; final: string },
        callback: (params: (number | number[])[]) => boolean | Promise<boolean>,
      ) => {
        const entry: FakeCsiHandlerEntry = { prefix: id.prefix, final: id.final, callback };
        this.csiHandlers.push(entry);
        return {
          dispose: () => {
            const indexToRemove = this.csiHandlers.indexOf(entry);
            if (indexToRemove !== -1) this.csiHandlers.splice(indexToRemove, 1);
          },
        };
      },
    };

    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options };
      this.handle = {
        customKeyEventHandler: null,
        customWheelEventHandler: null,
        fireTitleChange: (title: string) => {
          for (const listener of this.titleListeners) listener(title);
        },
        fireData: (data: string) => {
          for (const listener of this.userInputListeners) listener();
          for (const listener of this.dataListeners) listener(data);
        },
        fireTerminalResponse: (data: string) => {
          for (const listener of this.dataListeners) listener(data);
        },
        getOptions: () => this.options,
        setBufferState: ({ baseY, viewportY }) => {
          this.buffer = { active: { baseY, viewportY } };
        },
        scrollLines: this.scrollLines,
        scrollToBottom: this.scrollToBottom,
        selectAll: this.selectAll,
        write: this.write,
        focus: this.focus,
        registerCharacterJoiner: this.registerCharacterJoiner,
        deregisterCharacterJoiner: this.deregisterCharacterJoiner,
        invokeCsiHandler: (prefix, final, params) => {
          for (let entryIndex = this.csiHandlers.length - 1; entryIndex >= 0; entryIndex -= 1) {
            const entry = this.csiHandlers[entryIndex];
            if (!entry) continue;
            if (entry.prefix === prefix && entry.final === final) {
              const result = entry.callback(params);
              if (typeof result === "boolean" && result) return true;
            }
          }
          return false;
        },
      };
      fakeXterms.push(this.handle);
    }

    _core = {
      _charSizeService: { measure: () => {} },
      unicodeService: {
        _activeProvider: {
          version: "15-graphemes",
          wcwidth: (_codepoint: number): 0 | 1 | 2 => 1,
          charProperties: (_codepoint: number, _preceding: number) => 0,
        },
      },
      coreService: {
        onUserInput: (listener: () => void) => {
          this.userInputListeners.add(listener);
          return { dispose: () => this.userInputListeners.delete(listener) };
        },
      },
    };

    loadAddon = () => {};
    open = () => {};
    refresh = () => {};
    onData = (handler: (data: string) => void) => {
      this.dataListeners.add(handler);
      return { dispose: () => this.dataListeners.delete(handler) };
    };
    onResize = () => ({ dispose: () => {} });
    onScroll = () => ({ dispose: () => {} });
    onWriteParsed = () => ({ dispose: () => {} });
    onTitleChange = (handler: (title: string) => void) => {
      this.titleListeners.add(handler);
      return { dispose: () => this.titleListeners.delete(handler) };
    };
    attachCustomKeyEventHandler = (handler: (event: KeyboardEvent) => boolean) => {
      this.handle.customKeyEventHandler = handler;
    };
    attachCustomWheelEventHandler = (handler: (event: WheelEvent) => boolean) => {
      this.handle.customWheelEventHandler = handler;
    };
    reset = () => {};
    clearTextureAtlas = () => {};
    dispose = () => {};
  }
  return { Terminal: FakeXtermTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class FakeFitAddon {
    fit = () => {};
  }
  return { FitAddon: FakeFitAddon };
});

vi.mock("@xterm/addon-clipboard", () => {
  class FakeClipboardAddon {}
  return { ClipboardAddon: FakeClipboardAddon };
});

vi.mock("@xterm/addon-unicode-graphemes", () => {
  class FakeUnicodeGraphemesAddon {}
  return { UnicodeGraphemesAddon: FakeUnicodeGraphemesAddon };
});

vi.mock("@xterm/addon-web-links", () => {
  class FakeWebLinksAddon {}
  return { WebLinksAddon: FakeWebLinksAddon };
});

vi.mock("@xterm/addon-webgl", () => {
  class FakeWebglAddon {
    setEmojiColorsMuted = vi.fn();
    onContextLoss = () => {};
    dispose = () => {};

    constructor(options?: FakeWebglAddonOptions) {
      fakeWebglAddons.push({
        muteEmojiColors: options?.muteEmojiColors,
        setEmojiColorsMuted: this.setEmojiColorsMuted,
      });
    }
  }
  return { WebglAddon: FakeWebglAddon };
});

vi.mock("@xterm/addon-search", () => {
  class FakeSearchAddon {
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
    private resultsListener: ((r: { resultIndex: number; resultCount: number }) => void) | null =
      null;

    constructor() {
      fakeSearchAddons.push({
        findNext: this.findNext,
        findPrevious: this.findPrevious,
        clearDecorations: this.clearDecorations,
        fireResults: (results) => this.resultsListener?.(results),
      });
    }

    onDidChangeResults = (handler: (r: { resultIndex: number; resultCount: number }) => void) => {
      this.resultsListener = handler;
      return { dispose: () => {} };
    };
    dispose = () => {};
  }
  return { SearchAddon: FakeSearchAddon };
});

vi.mock("@xterm/addon-image", () => {
  class FakeImageAddon {
    dispose = () => {};
  }
  return { ImageAddon: FakeImageAddon };
});

vi.mock("@xterm/addon-progress", () => {
  class FakeProgressAddon {
    dispose = () => {};
  }
  return { ProgressAddon: FakeProgressAddon };
});

vi.mock("@/utils/set-tab-favicon-state", () => ({
  setTabFaviconState: vi.fn(),
}));

const stubBrowserGlobals = () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: () => Promise.resolve([]) },
  });
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  vi.stubGlobal("open", vi.fn());
  vi.stubGlobal("close", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
  );
};

const installTouchMatchMedia = () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

const dispatchFindShortcut = (handle: FakeXtermHandle | undefined): boolean | undefined => {
  if (!handle?.customKeyEventHandler) return undefined;
  const event = new KeyboardEvent("keydown", { key: "f", metaKey: true });
  Object.defineProperty(event, "preventDefault", { value: vi.fn() });
  return handle.customKeyEventHandler(event);
};

// Decode the last terminal.write() call's first arg to a string. Production
// xterm accepts string | Uint8Array interchangeably (string = UTF-16, bytes =
// UTF-8); our binary WS path always hands xterm a Uint8Array, but the test
// assertions compare against the original UTF-8 string for readability.
const lastWriteArgAsString = (handle: FakeXtermHandle | undefined): string | undefined => {
  const arg = handle?.write.mock.calls.at(-1)?.[0];
  if (typeof arg === "string") return arg;
  if (arg instanceof Uint8Array) return new TextDecoder().decode(arg);
  return undefined;
};

const originalNavigatorPlatform = navigator.platform;

beforeEach(() => {
  fakeWebSockets.length = 0;
  fakeXterms.length = 0;
  fakeSearchAddons.length = 0;
  fakeWebglAddons.length = 0;
  stubBrowserGlobals();
  installFakeWebSocket();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: originalNavigatorPlatform,
  });
});

describe("Terminal modal", () => {
  it("does not show the lost-connection modal until two consecutive WebSocket closes", () => {
    render(<Terminal />);

    expect(fakeWebSockets).toHaveLength(1);
    expect(screen.queryByText(/Lost connection/i)).toBeNull();

    act(() => {
      fakeWebSockets[0]?.fireClose();
    });
    expect(screen.queryByText(/Lost connection/i)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(fakeWebSockets).toHaveLength(2);

    act(() => {
      fakeWebSockets[1]?.fireClose();
    });
    expect(screen.queryByText(/Lost connection/i)).not.toBeNull();
  });

  it("closes the lost-connection modal when the WebSocket reconnects successfully", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireClose();
      vi.advanceTimersByTime(1500);
      fakeWebSockets[1]?.fireClose();
    });
    expect(screen.queryByText(/Lost connection/i)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
      fakeWebSockets[2]?.fireOpen();
    });
    expect(screen.queryByText(/Lost connection/i)).toBeNull();
  });

  it("renders the dead-pill and 'Shell ended' modal when the server reports a non-zero exit", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "exit", code: 137 });
    });
    expect(screen.queryByText(/Shell ended/i)).not.toBeNull();
    expect(screen.queryByText(/exited · code 137/i)).not.toBeNull();
  });

  it("closes the tab on clean exit and falls back to the 'Shell ended' modal", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "exit", code: 0 });
    });
    expect(globalThis.close).toHaveBeenCalled();
    expect(screen.queryByText(/Shell ended/i)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText(/Shell ended/i)).not.toBeNull();
  });

  it("renders the 'Connection lost' modal (not 'Shell ended') when the WebSocket drops mid-session", () => {
    // Regression: previously any post-connect WS close was misreported as the
    // shell exiting, so users saw "Shell ended / Open a new shell" with no
    // hint that the actual cause was a transport-level disconnect (sleep,
    // network blip, daemon restart). The two failure modes now have distinct
    // modals and the close code is surfaced for diagnostics.
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireClose(4429, "backpressure");
    });
    expect(screen.queryByText(/Shell ended/i)).toBeNull();
    expect(screen.queryByText(/Connection lost/i)).not.toBeNull();
    expect(screen.queryByText(/close code 4429/i)).not.toBeNull();
    expect(screen.queryByText(/backpressure/i)).not.toBeNull();
    expect(screen.queryByText(/disconnected · code 4429/i)).not.toBeNull();
  });

  it("blocks the auto-reconnect loop after the shell exits", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "exit", code: 0 });
      fakeWebSockets[0]?.fireClose();
      vi.advanceTimersByTime(5000);
    });
    expect(fakeWebSockets).toHaveLength(1);
  });

  it("blocks the auto-reconnect loop after the WebSocket drops mid-session (no auto-respawn)", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireClose(1006);
      vi.advanceTimersByTime(5000);
    });
    expect(fakeWebSockets).toHaveLength(1);
  });

  it("clicking 'Reconnect' on the connection-lost modal opens a fresh WebSocket in-place", () => {
    // The auto-reconnect loop is intentionally blocked after a mid-session
    // drop, but the user must still be able to recover without losing the tab
    // (and its xterm scrollback). Reconnect closes the dead state and opens
    // the next WS; the server spawns a fresh PTY for it.
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireClose(1006);
    });
    expect(fakeWebSockets).toHaveLength(1);
    expect(screen.queryByText(/Connection lost/i)).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Reconnect/i }));
    });
    expect(fakeWebSockets).toHaveLength(2);
    expect(screen.queryByText(/Connection lost/i)).toBeNull();
  });
});

describe("Terminal title", () => {
  it("propagates server title messages into document.title for the browser tab", () => {
    render(<Terminal />);

    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "title", title: "vim foo.ts" });
    });
    expect(document.title).toBe("vim foo.ts");
  });

  it("ignores xterm onTitleChange events in favor of server title messages", () => {
    render(<Terminal />);

    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeXterms[0]?.fireTitleChange("user@host:~/projects");
    });
    expect(document.title).toBe("localterm");
  });
});

describe("Terminal Cmd+F search", () => {
  it("opens the find overlay when the find shortcut fires", () => {
    render(<Terminal />);
    expect(screen.queryByRole("search")).toBeNull();

    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    expect(screen.queryByRole("search")).not.toBeNull();
  });

  it("returns false from the key event handler so xterm does not eat the 'f'", () => {
    render(<Terminal />);
    let handlerResult: boolean | undefined;
    act(() => {
      handlerResult = dispatchFindShortcut(fakeXterms[0]);
    });
    expect(handlerResult).toBe(false);
  });

  it("typing in the find input calls SearchAddon.findNext with the query", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    const input = screen.getByLabelText("find query") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "build" } });
    });

    expect(fakeSearchAddons[0]?.findNext).toHaveBeenCalledWith(
      "build",
      expect.objectContaining({ decorations: expect.any(Object) }),
    );
  });

  it("Enter advances to the next match and Shift+Enter goes back", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    const input = screen.getByLabelText("find query") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "needle" } });
    });

    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(fakeSearchAddons[0]?.findNext).toHaveBeenCalledTimes(2);

    act(() => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });
    expect(fakeSearchAddons[0]?.findPrevious).toHaveBeenCalledWith(
      "needle",
      expect.objectContaining({ decorations: expect.any(Object) }),
    );
  });

  it("Escape closes the find overlay and clears decorations", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });
    const input = screen.getByLabelText("find query") as HTMLInputElement;

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByRole("search")).toBeNull();
    expect(fakeSearchAddons[0]?.clearDecorations).toHaveBeenCalled();
  });

  it("renders the match counter from onDidChangeResults", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    act(() => {
      fakeSearchAddons[0]?.fireResults({ resultIndex: 2, resultCount: 7 });
    });

    expect(screen.getByText("3/7")).toBeDefined();
  });

  it("focuses and selects the find input on first open", () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");

    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    expect(focusSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();
  });

  it("re-pressing the find shortcut re-selects the existing query while keeping it intact", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    const input = screen.getByLabelText("find query") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "needle" } });
    });

    const focusSpy = vi.spyOn(input, "focus");
    const selectSpy = vi.spyOn(input, "select");

    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    expect(focusSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();
    expect(input.value).toBe("needle");
  });

  it("intercepts Cmd+F inside the find input so the browser's native find bar stays out", () => {
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });

    const input = screen.getByLabelText("find query") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "needle" } });
    });

    const selectSpy = vi.spyOn(input, "select");
    const wasNotPrevented = fireEvent.keyDown(input, { key: "f", metaKey: true });

    expect(selectSpy).toHaveBeenCalled();
    expect(wasNotPrevented).toBe(false);
    expect(input.value).toBe("needle");
  });
});

describe("Terminal overlay input routing", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("keeps the search overlay clickable while open even when the toolbar is not hovered", () => {
    // Regression: the overlay wrapper went pointer-events-none once the hover
    // hide-timer fired, so the still-visible find input could not be clicked
    // back into — clicks fell through to the terminal.
    render(<Terminal />);
    act(() => {
      dispatchFindShortcut(fakeXterms[0]);
    });
    const wrapper = screen.getByRole("search").parentElement;
    expect(wrapper?.className).toContain("pointer-events-auto");
  });

  it("does not swallow mousedown inside the portaled automations popover", async () => {
    // Regression: the toolbar's focus-preserving onMouseDown preventDefault
    // also fired for the portaled popover (React events bubble through the
    // React tree), so popover inputs could never be focused by click.
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("automations"));
    fireEvent.click(await screen.findByLabelText("new automation"));
    const nameInput = await screen.findByLabelText("automation name");
    const wasNotPrevented = fireEvent.mouseDown(nameInput);
    expect(wasNotPrevented).toBe(true);
  });

  it("does not refocus the terminal on keydown inside the automations popover", async () => {
    // Regression: the toolbar's onKeyDown refocused xterm for keystrokes
    // bubbling out of the portaled popover, sending typed text to the shell.
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("automations"));
    fireEvent.click(await screen.findByLabelText("new automation"));
    const nameInput = await screen.findByLabelText("automation name");
    fakeXterms[0]?.focus.mockClear();
    fireEvent.keyDown(nameInput, { key: "a" });
    expect(fakeXterms[0]?.focus).not.toHaveBeenCalled();
  });

  it("still refocuses the terminal on keydown over the toolbar's own buttons", () => {
    render(<Terminal />);
    fakeXterms[0]?.focus.mockClear();
    fireEvent.keyDown(screen.getByLabelText("find in terminal"), { key: "a" });
    expect(fakeXterms[0]?.focus).toHaveBeenCalled();
  });
});

describe("Terminal PTY resize ownership", () => {
  it("reports browser focus and pointer activity to the server", () => {
    render(<Terminal />);
    act(() => fakeWebSockets[0]?.fireOpen());
    fakeWebSockets[0]?.send.mockClear();

    fireEvent.blur(window);
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "client-focus", focused: false }),
    );

    fakeWebSockets[0]?.send.mockClear();
    fireEvent.focus(window);
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "client-focus", focused: true }),
    );

    fakeWebSockets[0]?.send.mockClear();
    fireEvent.pointerDown(document.body);
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "client-focus", focused: true }),
    );
  });
});

const dispatchTabKey = (
  handle: FakeXtermHandle | undefined,
  modifiers: KeyboardModifiers = {},
): DispatchedKeyResult | undefined => {
  if (!handle?.customKeyEventHandler) return undefined;
  const event = new KeyboardEvent("keydown", { key: "Tab", ...modifiers });
  let preventDefaultCalls = 0;
  Object.defineProperty(event, "preventDefault", { value: () => preventDefaultCalls++ });
  const handlerResult = handle.customKeyEventHandler(event);
  return { preventDefaultCalls, handlerResult };
};

describe("Terminal modified Tab routing", () => {
  it("leaves Ctrl+Tab to the browser while the shell is idle", () => {
    render(<Terminal />);
    act(() => fakeWebSockets[0]?.fireOpen());
    fakeWebSockets[0]?.send.mockClear();

    const result = dispatchTabKey(fakeXterms[0], { ctrlKey: true });

    expect(result).toEqual({ handlerResult: false, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("normalizes held Ctrl+Tab and Ctrl+Shift+Tab for a foreground terminal app", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "foreground", process: "herdr" });
    });
    fakeWebSockets[0]?.send.mockClear();

    const nextResult = dispatchTabKey(fakeXterms[0], { ctrlKey: true });
    const previousResult = dispatchTabKey(fakeXterms[0], { ctrlKey: true, shiftKey: true });

    expect(nextResult).toEqual({ handlerResult: false, preventDefaultCalls: 1 });
    expect(previousResult).toEqual({ handlerResult: false, preventDefaultCalls: 1 });
    expect(fakeWebSockets[0]?.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ type: "input", data: TERMINAL_TAB_SEQUENCE }),
    );
    expect(fakeWebSockets[0]?.send).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ type: "input", data: TERMINAL_BACK_TAB_SEQUENCE }),
    );
  });

  it("leaves Cmd+Tab to the operating system while a terminal app is foregrounded", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "foreground", process: "herdr" });
    });
    fakeWebSockets[0]?.send.mockClear();

    const result = dispatchTabKey(fakeXterms[0], { metaKey: true });

    expect(result).toEqual({ handlerResult: false, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("restores Git metadata when herdr's slim hover handle is expanded", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "git-diff-summary",
        summary: {
          isRepo: true,
          files: 2,
          additions: 337,
          deletions: 20,
          binaries: 0,
          branch: "main",
        },
      });
    });

    expect(screen.getByLabelText(/view git diff/i)).not.toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: "terminal actions" });
    const toolbarArea = toolbar.parentElement;
    const toolbarHandle = toolbar.previousElementSibling;

    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "foreground", process: "/opt/homebrew/bin/herdr" });
    });

    expect(screen.queryByLabelText(/view git diff/i)).toBeNull();
    expect(toolbar.className).toContain("opacity-0");
    expect(toolbarArea?.className).toContain("pointer-events-none");
    expect(toolbarHandle?.className).toContain("pointer-events-auto");
    expect(toolbarHandle?.className).toContain("opacity-100");

    if (toolbarArea) fireEvent.mouseEnter(toolbarArea);

    expect(toolbar.className).toContain("opacity-100");
    expect(toolbarArea?.className).toContain("pointer-events-auto");
    expect(screen.getByLabelText(/view git diff/i)).not.toBeNull();

    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "foreground", process: null });
    });

    expect(screen.getByLabelText(/view git diff/i)).not.toBeNull();
  });
});

const dispatchTerminalKey = (
  handle: FakeXtermHandle | undefined,
  eventType: "keydown" | "keyup",
  key: string,
  modifiers: KeyboardModifiers = {},
): DispatchedKeyResult | undefined => {
  if (!handle?.customKeyEventHandler) return undefined;
  const event = new KeyboardEvent(eventType, { key, ...modifiers });
  let preventDefaultCalls = 0;
  Object.defineProperty(event, "preventDefault", { value: () => preventDefaultCalls++ });
  const handlerResult = handle.customKeyEventHandler(event);
  return { preventDefaultCalls, handlerResult };
};

const dispatchEnterKey = (
  handle: FakeXtermHandle | undefined,
  modifiers: KeyboardModifiers = {},
): DispatchedKeyResult | undefined => dispatchTerminalKey(handle, "keydown", "Enter", modifiers);

const activateKittyKeyboard = (flags: number): void => {
  act(() => {
    fakeWebSockets[0]?.fireOpen();
    fakeXterms[0]?.invokeCsiHandler(">", "u", [flags]);
  });
};

describe("Terminal on-screen keyboard arbitration", () => {
  const queryOnScreenKeyboard = () => document.querySelector("[data-on-screen-keyboard]");
  const openOnScreenKeyboard = () => {
    fireEvent.click(screen.getByLabelText("toggle on-screen keyboard"));
    const keyboard = queryOnScreenKeyboard();
    if (!keyboard) throw new Error("on-screen keyboard did not open");
    return keyboard;
  };

  beforeEach(() => {
    installTouchMatchMedia();
    vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState(null, "");
    });
  });

  it("keeps the touch action overlay hidden until the on-screen keyboard opens", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const toolbar = screen.getByRole("toolbar", { name: "terminal actions" });

    expect(toolbar.className).toContain("opacity-0");
    expect(toolbar.parentElement?.className).toContain("pointer-events-none");

    const keyboard = openOnScreenKeyboard();

    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).toContain("touch-pan-x");
    expect(toolbar.parentElement?.className).toContain("pointer-events-auto");
    expect(keyboard.className).not.toContain("border-t");

    const actionsToggle = screen.getByLabelText("Show terminal actions");
    fireEvent.pointerDown(actionsToggle);
    fireEvent.click(actionsToggle);
    expect(queryOnScreenKeyboard()).not.toBeNull();
    expect(screen.getByLabelText("Hide terminal actions")).not.toBeNull();

    fireEvent.pointerDown(screen.getByLabelText("find in terminal"));

    expect(queryOnScreenKeyboard()).not.toBeNull();
    expect(screen.getByLabelText("Hide terminal actions")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("toggle on-screen keyboard"));

    expect(toolbar.className).toContain("opacity-0");
    expect(toolbar.parentElement?.className).toContain("pointer-events-none");
  });

  it("restores Git metadata when the mobile overlay opens in herdr", () => {
    installFakeLocalStorage({ [MOBILE_RESUME_STORAGE_KEY]: "false" });
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "foreground", process: "herdr" });
    });

    expect(screen.queryByLabelText(/view git diff/i)).toBeNull();

    openOnScreenKeyboard();
    act(() => {
      fakeWebSockets[0]?.fireMessage({
        type: "git-diff-summary",
        summary: {
          isRepo: true,
          files: 2,
          additions: 337,
          deletions: 20,
          binaries: 0,
          branch: "main",
        },
      });
    });

    expect(screen.getByLabelText(/view git diff/i)).not.toBeNull();
    expect(screen.getByLabelText("Show terminal actions")).not.toBeNull();
  });

  it("dismisses an active system-keyboard input before opening for the terminal", () => {
    render(<Terminal />);
    const outsideInput = document.createElement("input");
    document.body.appendChild(outsideInput);
    outsideInput.focus();
    const blurSpy = vi.spyOn(outsideInput, "blur");

    openOnScreenKeyboard();

    expect(blurSpy).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(outsideInput);
    outsideInput.remove();
  });

  it("keeps toolbar drags open but closes before an action summons the system keyboard", () => {
    render(<Terminal />);
    openOnScreenKeyboard();

    fireEvent.pointerDown(screen.getByLabelText("terminal session"));
    expect(queryOnScreenKeyboard()).not.toBeNull();

    fireEvent.pointerDown(screen.getByLabelText("find in terminal"));
    expect(queryOnScreenKeyboard()).not.toBeNull();

    fireEvent.click(screen.getByLabelText("find in terminal"));
    expect(queryOnScreenKeyboard()).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("find query"));
  });

  it("keeps the keyboard open while a keyboard-settings control receives focus", () => {
    render(<Terminal />);
    openOnScreenKeyboard();
    const settingsBoundary = document.createElement("div");
    const settingsButton = document.createElement("button");
    settingsBoundary.setAttribute("data-on-screen-keyboard-settings", "");
    settingsBoundary.appendChild(settingsButton);
    document.body.appendChild(settingsBoundary);

    act(() => settingsButton.focus());

    expect(queryOnScreenKeyboard()).not.toBeNull();
    settingsBoundary.remove();
  });

  it("closes when a non-terminal input receives programmatic focus", () => {
    render(<Terminal />);
    openOnScreenKeyboard();
    const outsideInput = document.createElement("input");
    document.body.appendChild(outsideInput);

    act(() => outsideInput.focus());

    expect(queryOnScreenKeyboard()).toBeNull();
    expect(document.activeElement).toBe(outsideInput);
    outsideInput.remove();
  });
});

describe("Terminal Kitty keyboard protocol", () => {
  it("enables xterm's native Kitty keyboard implementation", () => {
    render(<Terminal />);

    expect(fakeXterms[0]?.getOptions()).toMatchObject({
      vtExtensions: { kittyKeyboard: true },
    });
  });

  it("lets Kitty mode requests continue to xterm's native parser", () => {
    render(<Terminal />);

    let didLocalTermConsumeRequest = true;
    act(() => {
      didLocalTermConsumeRequest =
        fakeXterms[0]?.invokeCsiHandler(">", "u", [
          KITTY_KEYBOARD_DISAMBIGUATE_FLAG | KITTY_KEYBOARD_REPORT_EVENT_TYPES_FLAG,
        ]) ?? true;
    });

    expect(didLocalTermConsumeRequest).toBe(false);
  });

  it("delegates Escape press and release to xterm while Kitty mode is active", () => {
    render(<Terminal />);
    activateKittyKeyboard(
      KITTY_KEYBOARD_DISAMBIGUATE_FLAG | KITTY_KEYBOARD_REPORT_EVENT_TYPES_FLAG,
    );
    fakeWebSockets[0]?.send.mockClear();

    const keyDownResult = dispatchTerminalKey(fakeXterms[0], "keydown", "Escape");
    const keyUpResult = dispatchTerminalKey(fakeXterms[0], "keyup", "Escape");

    expect(keyDownResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(keyUpResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("preserves macOS editing mappings while Kitty mode is active", () => {
    render(<Terminal />);
    activateKittyKeyboard(
      KITTY_KEYBOARD_DISAMBIGUATE_FLAG | KITTY_KEYBOARD_REPORT_EVENT_TYPES_FLAG,
    );
    fakeWebSockets[0]?.send.mockClear();

    const editingShortcuts = [
      { key: "ArrowLeft", output: TERMINAL_CURSOR_LINE_START_SEQUENCE },
      { key: "ArrowRight", output: TERMINAL_CURSOR_LINE_END_SEQUENCE },
      { key: "Backspace", output: TERMINAL_DELETE_TO_LINE_START_SEQUENCE },
    ];

    for (const { key, output } of editingShortcuts) {
      expect(dispatchTerminalKey(fakeXterms[0], "keydown", key, { metaKey: true })).toEqual({
        handlerResult: false,
        preventDefaultCalls: 1,
      });
      expect(fakeWebSockets[0]?.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: "input", data: output }),
      );
      const sendCallCountBeforeKeyUp = fakeWebSockets[0]?.send.mock.calls.length;
      expect(dispatchTerminalKey(fakeXterms[0], "keyup", key, { metaKey: true })).toEqual({
        handlerResult: false,
        preventDefaultCalls: 1,
      });
      expect(fakeWebSockets[0]?.send).toHaveBeenCalledTimes(sendCallCountBeforeKeyUp ?? 0);
    }
  });

  it("leaves browser-owned Command text shortcuts outside Kitty input", () => {
    render(<Terminal />);
    activateKittyKeyboard(
      KITTY_KEYBOARD_DISAMBIGUATE_FLAG | KITTY_KEYBOARD_REPORT_EVENT_TYPES_FLAG,
    );
    fakeWebSockets[0]?.send.mockClear();

    for (const key of ["c", "v", "V", "1"]) {
      const modifiers = key === "V" ? { metaKey: true, shiftKey: true } : { metaKey: true };
      expect(dispatchTerminalKey(fakeXterms[0], "keydown", key, modifiers)).toEqual({
        handlerResult: false,
        preventDefaultCalls: 0,
      });
      expect(dispatchTerminalKey(fakeXterms[0], "keyup", key, modifiers)).toEqual({
        handlerResult: false,
        preventDefaultCalls: 0,
      });
    }
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("keeps LocalTerm Command shortcuts ahead of browser arbitration", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);

    let shortcutResult: DispatchedKeyResult | undefined;
    act(() => {
      shortcutResult = dispatchTerminalKey(fakeXterms[0], "keydown", "f", { metaKey: true });
    });

    expect(shortcutResult).toEqual({ handlerResult: false, preventDefaultCalls: 1 });
    expect(screen.queryByRole("search")).not.toBeNull();
  });

  it("preserves xterm's terminal select-all behavior in Kitty mode", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);

    expect(dispatchTerminalKey(fakeXterms[0], "keydown", "a", { metaKey: true })).toEqual({
      handlerResult: false,
      preventDefaultCalls: 0,
    });
    expect(fakeXterms[0]?.selectAll).toHaveBeenCalledOnce();
  });

  it("keeps Option and Control arrows on xterm's native Kitty path", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);
    fakeWebSockets[0]?.send.mockClear();

    const alternateResult = dispatchTerminalKey(fakeXterms[0], "keydown", "ArrowLeft", {
      altKey: true,
    });
    const controlResult = dispatchTerminalKey(fakeXterms[0], "keydown", "ArrowRight", {
      ctrlKey: true,
    });
    const controlTextResult = dispatchTerminalKey(fakeXterms[0], "keydown", "v", {
      ctrlKey: true,
    });

    expect(alternateResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(controlResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(controlTextResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("delegates modified Enter to xterm when Kitty disambiguation is active", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);
    fakeWebSockets[0]?.send.mockClear();

    const shiftResult = dispatchEnterKey(fakeXterms[0], { shiftKey: true });
    const controlResult = dispatchEnterKey(fakeXterms[0], { ctrlKey: true });
    const alternateResult = dispatchEnterKey(fakeXterms[0], { altKey: true });
    const commandResult = dispatchEnterKey(fakeXterms[0], { metaKey: true });

    for (const result of [shiftResult, controlResult, alternateResult, commandResult]) {
      expect(result).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    }
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("leaves plain Enter to xterm regardless of Kitty mode", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);
    fakeWebSockets[0]?.send.mockClear();

    const result = dispatchEnterKey(fakeXterms[0]);

    expect(result).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("emits LF for plain Shift+Enter without Kitty mode", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
    });
    fakeWebSockets[0]?.send.mockClear();

    const result = dispatchEnterKey(fakeXterms[0], { shiftKey: true });

    expect(result).toEqual({ handlerResult: false, preventDefaultCalls: 1 });
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "input", data: "\n" }),
    );
  });

  it("does not apply the LF fallback to other Enter modifiers", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
    });
    fakeWebSockets[0]?.send.mockClear();

    const controlShiftResult = dispatchEnterKey(fakeXterms[0], {
      shiftKey: true,
      ctrlKey: true,
    });
    const alternateResult = dispatchEnterKey(fakeXterms[0], { altKey: true });

    expect(controlShiftResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(alternateResult).toEqual({ handlerResult: true, preventDefaultCalls: 0 });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();
  });

  it("restores the Shift+Enter fallback after a TUI pops Kitty mode", () => {
    render(<Terminal />);
    activateKittyKeyboard(KITTY_KEYBOARD_DISAMBIGUATE_FLAG);

    expect(dispatchEnterKey(fakeXterms[0], { shiftKey: true })).toEqual({
      handlerResult: true,
      preventDefaultCalls: 0,
    });

    act(() => {
      fakeXterms[0]?.invokeCsiHandler("<", "u", [1]);
    });
    fakeWebSockets[0]?.send.mockClear();

    expect(dispatchEnterKey(fakeXterms[0], { shiftKey: true })).toEqual({
      handlerResult: false,
      preventDefaultCalls: 1,
    });
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "input", data: "\n" }),
    );
  });
});

const installFakeLocalStorage = (initial: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(initial));
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
  vi.stubGlobal("localStorage", fakeStorage);
};

describe("Terminal scrollback replay suppression", () => {
  it("tags generated terminal responses separately from user input", () => {
    render(<Terminal />);
    act(() => fakeWebSockets[0]?.fireOpen());
    fakeWebSockets[0]?.send.mockClear();

    act(() => {
      fakeXterms[0]?.fireTerminalResponse("\x1b]11;rgb:1a1a/1b1b/2626\x1b\\");
      fakeXterms[0]?.fireData("typed-input");
    });

    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "terminal-response",
        data: "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\",
      }),
    );
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "input", data: "typed-input" }),
    );
  });

  it("drops xterm's responses to replayed query requests so they never reach the PTY", async () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "session",
        shell: "/bin/sh",
        shellName: "sh",
        pid: 1,
        cwd: "/",
        title: "sh",
        foreground: null,
        id: "12345678-1234-4234-8234-123456789012",
      });
    });
    // A fresh attach (no prior session) asks for the scrollback replay, which
    // opens the suppressed-replay window.
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"ready","replay":true/),
    );

    // The replay arrives as a binary frame carrying a stale DA1 request
    // (CSI c) the shell emitted once.
    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "output", data: "\x1b[c" });
    });

    // While the window is open, xterm's response to the replayed query must
    // NOT be forwarded to the live PTY — the bounded replacement for
    // server-side stripping: any response, any sequence, is dropped.
    fakeWebSockets[0]?.send.mockClear();
    act(() => {
      fakeXterms[0]?.fireTerminalResponse("62;4;9;22c");
    });
    expect(fakeWebSockets[0]?.send).not.toHaveBeenCalled();

    // replay-end writes the buffered replay as one block and closes the window.
    // The flush is async (the per-socket decompress queue), so await the act to
    // let the microtask run and close the suppressed-replay window.
    await act(async () => {
      fakeWebSockets[0]?.fireMessage({ type: "replay-end" });
    });

    // After the window closes, xterm output flows to the PTY again.
    act(() => {
      fakeXterms[0]?.fireData("hello");
    });
    expect(fakeWebSockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "input", data: "hello" }),
    );
  });
});

describe("Terminal theme picker", () => {
  it("seeds xterm with the default Vesper theme when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const seededTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(seededTheme?.background).toBe("#101010");
    expect(fakeXterms[0]?.getOptions().minimumContrastRatio).toBe(
      DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO,
    );
  });

  it("seeds xterm with an accessible contrast floor for a stored light theme", () => {
    installFakeLocalStorage({ "localterm:terminal-theme-id": "github-light" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().minimumContrastRatio).toBe(
      LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
    );
  });

  it("seeds xterm with the stored theme on mount", () => {
    installFakeLocalStorage({ "localterm:terminal-theme-id": "dracula" });
    render(<Terminal />);
    const seededTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(seededTheme?.background).toBe("#282a36");
  });

  it("falls back to the default theme when the stored id is unknown", () => {
    installFakeLocalStorage({ "localterm:terminal-theme-id": "totally-made-up" });
    render(<Terminal />);
    const seededTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(seededTheme?.background).toBe("#101010");
  });

  it('applies a daemon-pushed {type:"themes"} message live (realtime push, no poll)', () => {
    // Seeded Vesper (no stored preference); a CLI or other-tab change is pushed
    // over the existing PTY WebSocket as {type:"themes"} and applied directly.
    installFakeLocalStorage();
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "themes",
        activeThemeId: "dracula",
        customThemes: [],
        initialized: true,
      });
    });
    const pushedTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(pushedTheme?.background).toBe("#282a36");
    expect(document.documentElement.style.getPropertyValue("--localterm-background")).toBe(
      "#282a36",
    );
    expect(document.body.style.background).toBe("rgb(40, 42, 54)");
  });

  it("updates the contrast floor when a light theme is pushed live", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "themes",
        activeThemeId: "github-light",
        customThemes: [],
        initialized: true,
      });
    });
    expect(fakeXterms[0]?.getOptions().minimumContrastRatio).toBe(
      LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
    );
  });

  it("seeds xterm and LocalTerm chrome from a cached custom theme", () => {
    const customTheme = {
      id: "custom-herdr",
      name: "Herdr",
      source: "test",
      colors: {
        background: "#20242c",
        foreground: "#d8dee9",
        cursor: "#88c0d0",
        red: "#bf616a",
        green: "#a3be8c",
      },
    };
    installFakeLocalStorage({
      [TERMINAL_THEME_STORAGE_KEY]: customTheme.id,
      [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([customTheme]),
    });

    render(<Terminal />);

    const seededTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(seededTheme?.background).toBe("#20242c");
    expect(document.documentElement.style.getPropertyValue("--localterm-background")).toBe(
      "#20242c",
    );
    expect(document.documentElement.style.getPropertyValue("--localterm-green")).toBe("#a3be8c");
    expect(document.body.style.background).toBe("rgb(32, 36, 44)");
  });

  it("exposes a single labelled settings trigger in the toolbar", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(screen.getByLabelText("terminal settings")).not.toBeNull();
  });
});

describe("Terminal font picker", () => {
  it("seeds xterm with Geist Mono when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const fontFamily = fakeXterms[0]?.getOptions().fontFamily;
    expect(fontFamily).toContain("Geist Mono");
  });

  it("seeds xterm with the stored font on mount", () => {
    installFakeLocalStorage({ "localterm:terminal-font-id": "jetbrains-mono" });
    render(<Terminal />);
    const fontFamily = fakeXterms[0]?.getOptions().fontFamily;
    expect(fontFamily).toContain("JetBrains Mono");
  });

  it("falls back to the default font when the stored id is unknown", () => {
    installFakeLocalStorage({ "localterm:terminal-font-id": "made-up-font" });
    render(<Terminal />);
    const fontFamily = fakeXterms[0]?.getOptions().fontFamily;
    expect(fontFamily).toContain("Geist Mono");
  });

  it("seeds xterm and LocalTerm chrome with the cached custom font", () => {
    installFakeLocalStorage({
      [TERMINAL_FONT_STORAGE_KEY]: CUSTOM_FONT_ID,
      [CUSTOM_FONT_FAMILY_STORAGE_KEY]: "Iosevka Custom",
    });

    render(<Terminal />);

    expect(fakeXterms[0]?.getOptions().fontFamily).toContain("Iosevka Custom");
    expect(document.documentElement.style.getPropertyValue("--localterm-font-family")).toContain(
      "Iosevka Custom",
    );
  });
});

describe("Terminal font size", () => {
  it("seeds xterm with the default font size when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().fontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("seeds xterm with the stored font size on mount", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "16" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().fontSize).toBe(16);
  });

  it("clamps an out-of-range stored font size up to the minimum on mount", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "2" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().fontSize).toBe(TERMINAL_FONT_SIZE_MIN_PX);
  });

  it("falls back to the default font size when the stored value is not a number", () => {
    installFakeLocalStorage({ [TERMINAL_FONT_SIZE_STORAGE_KEY]: "huge" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().fontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });
});

describe("Terminal line height", () => {
  it("seeds xterm with the default line height when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().lineHeight).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
  });

  it("seeds xterm with the stored line height on mount", () => {
    installFakeLocalStorage({ [TERMINAL_LINE_HEIGHT_STORAGE_KEY]: "1.5" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().lineHeight).toBeCloseTo(1.5, 5);
  });

  it("clamps an out-of-range stored line height down to the maximum on mount", () => {
    installFakeLocalStorage({ [TERMINAL_LINE_HEIGHT_STORAGE_KEY]: "9" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().lineHeight).toBe(TERMINAL_LINE_HEIGHT_MAX);
  });
});

describe("Terminal cursor style", () => {
  it("seeds xterm with the default cursor style when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorStyle).toBe(DEFAULT_TERMINAL_CURSOR_STYLE);
  });

  it("seeds xterm with the stored cursor style on mount", () => {
    installFakeLocalStorage({ [TERMINAL_CURSOR_STYLE_STORAGE_KEY]: "bar" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorStyle).toBe("bar");
  });

  it("falls back to the default cursor style when the stored value is unknown", () => {
    installFakeLocalStorage({ [TERMINAL_CURSOR_STYLE_STORAGE_KEY]: "spinning-rainbow" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorStyle).toBe(DEFAULT_TERMINAL_CURSOR_STYLE);
  });
});

describe("Terminal cursor blink", () => {
  it("seeds xterm with cursor blink enabled by default", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorBlink).toBe(true);
  });

  it("seeds xterm with the stored cursor blink preference", () => {
    installFakeLocalStorage({ [TERMINAL_CURSOR_BLINK_STORAGE_KEY]: "false" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorBlink).toBe(false);
  });

  it("falls back to the default when the stored value is neither 'true' nor 'false'", () => {
    installFakeLocalStorage({ [TERMINAL_CURSOR_BLINK_STORAGE_KEY]: "maybe" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().cursorBlink).toBe(true);
  });
});

describe("Terminal scrollback", () => {
  it("seeds xterm with the default scrollback when no preference is stored", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().scrollback).toBe(DEFAULT_TERMINAL_SCROLLBACK_LINES);
  });

  it("seeds xterm with the stored scrollback on mount", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLLBACK_STORAGE_KEY]: "50000" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().scrollback).toBe(50000);
  });

  it("falls back to the default when the stored value is not a known preset", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLLBACK_STORAGE_KEY]: "12345" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().scrollback).toBe(DEFAULT_TERMINAL_SCROLLBACK_LINES);
  });
});

describe("Terminal scrollOnUserInput", () => {
  it("seeds xterm with scrollOnUserInput=true by default", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().scrollOnUserInput).toBe(true);
  });

  it("seeds xterm with the stored scrollOnUserInput preference", () => {
    installFakeLocalStorage({ [TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY]: "false" });
    render(<Terminal />);
    expect(fakeXterms[0]?.getOptions().scrollOnUserInput).toBe(false);
  });

  it("toggling the pin-to-bottom switch updates terminal.options.scrollOnUserInput", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(fakeXterms[0]?.getOptions().scrollOnUserInput).toBe(true);
    act(() => {
      fireEvent.click(screen.getByLabelText("toggle pin to bottom on input"));
    });
    expect(fakeXterms[0]?.getOptions().scrollOnUserInput).toBe(false);
  });
});

describe("Terminal scroll preservation through hot-swaps", () => {
  // The fake fitAddon doesn't simulate column reflow, so we can't measure the
  // EXACT post-fit viewportY here. The test below is a regression guard for the
  // visible bug — "scrolled-up users got snapped to the bottom on every fit()" —
  // by asserting scrollToBottom is NOT called. Full reflow-aware verification
  // lives in tests/utils/fit-terminal-preserving-scroll.test.ts.
  it("does not call scrollToBottom on font size change when the user is scrolled up", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");
    // Mount + initial fits already happened with default {baseY:0, viewportY:0} → those
    // legitimately called scrollToBottom. Clear before the actionable change.
    handle.scrollToBottom.mockClear();
    handle.scrollLines.mockClear();
    // Pretend the user scrolled up 30 lines.
    handle.setBufferState({ baseY: 100, viewportY: 70 });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    act(() => {
      fireEvent.click(screen.getByLabelText("increase font size"));
    });

    // The bug we fixed: scrolled-up users used to be snapped to the bottom on every fit().
    expect(handle.scrollToBottom).not.toHaveBeenCalled();
  });

  it("snaps to the bottom on font size change when the user is already at the bottom", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");
    handle.setBufferState({ baseY: 0, viewportY: 0 });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    handle.scrollToBottom.mockClear();
    act(() => {
      fireEvent.click(screen.getByLabelText("increase font size"));
    });

    expect(handle.scrollToBottom).toHaveBeenCalled();
  });

  it("writes output directly without RAF batching", async () => {
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");

    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "output", data: "replayed transcript" });
    });

    await vi.waitFor(() => {
      expect(lastWriteArgAsString(handle)).toBe("replayed transcript");
    });
  });

  it("writes output escape sequences directly", async () => {
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");

    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "output", data: "\x1b[2J\x1b[H\x1b[3Jredraw" });
    });

    await vi.waitFor(() => {
      expect(lastWriteArgAsString(handle)).toBe("\x1b[2J\x1b[H\x1b[3Jredraw");
    });
  });

  it("blocks scrollback purge CSI handlers without blocking normal screen clears", () => {
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");

    expect(handle.invokeCsiHandler(undefined, "J", [3])).toBe(true);
    expect(handle.invokeCsiHandler("?", "J", [3])).toBe(true);
    expect(handle.invokeCsiHandler(undefined, "J", [2])).toBe(false);
    expect(handle.invokeCsiHandler("?", "J", [2])).toBe(false);
  });

  it("does not force bottom scroll after output when the user is scrolled up", () => {
    render(<Terminal />);
    const handle = fakeXterms[0];
    if (!handle) throw new Error("xterm not constructed");

    handle.setBufferState({ baseY: 100, viewportY: 70 });
    handle.scrollToBottom.mockClear();

    act(() => {
      fakeWebSockets[0]?.fireMessage({ type: "output", data: "\x1b[2J\x1b[H\x1b[3Jredraw" });
    });

    expect(handle.scrollToBottom).not.toHaveBeenCalled();
  });
});

describe("Terminal live preview", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const openThemeSelect = () => {
    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("select theme"));
  };

  const openFontSelect = () => {
    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("select font"));
  };

  const openCursorStyleSelect = () => {
    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("select cursor style"));
  };

  it("hovering a theme item swaps terminal.options.theme to that theme", async () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openThemeSelect();

    const draculaItem = await screen.findByText("Dracula");
    act(() => {
      fireEvent.pointerEnter(draculaItem);
    });

    const previewedTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(previewedTheme?.background).toBe("#282a36");
  });

  it("closing the outer popover while hovering reverts terminal.options.theme to the committed value", async () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openThemeSelect();

    const draculaItem = await screen.findByText("Dracula");
    act(() => {
      fireEvent.pointerEnter(draculaItem);
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("terminal settings"));
    });

    const revertedTheme = fakeXterms[0]?.getOptions().theme as { background?: string } | undefined;
    expect(revertedTheme?.background).toBe("#101010");
  });

  it("hovering a font item swaps terminal.options.fontFamily to that font", async () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openFontSelect();

    const jetbrainsItem = await screen.findByText("JetBrains Mono");
    act(() => {
      fireEvent.pointerEnter(jetbrainsItem);
    });

    await vi.waitFor(() => {
      const previewedFontFamily = fakeXterms[0]?.getOptions().fontFamily;
      expect(previewedFontFamily).toContain("JetBrains Mono");
    });
  });

  it("hovering a cursor style item swaps terminal.options.cursorStyle to that style", async () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openCursorStyleSelect();

    const barItem = await screen.findByText("Bar");
    act(() => {
      fireEvent.pointerEnter(barItem);
    });

    expect(fakeXterms[0]?.getOptions().cursorStyle).toBe("bar");
  });

  it("closing the outer popover while hovering reverts terminal.options.cursorStyle to the committed value", async () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openCursorStyleSelect();

    const barItem = await screen.findByText("Bar");
    act(() => {
      fireEvent.pointerEnter(barItem);
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("terminal settings"));
    });

    expect(fakeXterms[0]?.getOptions().cursorStyle).toBe(DEFAULT_TERMINAL_CURSOR_STYLE);
  });
});

describe("Terminal hot-swap", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const openSettings = () => {
    fireEvent.click(screen.getByLabelText("terminal settings"));
  };

  it("clicking the line height + button updates terminal.options.lineHeight", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openSettings();

    const seededLineHeight = fakeXterms[0]?.getOptions().lineHeight as number;
    act(() => {
      fireEvent.click(screen.getByLabelText("increase line height"));
    });

    const updatedLineHeight = fakeXterms[0]?.getOptions().lineHeight as number;
    expect(updatedLineHeight).toBeGreaterThan(seededLineHeight);
  });

  it("toggling the cursor blink switch updates terminal.options.cursorBlink", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    openSettings();

    expect(fakeXterms[0]?.getOptions().cursorBlink).toBe(true);
    act(() => {
      fireEvent.click(screen.getByLabelText("toggle cursor blink"));
    });
    expect(fakeXterms[0]?.getOptions().cursorBlink).toBe(false);
  });
});

describe("Terminal emoji colors", () => {
  it("mutes emoji colors by default", () => {
    installFakeLocalStorage();
    render(<Terminal />);

    expect(fakeWebglAddons[0]?.muteEmojiColors).toBe(DEFAULT_MUTE_EMOJI_COLORS);
  });

  it("initializes WebGL with stored emoji colors enabled", () => {
    installFakeLocalStorage({ [MUTE_EMOJI_COLORS_STORAGE_KEY]: "false" });
    render(<Terminal />);

    expect(fakeWebglAddons[0]?.muteEmojiColors).toBe(false);
  });

  it("updates WebGL and persists when emoji muting is toggled", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("terminal settings"));

    act(() => {
      fireEvent.click(screen.getByLabelText("toggle mute emoji colors"));
    });

    expect(fakeWebglAddons).toHaveLength(1);
    expect(fakeWebglAddons[0]?.setEmojiColorsMuted).toHaveBeenLastCalledWith(false);
    expect(localStorage.getItem(MUTE_EMOJI_COLORS_STORAGE_KEY)).toBe("false");
  });
});

describe("Terminal ligatures", () => {
  it("does not register a character joiner on mount when ligatures are disabled", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    expect(fakeXterms[0]?.registerCharacterJoiner).not.toHaveBeenCalled();
  });

  it("registers a character joiner on mount when ligatures are stored enabled", () => {
    installFakeLocalStorage({ [LIGATURES_ENABLED_STORAGE_KEY]: "true" });
    render(<Terminal />);
    expect(fakeXterms[0]?.registerCharacterJoiner).toHaveBeenCalledTimes(1);
  });

  it("registers the joiner when the ligatures switch is toggled on", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("terminal settings"));
    expect(fakeXterms[0]?.registerCharacterJoiner).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByLabelText("toggle ligatures"));
    });

    expect(fakeXterms[0]?.registerCharacterJoiner).toHaveBeenCalledTimes(1);
    expect(fakeXterms[0]?.deregisterCharacterJoiner).not.toHaveBeenCalled();
  });

  it("deregisters the joiner when the ligatures switch is toggled off", () => {
    installFakeLocalStorage({ [LIGATURES_ENABLED_STORAGE_KEY]: "true" });
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText("terminal settings"));
    expect(fakeXterms[0]?.registerCharacterJoiner).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.click(screen.getByLabelText("toggle ligatures"));
    });

    expect(fakeXterms[0]?.deregisterCharacterJoiner).toHaveBeenCalledTimes(1);
    expect(fakeXterms[0]?.deregisterCharacterJoiner.mock.calls[0]?.[0]).toBe(1);
  });
});

describe("Terminal shell info", () => {
  it("renders the shell info from a 'session' WS frame in the settings menu", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "session",
        shell: "/opt/homebrew/bin/fish",
        shellName: "fish",
        pid: 54321,
        cwd: "/Users/tester/Developer/localterm",
        title: "~",
        foreground: null,
      });
    });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByRole("button", { name: /^shell$/i }));

    expect(screen.getByText("fish")).toBeDefined();
    expect(screen.getByText("/opt/homebrew/bin/fish")).toBeDefined();
    expect(screen.getByText("54321")).toBeDefined();
  });
});

describe("Terminal session attachment", () => {
  const TEST_SID = "550e8400-e29b-41d4-a716-446655440000";
  const fireSessionFrame = (ws: FakeWebSocketHandle | undefined, id: string) => {
    ws?.fireOpen();
    ws?.fireMessage({
      type: "session",
      shell: "/bin/zsh",
      shellName: "zsh",
      pid: 111,
      cwd: "/tmp",
      title: "zsh",
      foreground: null,
      id,
    });
  };

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("bypasses mobile resume for an explicitly requested fresh shell", () => {
    installFakeLocalStorage();
    installTouchMatchMedia();
    window.history.replaceState(null, "", "/?fresh=1");

    render(<Terminal />);

    expect(fakeWebSockets).toHaveLength(1);
    act(() => {
      fireSessionFrame(fakeWebSockets[0], TEST_SID);
    });
    expect(new URL(window.location.href).searchParams.has(FRESH_SESSION_QUERY_PARAM)).toBe(false);
  });

  it("switches the current mobile tab to a fresh shell", () => {
    const nextSessionId = "650e8400-e29b-41d4-a716-446655440000";
    installFakeLocalStorage();
    installTouchMatchMedia();
    window.history.replaceState(null, "", "/?fresh=1");
    render(<Terminal />);
    act(() => {
      fireSessionFrame(fakeWebSockets[0], TEST_SID);
    });
    vi.mocked(window.open).mockClear();

    fireEvent.click(screen.getByLabelText("sessions"));
    fireEvent.click(screen.getByRole("button", { name: /^new shell$/i }));

    expect(window.open).not.toHaveBeenCalled();
    expect(fakeWebSockets[0]?.close).toHaveBeenCalledOnce();
    expect(fakeWebSockets).toHaveLength(2);
    const freshSocketUrl = new URL(fakeWebSockets[1]?.url ?? "http://localhost/ws");
    expect(freshSocketUrl.searchParams.has("sid")).toBe(false);
    expect(freshSocketUrl.searchParams.get("cwd")).toBe("/tmp");

    act(() => {
      fireSessionFrame(fakeWebSockets[1], nextSessionId);
    });
    expect(new URL(window.location.href).searchParams.get("sid")).toBe(nextSessionId);
  });

  it("does not let a pending mobile resume override an explicit fresh switch", async () => {
    installFakeLocalStorage();
    installTouchMatchMedia();
    window.history.replaceState(null, "", "/");
    render(<Terminal />);
    expect(fakeWebSockets).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("sessions"));
    fireEvent.click(screen.getByRole("button", { name: /^new shell$/i }));
    expect(fakeWebSockets).toHaveLength(1);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fakeWebSockets).toHaveLength(1);
    expect(new URL(fakeWebSockets[0]?.url ?? "http://localhost/ws").searchParams.has("sid")).toBe(
      false,
    );
  });

  it("keeps opening a separate tab for a fresh shell on desktop", () => {
    installFakeLocalStorage();
    window.history.replaceState(null, "", "/");
    render(<Terminal />);
    act(() => {
      fireSessionFrame(fakeWebSockets[0], TEST_SID);
    });
    vi.mocked(window.open).mockClear();

    fireEvent.click(screen.getByLabelText("sessions"));
    fireEvent.click(screen.getByRole("button", { name: /^new shell$/i }));

    expect(fakeWebSockets).toHaveLength(1);
    expect(window.open).toHaveBeenCalledOnce();
    const openedUrl = String(vi.mocked(window.open).mock.calls[0]?.[0]);
    expect(new URL(openedUrl).searchParams.get(FRESH_SESSION_QUERY_PARAM)).toBe("1");
  });

  it("persists the session id to ?sid= and reattaches to it after a remount", () => {
    installFakeLocalStorage();
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    const { unmount } = render(<Terminal />);
    const firstWs = fakeWebSockets[0];
    expect(firstWs).toBeDefined();

    act(() => {
      fireSessionFrame(firstWs, TEST_SID);
    });

    expect(new URL(window.location.href).searchParams.get("sid")).toBe(TEST_SID);
    expect(firstWs?.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"ready","replay":true/),
    );

    unmount();
    render(<Terminal />);
    const secondWs = fakeWebSockets[1];
    expect(secondWs).toBeDefined();
    expect(secondWs.url).toContain(`sid=${TEST_SID}`);

    act(() => {
      fireSessionFrame(secondWs, TEST_SID);
    });

    expect(secondWs?.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"ready","replay":true/),
    );
  });

  it("does not replay scrollback on a silent reattach of the same PTY", () => {
    installFakeLocalStorage();
    render(<Terminal />);
    const firstWs = fakeWebSockets[0];
    expect(firstWs).toBeDefined();

    act(() => {
      fireSessionFrame(firstWs, TEST_SID);
    });
    firstWs?.send.mockClear();

    act(() => {
      firstWs?.fireClose(1006, "", false);
      vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    });

    const secondWs = fakeWebSockets[1];
    expect(secondWs).toBeDefined();
    expect(secondWs.url).toContain(`sid=${TEST_SID}`);

    act(() => {
      fireSessionFrame(secondWs, TEST_SID);
    });

    expect(secondWs?.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"ready","replay":false/),
    );
  });
});

describe("Terminal favicon foreground re-seed on attach", () => {
  beforeEach(() => {
    vi.mocked(setTabFaviconState).mockClear();
  });

  it("seeds alive-quiet (blue) when the session frame reports a foreground process", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "session",
        shell: "/bin/zsh",
        shellName: "zsh",
        pid: 1,
        cwd: "/tmp",
        title: "zsh",
        foreground: "vim",
      });
    });
    expect(vi.mocked(setTabFaviconState)).toHaveBeenCalledWith("alive-quiet");
  });

  it("seeds ready (grey) when the session frame reports an idle shell", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({
        type: "session",
        shell: "/bin/zsh",
        shellName: "zsh",
        pid: 1,
        cwd: "/tmp",
        title: "zsh",
        foreground: null,
      });
    });
    expect(vi.mocked(setTabFaviconState)).toHaveBeenCalledWith("ready");
  });
});

describe("Terminal default launch directory", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("seeds the WS ?cwd= from the saved default on a bare launch", () => {
    installFakeLocalStorage({ [DEFAULT_CWD_STORAGE_KEY]: "/Users/tester/repo" });
    window.history.replaceState(null, "", "/");
    render(<Terminal />);

    expect(fakeWebSockets[0]).toBeDefined();
    expect(fakeWebSockets[0].url).toContain("cwd=%2FUsers%2Ftester%2Frepo");
  });

  it("prefers an explicit address-bar ?cwd= over the saved default", () => {
    installFakeLocalStorage({ [DEFAULT_CWD_STORAGE_KEY]: "/Users/tester/repo" });
    window.history.replaceState(null, "", "/?cwd=%2Ftmp");
    render(<Terminal />);

    expect(fakeWebSockets[0]).toBeDefined();
    expect(fakeWebSockets[0].url).toContain("cwd=%2Ftmp");
    expect(fakeWebSockets[0].url).not.toContain("tester");
  });

  it("omits ?cwd= when no default and no address-bar cwd are set", () => {
    installFakeLocalStorage();
    window.history.replaceState(null, "", "/");
    render(<Terminal />);

    expect(fakeWebSockets[0]).toBeDefined();
    expect(fakeWebSockets[0].url).not.toContain("cwd=");
  });
});
