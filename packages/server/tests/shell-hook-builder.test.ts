import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  LOCALTERM_STATE_DIRNAME,
  ZSH_EXEC_SHADOW_MAX_DEPTH,
  ZSH_HOOK_DIRNAME,
} from "../src/constants.js";
import { shimPathPrependLine } from "../src/secret-shims.js";
import { ShellHookBuilder } from "../src/shell-hook-builder.js";

interface PreparedHook {
  args: string[];
  envAdditions: Record<string, string> | null;
  content: string;
  cleanupPaths: string[];
}

describe("ShellHookBuilder", () => {
  let homeDir: string;
  let hookDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-hook-builder-"));
    hookDir = path.join(homeDir, LOCALTERM_STATE_DIRNAME, ZSH_HOOK_DIRNAME);
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const buildZshHook = (environment: Record<string, string>): PreparedHook => {
    const builder = new ShellHookBuilder({
      shimsDir: "/shims",
      reportInitialCommandExit: false,
      homeDir,
    });
    const [args, envAdditions] = builder.prepare("zsh", environment);
    const content = fs.readFileSync(path.join(hookDir, ".zshrc"), "utf8");
    return { args, envAdditions, content, cleanupPaths: builder.hookCleanupPaths };
  };

  describe("zsh", () => {
    it("writes the hook rc into a stable per-user dir and returns it as ZDOTDIR", () => {
      const { args, envAdditions, cleanupPaths } = buildZshHook({ ZDOTDIR: "/real/zdot" });

      expect(args).toEqual([]);
      expect(envAdditions).toEqual({
        ZDOTDIR: hookDir,
        __LOCALTERM_ORIG_ZDOTDIR: "/real/zdot",
      });
      // Must survive session cleanup: exec'd wrapper shells (and long-lived
      // servers like tmux) re-source this dir after the tab is gone.
      expect(cleanupPaths).toEqual([]);
    });

    it("defaults the user zdotdir to the home dir", () => {
      const { envAdditions } = buildZshHook({});

      expect(envAdditions).toMatchObject({ __LOCALTERM_ORIG_ZDOTDIR: homeDir });
    });

    it("prefers __LOCALTERM_ORIG_ZDOTDIR over ZDOTDIR for sourcing the user rc", () => {
      const { content } = buildZshHook({
        ZDOTDIR: hookDir,
        __LOCALTERM_ORIG_ZDOTDIR: "/real/zdot",
      });

      expect(content).toContain(`source '/real/zdot/.zshrc' 2>/dev/null`);
    });

    it("guards against same-process re-sourcing of the hook", () => {
      const { content } = buildZshHook({});

      const lines = content.split("\n");
      expect(lines[0]).toBe('[[ -n "${__LOCALTERM_HOOK_SOURCED:-}" ]] && return 0');
      expect(lines[1]).toBe("__LOCALTERM_HOOK_SOURCED=1");
    });

    it("shadows rc-level exec so wrapper child shells re-inherit the hook dir", () => {
      const { content } = buildZshHook({});

      expect(content).toContain("exec() {");
      expect(content).toContain('typeset -x ZDOTDIR="$__localterm_hook_zdotdir"');
      expect(content).toContain(`__localterm_exec_depth > ${ZSH_EXEC_SHADOW_MAX_DEPTH}`);
      // Redirection-only and flag forms delegate untouched.
      expect(content).toContain('[[ "$1" == -* ]]');
      expect(content).toContain('builtin exec "$@"');
      // Bypasses the user-rc 2>/dev/null so the refusal warning is visible.
      expect(content).toContain("2>/dev/tty");
    });

    it("removes the exec shadow after the user's rc files ran", () => {
      const { content } = buildZshHook({});

      const zshrcSourceIndex = content.indexOf(".zshrc' 2>/dev/null");
      const unfunctionIndex = content.indexOf("unfunction exec");
      expect(zshrcSourceIndex).toBeGreaterThan(-1);
      expect(unfunctionIndex).toBeGreaterThan(zshrcSourceIndex);
    });

    it("prepends the shims dir after the user's zshrc ran", () => {
      const { content } = buildZshHook({});

      expect(content.indexOf(shimPathPrependLine("/shims"))).toBeGreaterThan(
        content.indexOf(".zshrc' 2>/dev/null"),
      );
    });

    it("always installs the automation-exit hook, gated at runtime by LOCALTERM_INITIAL_COMMAND", () => {
      const { content } = buildZshHook({});

      expect(content).toContain("__localterm_automation_exit_precmd()");
      expect(content).toContain('if [ -n "${LOCALTERM_INITIAL_COMMAND:-}" ]; then');
    });

    it("regenerates the hook file idempotently across sessions", () => {
      const first = buildZshHook({});
      const second = buildZshHook({});

      expect(second.content).toBe(first.content);
    });
  });

  describe("bash", () => {
    it("keeps a per-session --rcfile with session cleanup", () => {
      const builder = new ShellHookBuilder({
        shimsDir: "/shims",
        reportInitialCommandExit: false,
        homeDir,
      });
      const [args, envAdditions] = builder.prepare("bash", {});

      expect(args[0]).toBe("--rcfile");
      expect(args[1]).toContain("localterm-bash-");
      expect(envAdditions).toBeNull();
      expect(builder.hookCleanupPaths).toHaveLength(1);
      fs.rmSync(builder.hookCleanupPaths[0], { recursive: true, force: true });
    });
  });
});
