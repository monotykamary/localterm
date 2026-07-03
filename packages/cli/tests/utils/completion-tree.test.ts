import { Command } from "commander";
import { describe, expect, it } from "vite-plus/test";
import { isInternalCommand, resolveCompletionContext } from "../../src/utils/completion-tree.js";

// A representative slice of the localterm CLI tree — enough to exercise
// subcommand descent, option-value skipping, negated booleans, nested
// commands, and the internal-command filter.
const buildTree = (): Command => {
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
  return program;
};

describe("isInternalCommand", () => {
  it("flags commands whose name starts with an underscore", () => {
    const program = buildTree();
    const completion = program.commands.find((child) => child.name() === "_completion");
    expect(completion).toBeDefined();
    expect(isInternalCommand(completion!)).toBe(true);
  });

  it("does not flag ordinary commands", () => {
    const program = buildTree();
    const session = program.commands.find((child) => child.name() === "session");
    expect(isInternalCommand(session!)).toBe(false);
  });
});

describe("resolveCompletionContext", () => {
  const tree = buildTree();

  it("resolves the program root with an empty current word", () => {
    const context = resolveCompletionContext(tree, ["localterm", ""]);
    expect(context.command.name()).toBe("localterm");
    expect(context.commandPath).toEqual([]);
    expect(context.positionalIndex).toBe(0);
    expect(context.currentWord).toBe("");
    expect(context.completingOptionValue).toBeNull();
  });

  it("descends into a subcommand and resets the positional index", () => {
    const context = resolveCompletionContext(tree, ["localterm", "session", ""]);
    expect(context.command.name()).toBe("session");
    expect(context.commandPath).toEqual(["session"]);
    expect(context.positionalIndex).toBe(0);
  });

  it("descends through nested subcommands", () => {
    const context = resolveCompletionContext(tree, ["localterm", "session", "mouse", "scroll", ""]);
    expect(context.command.name()).toBe("scroll");
    expect(context.commandPath).toEqual(["session", "mouse", "scroll"]);
    expect(context.positionalIndex).toBe(0);
  });

  it("counts typed positionals without descending further", () => {
    const context = resolveCompletionContext(tree, ["localterm", "session", "kill", "abc123", ""]);
    expect(context.command.name()).toBe("kill");
    expect(context.commandPath).toEqual(["session", "kill"]);
    expect(context.positionalIndex).toBe(1);
  });

  it("places the cursor on the second positional after one is typed", () => {
    const context = resolveCompletionContext(tree, [
      "localterm",
      "session",
      "mouse",
      "scroll",
      "abc123",
      "",
    ]);
    expect(context.command.name()).toBe("scroll");
    expect(context.positionalIndex).toBe(1);
  });

  it("marks the current word as an option-value when the previous token is a value-taking option", () => {
    const context = resolveCompletionContext(tree, ["localterm", "start", "--port", ""]);
    expect(context.command.name()).toBe("start");
    expect(context.completingOptionValue?.long).toBe("--port");
  });

  it("handles short flags that take a value", () => {
    const context = resolveCompletionContext(tree, ["localterm", "start", "-p", ""]);
    expect(context.completingOptionValue?.short).toBe("-p");
  });

  it("does not expect a value after a negated boolean option like --no-pin", () => {
    const context = resolveCompletionContext(tree, ["localterm", "session", "new", "--no-pin", ""]);
    expect(context.completingOptionValue).toBeNull();
    expect(context.positionalIndex).toBe(0);
  });

  it("consumes an option's inline value and resumes positionals", () => {
    const context = resolveCompletionContext(tree, [
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
    const context = resolveCompletionContext(tree, ["localterm", "start", "--port", "--"]);
    expect(context.currentWord).toBe("--");
    expect(context.completingOptionValue).toBeNull();
  });

  it("does not descend into an internal (underscore) command", () => {
    const context = resolveCompletionContext(tree, ["localterm", "_completion", ""]);
    expect(context.command.name()).toBe("localterm");
    expect(context.positionalIndex).toBe(1);
  });

  it("ignores a bare -- separator passed through from the shell call", () => {
    const context = resolveCompletionContext(tree, ["localterm", "session", "--", "kill", ""]);
    expect(context.command.name()).toBe("kill");
    expect(context.commandPath).toEqual(["session", "kill"]);
  });

  it("defaults the current word to empty when the word list is empty", () => {
    const context = resolveCompletionContext(tree, []);
    expect(context.currentWord).toBe("");
    expect(context.command.name()).toBe("localterm");
  });
});
