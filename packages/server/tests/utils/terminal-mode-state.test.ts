import { describe, expect, it } from "vite-plus/test";
import {
  DECRQM_FOCUS_QUERY,
  decrqmFocusResponse,
  extractDecrqmFocusQueries,
  TERMINAL_FOCUS_IN_SEQUENCE,
  TERMINAL_FOCUS_OUT_SEQUENCE,
  TerminalModeState,
} from "../../src/utils/terminal-mode-state.js";

const ESC = "\x1b";

describe("TerminalModeState replay restoration", () => {
  it("is empty before any mode-set sequences are seen", () => {
    const state = new TerminalModeState();
    expect(state.restorePrefix()).toBe("");
    expect(state.restoreReplay("output")).toBe("output");
  });

  it("restores alt-screen enter and mouse enable for a running TUI", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1049h${ESC}[?1002h${ESC}[?1006h`);
    expect(state.restorePrefix()).toBe(`${ESC}[?1002h${ESC}[?1006h${ESC}[?1049h`);
  });

  it("clears a mode when its DECRST is seen later", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1049h${ESC}[?1002h${ESC}[?1049l`);
    expect(state.restorePrefix()).toBe(`${ESC}[?1002h`);
  });

  it("last write wins across many updates", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1002h`);
    state.update(`${ESC}[?1002l`);
    state.update(`${ESC}[?1002h`);
    expect(state.restorePrefix()).toBe(`${ESC}[?1002h`);
  });

  it("restores bracketed paste mode 2004", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?2004h`);
    expect(state.restorePrefix()).toBe(`${ESC}[?2004h`);
  });

  it("ignores untracked private modes (e.g. 2026 synchronized output)", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?2026h${ESC}[?2026l`);
    expect(state.restorePrefix()).toBe("");
  });

  it("does not restore cursor visibility by default (client default ?25h stands)", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1049h`);
    expect(state.restorePrefix()).not.toContain(`[?25h`);
  });

  it("restores cursor hide (?25l) when a TUI hid the cursor", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?25l`);
    expect(state.restorePrefix()).toBe(`${ESC}[?25l`);
  });

  it("clears cursor hide when ?25h is seen again", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?25l${ESC}[?25h`);
    expect(state.restorePrefix()).toBe("");
  });

  it("keeps mouse enabled across a buffer switch (mouse is a global mode)", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1002h${ESC}[?1049h${ESC}[?1049l`);
    expect(state.restorePrefix()).toBe(`${ESC}[?1002h`);
  });

  it("scans multiple DECSET sequences in one chunk", () => {
    const state = new TerminalModeState();
    state.update(`some output${ESC}[?1049h${ESC}[?2004h${ESC}[?1006hmore output`);
    expect(state.restorePrefix()).toBe(`${ESC}[?1006h${ESC}[?1049h${ESC}[?2004h`);
  });

  it("reasserts a Kitty keyboard stack after the retained replay bytes", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[>7u${ESC}[>3u`);
    expect(state.restoreReplay("recent output")).toBe(
      `recent output${ESC}[<16u${ESC}[>7u${ESC}[>3u`,
    );
  });

  it("tracks Kitty keyboard pops and set modes", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[=4u${ESC}[=2;2u${ESC}[=4;3u${ESC}[>7u${ESC}[>3u${ESC}[<1u`);
    expect(state.restoreReplay("output")).toBe(`output${ESC}[<16u${ESC}[=2u${ESC}[>7u`);
  });

  it("tracks Kitty keyboard modes independently across screen buffers", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[>7u${ESC}[?1049h${ESC}[>3u`);
    expect(state.restoreReplay("alternate")).toBe(`${ESC}[?1049halternate${ESC}[<16u${ESC}[>3u`);

    state.update(`${ESC}[?1049l`);
    expect(state.restoreReplay("main")).toBe(`main${ESC}[<16u${ESC}[>7u`);
  });

  it("tracks Kitty keyboard requests split across PTY chunks", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[>`);
    state.update("7u");
    expect(state.restoreReplay("output")).toBe(`output${ESC}[<16u${ESC}[>7u`);
  });

  it("clears tracked modes on a hard terminal reset", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1049h${ESC}[>7u${ESC}c`);
    expect(state.restoreReplay("output")).toBe("output");
  });
});

describe("TerminalModeState focus reporting", () => {
  it("is disabled until CSI ? 1004 h is seen", () => {
    const state = new TerminalModeState();
    expect(state.focusReportingEnabled).toBe(false);
    state.update(`${ESC}[?1004h`);
    expect(state.focusReportingEnabled).toBe(true);
    state.update(`${ESC}[?1004l`);
    expect(state.focusReportingEnabled).toBe(false);
  });

  it("tracks 1004 across batched private mode sequences", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1049;1004;2004h`);
    expect(state.focusReportingEnabled).toBe(true);
  });

  it("clears focus reporting on a hard terminal reset", () => {
    const state = new TerminalModeState();
    state.update(`${ESC}[?1004h`);
    state.update(`${ESC}c`);
    expect(state.focusReportingEnabled).toBe(false);
  });
});

describe("DECRQM focus query helpers", () => {
  it("extracts queries anywhere in a chunk, preserving other bytes", () => {
    expect(extractDecrqmFocusQueries(DECRQM_FOCUS_QUERY)).toEqual({ data: "", count: 1 });
    expect(extractDecrqmFocusQueries(`render${DECRQM_FOCUS_QUERY}more`)).toEqual({
      data: "rendermore",
      count: 1,
    });
    expect(extractDecrqmFocusQueries(`${DECRQM_FOCUS_QUERY}${DECRQM_FOCUS_QUERY}`)).toEqual({
      data: "",
      count: 2,
    });
    expect(extractDecrqmFocusQueries(`${ESC}[?1003$p`)).toEqual({
      data: `${ESC}[?1003$p`,
      count: 0,
    });
  });

  it("answers set or reset per the tracked mode state", () => {
    expect(decrqmFocusResponse(true)).toBe(`${ESC}[?1004;1$y`);
    expect(decrqmFocusResponse(false)).toBe(`${ESC}[?1004;2$y`);
  });

  it("emits the canonical focus in/out input sequences", () => {
    expect(TERMINAL_FOCUS_IN_SEQUENCE).toBe(`${ESC}[I`);
    expect(TERMINAL_FOCUS_OUT_SEQUENCE).toBe(`${ESC}[O`);
  });
});
