import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vite-plus/test";
import { isTerminalApplicationMouseEvent } from "../../src/utils/is-terminal-application-mouse-event";

const terminalState = (
  mouseTrackingMode: Terminal["modes"]["mouseTrackingMode"],
  options: Terminal["options"] = {},
): Pick<Terminal, "modes" | "options"> => ({
  modes: {
    applicationCursorKeysMode: false,
    applicationKeypadMode: false,
    bracketedPasteMode: false,
    insertMode: false,
    mouseTrackingMode,
    originMode: false,
    reverseWraparoundMode: false,
    sendFocusMode: false,
    synchronizedOutputMode: false,
    showCursor: true,
    win32InputMode: false,
    wraparoundMode: true,
  },
  options,
});

const PLAIN = { altKey: false, shiftKey: false };
const SHIFT = { ...PLAIN, shiftKey: true };
const ALT = { ...PLAIN, altKey: true };

describe("isTerminalApplicationMouseEvent", () => {
  it.each(["none", "x10", "vt200", "drag", "any"] as const)(
    "uses the live %s tracking mode",
    (mode) => {
      expect(isTerminalApplicationMouseEvent(terminalState(mode), PLAIN, "Linux x86_64")).toBe(
        mode !== "none",
      );
    },
  );

  it.each(["Linux x86_64", "Win32", "", "iPad", "iPhone"])(
    "honors xterm's Shift override on %s",
    (platform) => {
      expect(isTerminalApplicationMouseEvent(terminalState("drag"), SHIFT, platform)).toBe(false);
      expect(isTerminalApplicationMouseEvent(terminalState("drag"), ALT, platform)).toBe(true);
    },
  );

  it.each(["Macintosh", "MacIntel", "MacPPC", "Mac68K"])(
    "honors xterm's configured Option override on %s",
    (platform) => {
      expect(isTerminalApplicationMouseEvent(terminalState("drag"), SHIFT, platform)).toBe(true);
      expect(isTerminalApplicationMouseEvent(terminalState("drag"), ALT, platform)).toBe(true);
      expect(
        isTerminalApplicationMouseEvent(
          terminalState("drag", { macOptionClickForcesSelection: true }),
          ALT,
          platform,
        ),
      ).toBe(false);
      expect(
        isTerminalApplicationMouseEvent(
          terminalState("drag", { macOptionClickForcesSelection: true }),
          PLAIN,
          platform,
        ),
      ).toBe(true);
    },
  );

  it.each(["Linux x86_64", "MacIntel"])(
    "prioritizes Alt gating over selection modifiers on %s",
    (platform) => {
      const terminal = terminalState("any", {
        mouseEventsRequireAlt: true,
        macOptionClickForcesSelection: true,
      });
      expect(isTerminalApplicationMouseEvent(terminal, PLAIN, platform)).toBe(false);
      expect(isTerminalApplicationMouseEvent(terminal, SHIFT, platform)).toBe(false);
      expect(isTerminalApplicationMouseEvent(terminal, ALT, platform)).toBe(true);
      expect(
        isTerminalApplicationMouseEvent(terminal, { altKey: true, shiftKey: true }, platform),
      ).toBe(true);
      expect(
        isTerminalApplicationMouseEvent(terminalState("none", terminal.options), ALT, platform),
      ).toBe(false);
    },
  );
});
