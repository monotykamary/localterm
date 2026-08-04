import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useCtrlNTakeover } from "../../src/hooks/use-ctrl-n-takeover";

interface FullscreenApiStub {
  readonly requestFullscreen: ReturnType<typeof vi.fn>;
  readonly exitFullscreen: ReturnType<typeof vi.fn>;
}

interface DeferredFullscreenStub extends FullscreenApiStub {
  readonly resolveRequest: () => void;
}

const installKeyboardLock = () => {
  const lock = vi.fn<(keyCodes?: string[]) => Promise<void>>(() => Promise.resolve());
  const unlock = vi.fn((): void => {});
  Object.defineProperty(navigator, "keyboard", { configurable: true, value: { lock, unlock } });
  return { lock, unlock };
};

let fakeFullscreenElement: Element | null = null;

const installFullscreenApi = (requestFullscreenImpl?: () => Promise<void>): FullscreenApiStub => {
  const requestFullscreen = vi.fn(
    requestFullscreenImpl ??
      (() => {
        fakeFullscreenElement = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
  );
  const exitFullscreen = vi.fn(() => {
    fakeFullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fakeFullscreenElement,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  return { requestFullscreen, exitFullscreen };
};

const installDeferredFullscreen = (): DeferredFullscreenStub => {
  let resolveRequest = () => {};
  const stub = installFullscreenApi(
    () =>
      new Promise<void>((resolve) => {
        resolveRequest = () => {
          fakeFullscreenElement = document.documentElement;
          resolve();
        };
      }),
  );
  return { ...stub, resolveRequest: () => resolveRequest() };
};

const flushPromises = () => act(async () => {});

const renderTakeover = (
  enabled: boolean,
  onError?: (message: string) => void,
  onKeyboardLockFailure?: () => void,
) =>
  renderHook(
    (props: { enabled: boolean }) => useCtrlNTakeover({ ...props, onError, onKeyboardLockFailure }),
    { initialProps: { enabled } },
  );

describe("useCtrlNTakeover", () => {
  afterEach(() => {
    cleanup();
    fakeFullscreenElement = null;
    Reflect.deleteProperty(navigator, "keyboard");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("requests fullscreen from the activation callback and locks KeyN", async () => {
    const { lock } = installKeyboardLock();
    const { requestFullscreen } = installFullscreenApi();
    const { result, rerender } = renderTakeover(false);

    act(() => {
      result.current();
      rerender({ enabled: true });
    });
    await flushPromises();

    expect(requestFullscreen).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith(["KeyN"]);
  });

  it("does not request fullscreen from a persisted setting without user activation", () => {
    const { lock } = installKeyboardLock();
    const { requestFullscreen } = installFullscreenApi();

    renderTakeover(true);

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });

  it("never requests fullscreen without Keyboard Lock support", () => {
    const { requestFullscreen } = installFullscreenApi();
    const { result, rerender } = renderTakeover(false);

    act(() => {
      result.current();
      rerender({ enabled: true });
    });

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("re-locks when fullscreen engages after a rejected request", async () => {
    const { lock } = installKeyboardLock();
    const onError = vi.fn();
    installFullscreenApi(() => Promise.reject(new Error("no user activation")));
    const { result, rerender } = renderTakeover(false, onError);

    act(() => {
      result.current();
      rerender({ enabled: true });
    });
    await flushPromises();
    expect(lock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Fullscreen"));

    act(() => {
      fakeFullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(lock).toHaveBeenCalledWith(["KeyN"]);
  });

  it("reports Keyboard Lock failures", async () => {
    const { lock } = installKeyboardLock();
    const onError = vi.fn();
    const onKeyboardLockFailure = vi.fn();
    installFullscreenApi();
    fakeFullscreenElement = document.documentElement;
    lock.mockRejectedValue(new Error("permission denied"));

    renderTakeover(true, onError, onKeyboardLockFailure);
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Keyboard Lock"));
    expect(onKeyboardLockFailure).toHaveBeenCalledOnce();
  });

  it("reports synchronous fullscreen request failures", () => {
    installKeyboardLock();
    const onError = vi.fn();
    installFullscreenApi(() => {
      throw new Error("blocked");
    });
    const { result } = renderTakeover(false, onError);

    act(() => result.current());

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Fullscreen"));
  });

  it("locks without requesting when the tab is already fullscreen", async () => {
    const { lock } = installKeyboardLock();
    const { requestFullscreen } = installFullscreenApi();
    fakeFullscreenElement = document.documentElement;

    renderTakeover(true);
    await flushPromises();

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith(["KeyN"]);
  });

  it("unlocks and exits hook-requested fullscreen on disable", async () => {
    const { unlock } = installKeyboardLock();
    const { exitFullscreen } = installFullscreenApi();
    const { result, rerender } = renderTakeover(false);

    act(() => {
      result.current();
      rerender({ enabled: true });
    });
    await flushPromises();
    rerender({ enabled: false });

    expect(unlock).toHaveBeenCalled();
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("leaves user-requested fullscreen active on disable", async () => {
    const { unlock } = installKeyboardLock();
    const { exitFullscreen } = installFullscreenApi();
    fakeFullscreenElement = document.documentElement;

    const { rerender } = renderTakeover(true);
    await flushPromises();
    rerender({ enabled: false });

    expect(unlock).toHaveBeenCalled();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("exits fullscreen and skips the lock when a pending request resolves after disable", async () => {
    const { lock } = installKeyboardLock();
    const { exitFullscreen, resolveRequest } = installDeferredFullscreen();
    const { result, rerender } = renderTakeover(false);

    act(() => {
      result.current();
      rerender({ enabled: true });
    });
    rerender({ enabled: false });
    resolveRequest();
    await flushPromises();

    expect(exitFullscreen).toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });
});
