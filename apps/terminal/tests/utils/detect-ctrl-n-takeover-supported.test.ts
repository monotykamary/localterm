import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { detectCtrlNTakeoverSupported } from "../../src/utils/detect-ctrl-n-takeover-supported";

const installKeyboardLock = () => {
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: { lock: vi.fn(() => Promise.resolve()), unlock: vi.fn() },
  });
};

const installFullscreenApi = () => {
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
};

describe("detectCtrlNTakeoverSupported", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "keyboard");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("requires Keyboard Lock plus both fullscreen operations", () => {
    installKeyboardLock();
    installFullscreenApi();

    expect(detectCtrlNTakeoverSupported()).toBe(true);
  });

  it("returns false without requestFullscreen", () => {
    installKeyboardLock();
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });

    expect(detectCtrlNTakeoverSupported()).toBe(false);
  });

  it("returns false without exitFullscreen", () => {
    installKeyboardLock();
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });

    expect(detectCtrlNTakeoverSupported()).toBe(false);
  });
});
