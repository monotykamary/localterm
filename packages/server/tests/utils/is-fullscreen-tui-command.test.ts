import { describe, expect, it } from "vite-plus/test";

import { isFullscreenTuiCommand } from "../../src/utils/is-fullscreen-tui-command.js";

describe("isFullscreenTuiCommand", () => {
  it("matches a bare fullscreen TUI as the first token", () => {
    expect(isFullscreenTuiCommand("nvim file.txt && exit")).toBe(true);
    expect(isFullscreenTuiCommand("vim README.md")).toBe(true);
    expect(isFullscreenTuiCommand("less log.txt")).toBe(true);
    expect(isFullscreenTuiCommand("htop")).toBe(true);
    expect(isFullscreenTuiCommand("tmux")).toBe(true);
  });

  it("resolves the basename of an absolute or relative path", () => {
    expect(isFullscreenTuiCommand("/usr/bin/nvim file.txt && exit")).toBe(true);
    expect(isFullscreenTuiCommand("/opt/homebrew/bin/htop")).toBe(true);
    expect(isFullscreenTuiCommand("./bin/nvim file.txt")).toBe(true);
  });

  it("does not match a non-TUI command (automation / setup / shell builtins)", () => {
    expect(isFullscreenTuiCommand("echo INITIAL_COMMAND_RUNS_TOKEN")).toBe(false);
    expect(isFullscreenTuiCommand("git pull --ff-only origin main")).toBe(false);
    expect(isFullscreenTuiCommand("npm run sync-mcr")).toBe(false);
    expect(isFullscreenTuiCommand("bash setup.sh")).toBe(false);
    expect(isFullscreenTuiCommand("set -e")).toBe(false);
  });

  it("does not match a multi-line setup script whose first token isn't a TUI", () => {
    expect(isFullscreenTuiCommand("set -e\ngit worktree add .\nnpm install")).toBe(false);
  });

  it("matches a multi-line command whose first token is a TUI", () => {
    expect(isFullscreenTuiCommand("nvim file.txt\n")).toBe(true);
  });

  it("ignores leading whitespace", () => {
    expect(isFullscreenTuiCommand("  nvim file.txt")).toBe(true);
  });
});
