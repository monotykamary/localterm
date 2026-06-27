import { describe, expect, it } from "vite-plus/test";
import { TerminalModeState } from "../../src/utils/terminal-mode-state.js";

const ESC = "\x1b";

describe("TerminalModeState.restorePrefix", () => {
  it("is empty before any mode-set sequences are seen", () => {
    expect(new TerminalModeState().restorePrefix()).toBe("");
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
});
