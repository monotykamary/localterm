import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "../src/app";

interface MockTerminalProps {
  onModalOpenChange?: (open: boolean) => void;
  onForegroundProcessChange?: (hasProcess: boolean) => void;
}

let lastTerminalProps: MockTerminalProps | null = null;
let setMockModalOpen: ((open: boolean) => void) | null = null;
let setMockForegroundProcess: ((hasProcess: boolean) => void) | null = null;

vi.mock("../src/components/terminal", () => ({
  Terminal: (props: MockTerminalProps) => {
    lastTerminalProps = props;
    useEffect(() => {
      setMockModalOpen = (open: boolean) => props.onModalOpenChange?.(open);
      setMockForegroundProcess = (hasProcess: boolean) =>
        props.onForegroundProcessChange?.(hasProcess);
      return () => {
        setMockModalOpen = null;
        setMockForegroundProcess = null;
      };
    }, [props]);
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  lastTerminalProps = null;
  setMockModalOpen = null;
  setMockForegroundProcess = null;
});

const armBeforeUnload = async () => {
  await screen.findByTestId("terminal");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
};

const dispatchBeforeUnload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  const preventDefaultSpy = vi.spyOn(event, "preventDefault");
  window.dispatchEvent(event);
  return preventDefaultSpy;
};

describe("App", () => {
  it("renders the terminal immediately without contacting the server", async () => {
    render(<App />);
    expect(await screen.findByTestId("terminal")).toBeDefined();
  });

  it("only arms beforeunload after the first keystroke in the tab", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(<App />);

    await screen.findByTestId("terminal");
    await waitFor(() => {
      const armed = addSpy.mock.calls.some(([eventName]) => eventName === "keydown");
      expect(armed).toBe(true);
    });

    const beforeKeystroke = addSpy.mock.calls.some(([eventName]) => eventName === "beforeunload");
    expect(beforeKeystroke).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    await waitFor(() => {
      const afterKeystroke = addSpy.mock.calls.some(([eventName]) => eventName === "beforeunload");
      expect(afterKeystroke).toBe(true);
    });
  });

  it("does not warn on unload when no foreground process is running", async () => {
    render(<App />);
    await armBeforeUnload();

    const preventDefaultSpy = dispatchBeforeUnload();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("warns on unload when a foreground process is running", async () => {
    render(<App />);
    await armBeforeUnload();

    act(() => {
      setMockForegroundProcess?.(true);
    });

    const preventDefaultSpy = dispatchBeforeUnload();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("stops warning when the foreground process exits back to the shell", async () => {
    render(<App />);
    await armBeforeUnload();

    act(() => {
      setMockForegroundProcess?.(true);
    });
    act(() => {
      setMockForegroundProcess?.(false);
    });

    const preventDefaultSpy = dispatchBeforeUnload();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("does not warn on unload while the shell-ended/disconnect modal is open", async () => {
    render(<App />);
    await armBeforeUnload();

    act(() => {
      setMockForegroundProcess?.(true);
    });

    expect(lastTerminalProps?.onModalOpenChange).toBeTypeOf("function");

    act(() => {
      setMockModalOpen?.(true);
    });

    const preventDefaultSpy = dispatchBeforeUnload();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("re-arms the unload warning if the modal closes (e.g. retry succeeds)", async () => {
    render(<App />);
    await armBeforeUnload();

    act(() => {
      setMockForegroundProcess?.(true);
    });
    act(() => {
      setMockModalOpen?.(true);
    });
    act(() => {
      setMockModalOpen?.(false);
    });

    const preventDefaultSpy = dispatchBeforeUnload();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
