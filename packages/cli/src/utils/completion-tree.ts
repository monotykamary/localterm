import type { Command, Option } from "commander";

export interface CompletionContext {
  command: Command;
  commandPath: readonly string[];
  positionalIndex: number;
  currentWord: string;
  completingOptionValue: Option | null;
}

// Commander tracks a command's hidden flag on an internal `_hidden` field with
// no public getter in the typings, so completion filters internal commands by
// the `_`-prefix convention (our hidden commands, e.g. `_completion`, follow it).
export const isInternalCommand = (command: Command): boolean => command.name().startsWith("_");

const optionTakesValue = (option: Option): boolean => option.required || option.optional;

const splitFlag = (token: string): [string, string | undefined] => {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) return [token, undefined];
  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
};

const findOption = (command: Command, flag: string): Option | null => {
  for (const option of command.options) {
    if (option.long === flag || option.short === flag) return option;
  }
  return null;
};

const findSubcommand = (command: Command, name: string): Command | null => {
  for (const child of command.commands) {
    if (isInternalCommand(child)) continue;
    if (child.name() === name) return child;
    if (child.aliases().includes(name)) return child;
  }
  return null;
};

// Walk the already-typed tokens to find the deepest command, how many
// positionals have been consumed, and whether the current (partial) word is the
// value for an option that takes one. `words` is the full command line the shell
// passed: words[0] is the program name, the last element is the partial current
// word (possibly ""), and everything between is the previously typed tokens.
// Options that take a value skip their following token; subcommands descend and
// reset the positional count; anything else is a positional argument.
export const resolveCompletionContext = (
  program: Command,
  words: readonly string[],
): CompletionContext => {
  const previousTokens = words.slice(1, -1);
  const currentWord = words[words.length - 1] ?? "";

  let current = program;
  let commandPath: string[] = [];
  let positionalIndex = 0;
  let expectingOptionValue: Option | null = null;

  for (const token of previousTokens) {
    if (token === "--") continue;
    if (expectingOptionValue) {
      expectingOptionValue = null;
      continue;
    }
    if (token.startsWith("--")) {
      const [flag, inlineValue] = splitFlag(token);
      const option = findOption(current, flag);
      if (option && optionTakesValue(option) && inlineValue === undefined) {
        expectingOptionValue = option;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const [flag, inlineValue] = splitFlag(token);
      const option = findOption(current, flag);
      if (option && optionTakesValue(option) && inlineValue === undefined) {
        expectingOptionValue = option;
      }
      continue;
    }
    const subcommand = findSubcommand(current, token);
    if (subcommand) {
      current = subcommand;
      commandPath = [...commandPath, subcommand.name()];
      positionalIndex = 0;
      continue;
    }
    positionalIndex += 1;
  }

  if (currentWord.startsWith("-")) {
    return {
      command: current,
      commandPath,
      positionalIndex,
      currentWord,
      completingOptionValue: null,
    };
  }
  return {
    command: current,
    commandPath,
    positionalIndex,
    currentWord,
    completingOptionValue: expectingOptionValue,
  };
};
