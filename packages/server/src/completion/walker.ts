import type { CommandSpec, CommandSpecNode, OptionSpec } from "./spec.js";

export interface CompletionContext {
  command: CommandSpecNode;
  positionalIndex: number;
  currentWord: string;
  completingOptionValue: OptionSpec | null;
}

const splitFlag = (token: string): [string, string | undefined] => {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) return [token, undefined];
  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
};

const findOption = (node: CommandSpecNode, flag: string): OptionSpec | null => {
  for (const option of node.options) {
    if (option.long === flag || option.short === flag) return option;
  }
  return null;
};

const findSubcommand = (node: CommandSpecNode, name: string): CommandSpecNode | null => {
  for (const child of node.subcommands) {
    if (child.name === name || child.aliases.includes(name)) return child;
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
  spec: CommandSpec,
  words: readonly string[],
): CompletionContext => {
  const previousTokens = words.slice(1, -1);
  const currentWord = words[words.length - 1] ?? "";

  let current = spec;
  let positionalIndex = 0;
  let expectingOptionValue: OptionSpec | null = null;

  for (const token of previousTokens) {
    if (token === "--") continue;
    if (expectingOptionValue) {
      expectingOptionValue = null;
      continue;
    }
    if (token.startsWith("--")) {
      const [flag, inlineValue] = splitFlag(token);
      const option = findOption(current, flag);
      if (option && option.takesValue && inlineValue === undefined) {
        expectingOptionValue = option;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const [flag, inlineValue] = splitFlag(token);
      const option = findOption(current, flag);
      if (option && option.takesValue && inlineValue === undefined) {
        expectingOptionValue = option;
      }
      continue;
    }
    const subcommand = findSubcommand(current, token);
    if (subcommand) {
      current = subcommand;
      positionalIndex = 0;
      continue;
    }
    positionalIndex += 1;
  }

  if (currentWord.startsWith("-")) {
    return { command: current, positionalIndex, currentWord, completingOptionValue: null };
  }
  return {
    command: current,
    positionalIndex,
    currentWord,
    completingOptionValue: expectingOptionValue,
  };
};
