import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as state from "../../src/state.js";
import {
  runCompletion,
  runCompletionsPrint,
  unwireCompletions,
  wireCompletions,
} from "../../src/commands/completions.js";
import { hasCompletionBlock } from "../../src/utils/shell-completions.js";
import { createProgram } from "../../src/program.js";

let stdoutChunks: string[];
let stderrSpy: ReturnType<typeof vi.spyOn>;

const capturedStdout = (): string => stdoutChunks.join("");

beforeEach(() => {
  stdoutChunks = [];
  vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    stdoutChunks.push(typeof data === "string" ? data : data.toString());
    return true;
  });
  stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runCompletionsPrint", () => {
  it("prints the bash script", () => {
    runCompletionsPrint("bash");
    expect(capturedStdout()).toContain("complete -o default -F _localterm_completion localterm");
  });

  it("prints the zsh script", () => {
    runCompletionsPrint("zsh");
    expect(capturedStdout()).toContain("compdef _localterm localterm");
  });

  it("prints the fish script", () => {
    runCompletionsPrint("fish");
    expect(capturedStdout()).toContain('complete -c localterm -a "(__localterm_complete)" -f');
  });

  it("rejects an unsupported shell with an error and exit code", () => {
    runCompletionsPrint("tcsh");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("unknown shell 'tcsh'"));
    expect(process.exitCode).toBe(1);
    expect(capturedStdout()).toBe("");
  });
});

describe("runCompletion (static candidates)", () => {
  it("lists top-level commands, excluding the hidden _completion command", async () => {
    await runCompletion(createProgram(), ["localterm", ""]);
    const lines = capturedStdout().split("\n").filter(Boolean);
    expect(lines).toContain("session");
    expect(lines).toContain("completions");
    expect(lines).not.toContain("_completion");
    expect(lines).not.toContain("help");
  });

  it("lists subcommands of a command group", async () => {
    await runCompletion(createProgram(), ["localterm", "session", ""]);
    const lines = capturedStdout().split("\n").filter(Boolean);
    expect(lines).toContain("kill");
    expect(lines).toContain("mouse");
    expect(lines).toContain("send-keys");
  });

  it("lists nested subcommands", async () => {
    await runCompletion(createProgram(), ["localterm", "session", "mouse", ""]);
    const lines = capturedStdout().split("\n").filter(Boolean);
    expect(lines).toEqual(expect.arrayContaining(["click", "drag", "move", "scroll", "state"]));
  });

  it("offers static enum candidates for config identity providers", async () => {
    await runCompletion(createProgram(), ["localterm", "config", "identity", ""]);
    expect(capturedStdout().split("\n").filter(Boolean).sort()).toEqual([
      "header",
      "none",
      "oidc",
      "passkey",
    ]);
  });

  it("offers static enum candidates for the scroll direction positional", async () => {
    await runCompletion(createProgram(), ["localterm", "session", "mouse", "scroll", "abc", ""]);
    expect(capturedStdout().split("\n").filter(Boolean).sort()).toEqual(["down", "up"]);
  });

  it("offers option flags when the current word starts with --", async () => {
    await runCompletion(createProgram(), ["localterm", "session", "new", "--"]);
    const lines = capturedStdout().split("\n").filter(Boolean);
    expect(lines).toContain("--cwd");
    expect(lines).toContain("--no-pin");
    expect(lines).toContain("--json");
  });

  it("offers an option's argChoices when completing its value", async () => {
    await runCompletion(createProgram(), [
      "localterm",
      "config",
      "identity",
      "passkey",
      "--registration",
      "",
    ]);
    expect(capturedStdout().split("\n").filter(Boolean).sort()).toEqual(["closed", "open"]);
  });

  it("filters candidates by the current word's prefix", async () => {
    await runCompletion(createProgram(), ["localterm", "session", "ca"]);
    expect(capturedStdout().split("\n").filter(Boolean)).toEqual(["capture"]);
  });

  it("returns nothing for a free-text positional", async () => {
    await runCompletion(createProgram(), ["localterm", "session", "exec", "abc", ""]);
    expect(capturedStdout()).toBe("");
  });
});

describe("runCompletion (dynamic candidates from the daemon)", () => {
  it("lists live session ids by calling the daemon", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            sessions: [{ id: "aaaa1111" }, { id: "bbbb2222" }, { id: "cccc3333" }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    await runCompletion(createProgram(), ["localterm", "session", "kill", ""]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3417/api/sessions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(capturedStdout().split("\n").filter(Boolean)).toEqual([
      "aaaa1111",
      "bbbb2222",
      "cccc3333",
    ]);
  });

  it("filters live session ids by the current prefix", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sessions: [{ id: "aaaa1111" }, { id: "bbbb2222" }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runCompletion(createProgram(), ["localterm", "session", "kill", "aa"]);
    expect(capturedStdout().split("\n").filter(Boolean)).toEqual(["aaaa1111"]);
  });

  it("resolves to nothing when the daemon is down (no port file)", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await runCompletion(createProgram(), ["localterm", "session", "kill", ""]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(capturedStdout()).toBe("");
  });

  it("resolves to nothing when the daemon returns an error", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await runCompletion(createProgram(), ["localterm", "session", "kill", ""]);
    expect(capturedStdout()).toBe("");
  });

  it("lists secret names from the daemon", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          supported: true,
          secrets: [{ name: "anthropic_api_key" }, { name: "openai_api_key" }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await runCompletion(createProgram(), ["localterm", "secret", "get", ""]);
    expect(capturedStdout().split("\n").filter(Boolean).sort()).toEqual([
      "anthropic_api_key",
      "openai_api_key",
    ]);
  });

  it("lists process names from the daemon", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ processes: [{ name: "gh" }, { name: "pi" }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runCompletion(createProgram(), ["localterm", "process", "set", ""]);
    expect(capturedStdout().split("\n").filter(Boolean).sort()).toEqual(["gh", "pi"]);
  });
});

describe("wireCompletions / unwireCompletions", () => {
  let tempHome: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(os.tmpdir(), "localterm-wire-"));
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("rejects an unsupported shell", async () => {
    await wireCompletions("tcsh");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("unknown shell 'tcsh'"));
    expect(process.exitCode).toBe(1);
  });

  it("installs fish via the drop-dir (no rc edit)", async () => {
    await wireCompletions("fish");
    expect(
      existsSync(path.join(tempHome, ".config", "fish", "completions", "localterm.fish")),
    ).toBe(true);
    expect(existsSync(path.join(tempHome, ".config", "fish", "config.fish"))).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("fish completions installed"));
  });

  it("wires zsh via the rc block when no writable fpath dir exists", async () => {
    await wireCompletions("zsh");
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("zsh completions wired"));
  });

  it("unwires the zsh rc block", async () => {
    await wireCompletions("zsh");
    await unwireCompletions("zsh");
    expect(hasCompletionBlock(readFileSync(path.join(tempHome, ".zshrc"), "utf8"))).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("zsh completions removed"));
  });

  it("reports not-installed when unwiring an uninstalled shell", async () => {
    await unwireCompletions("zsh");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("were not installed"));
  });
});
