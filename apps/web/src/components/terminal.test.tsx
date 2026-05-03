import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./terminal";

interface FakeWebSocketHandle {
  url: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fireOpen: () => void;
  fireMessage: (payload: unknown) => void;
  fireClose: (code?: number) => void;
  fireError: () => void;
}

interface FakeXtermHandle {
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null;
  fireTitleChange: (title: string) => void;
}

interface FakeSearchAddonHandle {
  findNext: ReturnType<typeof vi.fn>;
  findPrevious: ReturnType<typeof vi.fn>;
  clearDecorations: ReturnType<typeof vi.fn>;
  fireResults: (results: { resultIndex: number; resultCount: number }) => void;
}

const fakeWebSockets: FakeWebSocketHandle[] = [];
const fakeXterms: FakeXtermHandle[] = [];
const fakeSearchAddons: FakeSearchAddonHandle[] = [];

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
          this.dispatch("message", { data: JSON.stringify(payload) });
        },
        fireClose: (code = 1006) => {
          this.readyState = FakeWebSocket.CLOSED;
          this.dispatch("close", { code });
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
    unicode = { activeVersion: "11" };
    private titleListeners = new Set<(title: string) => void>();
    private handle: FakeXtermHandle;

    constructor() {
      this.handle = {
        customKeyEventHandler: null,
        fireTitleChange: (title: string) => {
          for (const listener of this.titleListeners) listener(title);
        },
      };
      fakeXterms.push(this.handle);
    }

    loadAddon = () => {};
    open = () => {};
    onData = () => {};
    onResize = () => {};
    onTitleChange = (handler: (title: string) => void) => {
      this.titleListeners.add(handler);
      return { dispose: () => this.titleListeners.delete(handler) };
    };
    attachCustomKeyEventHandler = (handler: (event: KeyboardEvent) => boolean) => {
      this.handle.customKeyEventHandler = handler;
    };
    write = () => {};
    reset = () => {};
    focus = () => {};
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

vi.mock("@xterm/addon-unicode11", () => {
  class FakeUnicode11Addon {}
  return { Unicode11Addon: FakeUnicode11Addon };
});

vi.mock("@xterm/addon-web-links", () => {
  class FakeWebLinksAddon {}
  return { WebLinksAddon: FakeWebLinksAddon };
});

vi.mock("@xterm/addon-webgl", () => {
  class FakeWebglAddon {
    onContextLoss = () => {};
    dispose = () => {};
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
};

const dispatchFindShortcut = (handle: FakeXtermHandle | undefined): boolean | undefined => {
  if (!handle?.customKeyEventHandler) return undefined;
  const event = new KeyboardEvent("keydown", { key: "f", metaKey: true });
  Object.defineProperty(event, "preventDefault", { value: vi.fn() });
  return handle.customKeyEventHandler(event);
};

const originalNavigatorPlatform = navigator.platform;

beforeEach(() => {
  fakeWebSockets.length = 0;
  fakeXterms.length = 0;
  fakeSearchAddons.length = 0;
  stubBrowserGlobals();
  installFakeWebSocket();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
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

  it("renders the dead-pill and 'Shell ended' modal when the server reports an exit", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireMessage({ type: "exit", code: 137 });
    });
    expect(screen.queryByText(/Shell ended/i)).not.toBeNull();
    expect(screen.queryByText(/exited · code 137/i)).not.toBeNull();
  });

  it("treats a WebSocket close after a successful open as the shell ending", () => {
    render(<Terminal />);
    act(() => {
      fakeWebSockets[0]?.fireOpen();
      fakeWebSockets[0]?.fireClose();
    });
    expect(screen.queryByText(/Shell ended/i)).not.toBeNull();
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
});

describe("Terminal title", () => {
  it("propagates xterm title changes into the header and document.title", () => {
    render(<Terminal />);
    expect(screen.getByText("shell")).toBeInTheDocument();

    act(() => {
      fakeXterms[0]?.fireTitleChange("vim foo.ts");
    });
    expect(screen.getByText("vim foo.ts")).toBeInTheDocument();
    expect(document.title).toBe("vim foo.ts");
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

    expect(screen.getByText("3/7")).toBeInTheDocument();
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
