import { describe, expect, it, vi } from "vite-plus/test";
import { dismissSystemKeyboard } from "../../src/utils/dismiss-system-keyboard";
import { suppressTerminalSystemKeyboard } from "../../src/utils/suppress-terminal-system-keyboard";

describe("terminal keyboard policy", () => {
  it("makes xterm's helper textarea unable to request a system keyboard", () => {
    const textarea = document.createElement("textarea");

    suppressTerminalSystemKeyboard(textarea);

    expect(textarea.readOnly).toBe(true);
    expect(textarea.inputMode).toBe("none");
  });

  it("uses Chromium's VirtualKeyboard API and blurs the active editor", () => {
    const originalVirtualKeyboard = Object.getOwnPropertyDescriptor(navigator, "virtualKeyboard");
    const hide = vi.fn();
    Object.defineProperty(navigator, "virtualKeyboard", {
      configurable: true,
      value: { hide },
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      dismissSystemKeyboard();

      expect(hide).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(input);
    } finally {
      input.remove();
      if (originalVirtualKeyboard) {
        Object.defineProperty(navigator, "virtualKeyboard", originalVirtualKeyboard);
      } else {
        Reflect.deleteProperty(navigator, "virtualKeyboard");
      }
    }
  });
});
