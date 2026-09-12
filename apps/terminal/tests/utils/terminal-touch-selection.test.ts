import { describe, expect, it, vi } from "vite-plus/test";
import {
  getTerminalCellFromPoint,
  selectTerminalRange,
} from "../../src/utils/terminal-touch-selection";

describe("getTerminalCellFromPoint", () => {
  it("maps client coordinates onto the visible buffer cell", () => {
    const screen = document.createElement("div");
    vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 80,
      height: 24,
      right: 90,
      bottom: 44,
      toJSON: () => ({}),
    });
    const terminal = { cols: 80, rows: 24, buffer: { active: { viewportY: 100 } } };

    expect(getTerminalCellFromPoint(screen, terminal, 10, 20)).toEqual({ col: 0, row: 100 });
    expect(getTerminalCellFromPoint(screen, terminal, 19.9, 21.9)).toEqual({ col: 9, row: 101 });
    expect(getTerminalCellFromPoint(screen, terminal, 89.9, 43.9)).toEqual({ col: 79, row: 123 });
  });

  it("returns null when the screen has no measurable cells", () => {
    const screen = document.createElement("div");
    vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });

    expect(
      getTerminalCellFromPoint(
        screen,
        { cols: 80, rows: 24, buffer: { active: { viewportY: 0 } } },
        1,
        1,
      ),
    ).toBeNull();
    expect(
      getTerminalCellFromPoint(
        screen,
        { cols: 0, rows: 24, buffer: { active: { viewportY: 0 } } },
        1,
        1,
      ),
    ).toBeNull();
  });
});

describe("selectTerminalRange", () => {
  it("selects forward and reversed ranges from the earlier cell", () => {
    const select = vi.fn();
    const terminal = { cols: 10, select };

    selectTerminalRange(terminal, { col: 2, row: 1 }, { col: 4, row: 1 });
    expect(select).toHaveBeenLastCalledWith(2, 1, 2);

    selectTerminalRange(terminal, { col: 4, row: 1 }, { col: 2, row: 1 });
    expect(select).toHaveBeenLastCalledWith(2, 1, 2);

    selectTerminalRange(terminal, { col: 9, row: 0 }, { col: 1, row: 1 });
    expect(select).toHaveBeenLastCalledWith(9, 0, 2);
  });

  it("selects at least one cell when the range is collapsed", () => {
    const select = vi.fn();
    selectTerminalRange({ cols: 10, select }, { col: 3, row: 2 }, { col: 3, row: 2 });
    expect(select).toHaveBeenCalledWith(3, 2, 1);
  });
});
