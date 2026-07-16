import { describe, expect, it } from "vite-plus/test";
import { isTerminalCursorTap } from "../../src/utils/is-terminal-cursor-tap";

const geometry = {
  isCursorVisible: true,
  tapClientX: 45,
  tapClientY: 70,
  screenLeft: 0,
  screenTop: 0,
  screenWidth: 800,
  screenHeight: 400,
  columns: 80,
  rows: 20,
  cursorColumn: 4,
  cursorRow: 3,
};

describe("isTerminalCursorTap", () => {
  it("accepts taps inside the expanded cursor target", () => {
    expect(isTerminalCursorTap(geometry)).toBe(true);
    expect(isTerminalCursorTap({ ...geometry, tapClientX: 67 })).toBe(true);
  });

  it("rejects taps outside the expanded cursor target", () => {
    expect(isTerminalCursorTap({ ...geometry, tapClientX: 68 })).toBe(false);
    expect(isTerminalCursorTap({ ...geometry, tapClientY: 93 })).toBe(false);
  });

  it("uses a full cell when cells exceed the minimum target size", () => {
    expect(
      isTerminalCursorTap({
        ...geometry,
        tapClientX: 50,
        screenWidth: 400,
        columns: 8,
        cursorColumn: 0,
      }),
    ).toBe(true);
  });

  it("rejects taps when the terminal cursor is hidden", () => {
    expect(isTerminalCursorTap({ ...geometry, isCursorVisible: false })).toBe(false);
  });

  it("rejects invalid terminal geometry", () => {
    expect(isTerminalCursorTap({ ...geometry, screenWidth: 0 })).toBe(false);
    expect(isTerminalCursorTap({ ...geometry, rows: 0 })).toBe(false);
  });
});
