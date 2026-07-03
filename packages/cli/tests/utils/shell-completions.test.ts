import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildCompletionBlock,
  completionDropFile,
  hasCompletionBlock,
  rcPathFor,
  rcRelativePath,
  removeCompletionBlock,
  resolveZshDropFile,
  setupShellCompletions,
  sourceLineFor,
  teardownShellCompletions,
  unwireShellCompletions,
  wireShellCompletions,
} from "../../src/utils/shell-completions.js";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let tempHome: string;
let originalShell: string | undefined;

const bashCompletionUserDirUnder = (home: string): string =>
  path.join(home, ".local", "share", "bash-completion", "completions");

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  tempHome = mkdtempSync(path.join(os.tmpdir(), "localterm-completions-"));
  vi.spyOn(os, "homedir").mockReturnValue(tempHome);
  originalShell = process.env.SHELL;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempHome, { recursive: true, force: true });
  process.env.SHELL = originalShell;
});

describe("rc paths and source lines", () => {
  it("maps each shell to its rc file", () => {
    expect(rcRelativePath("bash")).toBe(".bashrc");
    expect(rcRelativePath("zsh")).toBe(".zshrc");
    expect(rcRelativePath("fish")).toBe(".config/fish/config.fish");
    expect(rcRelativePath("tcsh")).toBeNull();
  });

  it("resolves rc paths under the home directory", () => {
    expect(rcPathFor("zsh")).toBe(path.join(tempHome, ".zshrc"));
    expect(rcPathFor("fish")).toBe(path.join(tempHome, ".config", "fish", "config.fish"));
  });

  it("guards the bash line so it's a no-op when localterm is off PATH", () => {
    expect(sourceLineFor("bash")).toBe(
      'command -v localterm >/dev/null 2>&1 && eval "$(localterm completions bash)"',
    );
  });

  it("guards and lazy-loads the zsh line (defers the spawn to the first Tab)", () => {
    const line = sourceLineFor("zsh");
    expect(line).toContain("command -v localterm >/dev/null 2>&1");
    expect(line).toContain("command -v compdef >/dev/null 2>&1");
    expect(line).toContain("_localterm_lazy()");
    expect(line).toContain('eval "$(localterm completions zsh)"');
    expect(line).toContain("compdef _localterm_lazy localterm");
  });

  it("guards the fish line so it's a no-op when localterm is off PATH", () => {
    expect(sourceLineFor("fish")).toBe(
      "type -q localterm; and localterm completions fish | source",
    );
  });
});

describe("completion block helpers", () => {
  it("builds a block bounded by the markers", () => {
    const block = buildCompletionBlock("zsh");
    expect(block).toContain("# >>> localterm completions >>>");
    expect(block).toContain('eval "$(localterm completions zsh)"');
    expect(block).toContain("# <<< localterm completions <<<");
  });

  it("detects an installed block", () => {
    expect(hasCompletionBlock(buildCompletionBlock("bash"))).toBe(true);
    expect(hasCompletionBlock("nothing here\njust rc\n")).toBe(false);
  });

  it("removes the managed block and preserves surrounding content", () => {
    const content = ["alias x='y'", "", buildCompletionBlock("zsh"), "export FOO=bar", ""].join(
      "\n",
    );
    expect(hasCompletionBlock(content)).toBe(true);
    const removed = removeCompletionBlock(content);
    expect(hasCompletionBlock(removed)).toBe(false);
    expect(removed).toContain("alias x='y'");
    expect(removed).toContain("export FOO=bar");
  });

  it("leaves content unchanged when no block is present", () => {
    const content = "alias x='y'\n";
    expect(removeCompletionBlock(content)).toBe(content);
  });
});

describe("resolveZshDropFile", () => {
  it("picks the first writable fpath directory under the home", () => {
    const dir = path.join(tempHome, "zshcomp");
    mkdirSync(dir, { recursive: true });
    expect(resolveZshDropFile(["/usr/share/zsh/functions", dir])).toBe(
      path.join(dir, "_localterm"),
    );
  });

  it("returns null when no fpath directory is under the home", () => {
    expect(
      resolveZshDropFile(["/usr/share/zsh/functions", "/usr/local/share/zsh/site-functions"]),
    ).toBeNull();
  });

  const isRoot = (process.getuid?.() ?? 1) === 0;
  (isRoot ? it.skip : it)("returns null when the under-home directory is not writable", () => {
    const dir = path.join(tempHome, "zshcomp");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o555);
    try {
      expect(resolveZshDropFile([dir])).toBeNull();
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});

describe("completionDropFile", () => {
  it("always returns the fish completions path", async () => {
    expect(await completionDropFile("fish")).toBe(
      path.join(tempHome, ".config", "fish", "completions", "localterm.fish"),
    );
  });

  it("returns null for bash when the bash-completion user dir is absent", async () => {
    expect(await completionDropFile("bash")).toBeNull();
  });

  it("returns the bash path when the bash-completion user dir exists", async () => {
    mkdirSync(bashCompletionUserDirUnder(tempHome), { recursive: true });
    expect(await completionDropFile("bash")).toBe(
      path.join(bashCompletionUserDirUnder(tempHome), "localterm"),
    );
  });

  it("returns null for zsh with no writable under-home fpath directory", async () => {
    expect(await completionDropFile("zsh")).toBeNull();
  });

  it("returns null for an unsupported shell", async () => {
    expect(await completionDropFile("tcsh")).toBeNull();
  });
});

describe("wireShellCompletions", () => {
  it("writes the fish completion to the drop-dir and leaves the rc untouched", async () => {
    const result = await wireShellCompletions("fish");
    expect(result.method).toBe("drop-dir");
    expect(result.path).toBe(
      path.join(tempHome, ".config", "fish", "completions", "localterm.fish"),
    );
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf8")).toContain("__localterm_complete");
    expect(existsSync(path.join(tempHome, ".config", "fish", "config.fish"))).toBe(false);
  });

  it("writes the zsh rc block when no writable fpath directory exists", async () => {
    const result = await wireShellCompletions("zsh");
    expect(result.method).toBe("rc");
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(true);
  });

  it("writes the bash rc block when the bash-completion dir is absent", async () => {
    const result = await wireShellCompletions("bash");
    expect(result.method).toBe("rc");
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".bashrc"), "utf8"))).toBe(true);
  });

  it("writes the bash drop-file when the bash-completion dir exists", async () => {
    mkdirSync(bashCompletionUserDirUnder(tempHome), { recursive: true });
    const result = await wireShellCompletions("bash");
    expect(result.method).toBe("drop-dir");
    expect(existsSync(path.join(bashCompletionUserDirUnder(tempHome), "localterm"))).toBe(true);
    expect(existsSync(path.join(tempHome, ".bashrc"))).toBe(false);
  });

  it("removes an existing rc block when switching to the drop-dir", async () => {
    const fishConfig = path.join(tempHome, ".config", "fish", "config.fish");
    mkdirSync(path.dirname(fishConfig), { recursive: true });
    writeFileSync(fishConfig, `${buildCompletionBlock("fish")}\n`, "utf8");
    await wireShellCompletions("fish");
    expect(hasCompletionBlock(readFileSync(fishConfig, "utf8"))).toBe(false);
  });

  it("is idempotent on the rc path", async () => {
    await wireShellCompletions("zsh");
    await wireShellCompletions("zsh");
    const content = readFileSync(path.join(tempHome, ".zshrc"), "utf8");
    expect((content.match(/# >>> localterm completions >>>/g) ?? []).length).toBe(1);
  });
});

describe("unwireShellCompletions", () => {
  it("removes the rc block", async () => {
    await wireShellCompletions("zsh");
    const result = await unwireShellCompletions("zsh");
    expect(result.rcRemoved).toBe(true);
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(false);
  });

  it("removes the drop-file", async () => {
    await wireShellCompletions("fish");
    const result = await unwireShellCompletions("fish");
    expect(result.dropRemoved).toBe(true);
    expect(
      existsSync(path.join(tempHome, ".config", "fish", "completions", "localterm.fish")),
    ).toBe(false);
  });

  it("reports nothing removed when not installed", async () => {
    const result = await unwireShellCompletions("zsh");
    expect(result.rcRemoved).toBe(false);
    expect(result.dropRemoved).toBe(false);
  });
});

describe("setupShellCompletions (localterm install step)", () => {
  it("wires the detected zsh shell via the rc block", async () => {
    process.env.SHELL = "/bin/zsh";
    await setupShellCompletions();
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(true);
  });

  it("wires fish via the drop-dir (no rc edit)", async () => {
    process.env.SHELL = "/usr/local/bin/fish";
    await setupShellCompletions();
    expect(
      existsSync(path.join(tempHome, ".config", "fish", "completions", "localterm.fish")),
    ).toBe(true);
    expect(existsSync(path.join(tempHome, ".config", "fish", "config.fish"))).toBe(false);
  });

  it("skips with a warning when $SHELL is unsupported", async () => {
    process.env.SHELL = "/bin/tcsh";
    await setupShellCompletions();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("not bash/zsh/fish"));
  });
});

describe("teardownShellCompletions (localterm uninstall step)", () => {
  it("removes completions from every supported shell (both methods)", async () => {
    await wireShellCompletions("zsh"); // rc
    await wireShellCompletions("fish"); // drop-dir
    await wireShellCompletions("bash"); // rc (no bash-completion dir)
    await teardownShellCompletions();
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(false);
    expect(
      existsSync(path.join(tempHome, ".config", "fish", "completions", "localterm.fish")),
    ).toBe(false);
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".bashrc"), "utf8"))).toBe(false);
  });

  it("reports not-installed when nothing is wired", async () => {
    await teardownShellCompletions();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("were not installed"));
  });
});
