import { Command } from "commander";
import { describe, expect, it } from "vite-plus/test";
import { resolveCompletionContext } from "@monotykamary/localterm-server/completion";
import { serializeProgram } from "../../src/utils/serialize-program.js";

// A representative slice of the localterm CLI tree — enough to exercise
// subcommand descent, option-value skipping, negated booleans, nested
// commands, and the internal-command filter. `serializeProgram` walks it into
// the plain-data CommandSpec the daemon (and the CLI fallback) walk.
const buildSpec = () => {
  const program = new Command();
  program.name("localterm");
  program.command("start").option("-p, --port <port>", "").option("--open", "");
  const session = program.command("session");
  session.command("kill <id>");
  session.command("new").option("--cwd <path>", "").option("--no-pin", "");
  session.command("exec <id> <command>");
  const mouse = session.command("mouse");
  mouse.command("click <id>");
  mouse.command("scroll <id>").argument("<direction>");
  program.command("_completion", { hidden: true });
  return serializeProgram(program);
};

describe("serializeProgram", () => {
  it("drops internal (underscore-prefixed) commands", () => {
    const spec = buildSpec();
    const names = spec.subcommands.map((child) => child.name);
    expect(names).not.toContain("_completion");
    expect(names).toContain("session");
  });
});

describe("resolveCompletionContext", () => {
  const spec = buildSpec();

  it("resolves the program root with an empty current word", () => {
    const context = resolveCompletionContext(spec, ["localterm", ""]);
    expect(context.command.name).toBe("");
    expect(context.positionalIndex).toBe(0);
    expect(context.currentWord).toBe("");
    expect(context.completingOptionValue).toBeNull();
  });

  it("descends into a subcommand and resets the positional index", () => {
    const context = resolveCompletionContext(spec, ["localterm", "session", ""]);
    expect(context.command.name).toBe("session");
    expect(context.positionalIndex).toBe(0);
  });

  it("descends through nested subcommands", () => {
    const context = resolveCompletionContext(spec, ["localterm", "session", "mouse", "scroll", ""]);
    expect(context.command.name).toBe("scroll");
    expect(context.positionalIndex).toBe(0);
  });

  it("counts typed positionals without descending further", () => {
    const context = resolveCompletionContext(spec, ["localterm", "session", "kill", "abc123", ""]);
    expect(context.command.name).toBe("kill");
    expect(context.positionalIndex).toBe(1);
  });

  it("places the cursor on the second positional after one is typed", () => {
    const context = resolveCompletionContext(spec, [
      "localterm",
      "session",
      "mouse",
      "scroll",
      "abc123",
      "",
    ]);
    expect(context.command.name).toBe("scroll");
    expect(context.positionalIndex).toBe(1);
  });

  it("marks the current word as an option-value when the previous token is a value-taking option", () => {
    const context = resolveCompletionContext(spec, ["localterm", "start", "--port", ""]);
    expect(context.command.name).toBe("start");
    expect(context.completingOptionValue?.long).toBe("--port");
  });

  it("handles short flags that take a value", () => {
    const context = resolveCompletionContext(spec, ["localterm", "start", "-p", ""]);
    expect(context.completingOptionValue?.short).toBe("-p");
  });

  it("does not expect a value after a negated boolean option like --no-pin", () => {
    const context = resolveCompletionContext(spec, ["localterm", "session", "new", "--no-pin", ""]);
    expect(context.completingOptionValue).toBeNull();
    expect(context.positionalIndex).toBe(0);
  });

  it("consumes an option's inline value and resumes positionals", () => {
    const context = resolveCompletionContext(spec, [
      "localterm",
      "session",
      "new",
      "--cwd",
      "/tmp",
      "",
    ]);
    expect(context.completingOptionValue).toBeNull();
    expect(context.positionalIndex).toBe(0);
  });

  it("treats a current word starting with - as flag completion regardless of a pending option value", () => {
    const context = resolveCompletionContext(spec, ["localterm", "start", "--port", "--"]);
    expect(context.currentWord).toBe("--");
    expect(context.completingOptionValue).toBeNull();
  });

  it("does not descend into an internal (underscore) command", () => {
    const context = resolveCompletionContext(spec, ["localterm", "_completion", ""]);
    expect(context.command.name).toBe("");
    expect(context.positionalIndex).toBe(1);
  });

  it("ignores a bare -- separator passed through from the shell call", () => {
    const context = resolveCompletionContext(spec, ["localterm", "session", "--", "kill", ""]);
    expect(context.command.name).toBe("kill");
    expect(context.positionalIndex).toBe(0);
  });

  it("defaults the current word to empty when the word list is empty", () => {
    const context = resolveCompletionContext(spec, []);
    expect(context.currentWord).toBe("");
    expect(context.command.name).toBe("");
  });
});
