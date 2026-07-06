import type { CommandSpecNode } from "./spec.js";
import type { CompletionContext } from "./walker.js";

// Resolves live names for dynamic positionals. The CLI implements this with
// loopback HTTP fetches against the daemon; the daemon implements it against
// its in-memory session/secret/process stores — same names, no self-HTTP.
export interface ValueSource {
  sessions: () => Promise<string[]>;
  secrets: () => Promise<string[]>;
  processes: () => Promise<string[]>;
  themes: () => Promise<string[]>;
  customThemes: () => Promise<string[]>;
}

const optionFlags = (node: CommandSpecNode): string[] => {
  const flags: string[] = [];
  for (const option of node.options) {
    if (option.hidden) continue;
    if (option.long) flags.push(option.long);
    if (option.short) flags.push(option.short);
  }
  return flags;
};

const subcommandNames = (node: CommandSpecNode): string[] => {
  const names: string[] = [];
  for (const child of node.subcommands) {
    names.push(child.name);
    names.push(...child.aliases);
  }
  return names;
};

export const resolveCandidates = async (
  context: CompletionContext,
  source: ValueSource,
): Promise<string[]> => {
  const { command, positionalIndex, currentWord, completingOptionValue } = context;

  if (completingOptionValue) {
    return completingOptionValue.argChoices ?? [];
  }
  if (currentWord.startsWith("-")) {
    return optionFlags(command);
  }
  if (command.subcommands.length > 0 && positionalIndex === 0) {
    return subcommandNames(command);
  }
  const positional = command.positionals[positionalIndex];
  if (!positional) return [];
  if (positional.kind === "static") return [...positional.values];
  return source[positional.source]();
};

// Filter by the current word's prefix, dedup, sort, and render one candidate per
// line — the exact shape both the shell scripts and the CLI's _completion use.
export const formatCandidates = (candidates: string[], prefix: string): string => {
  const matches =
    prefix === "" ? candidates : candidates.filter((candidate) => candidate.startsWith(prefix));
  return [...new Set(matches)]
    .sort()
    .map((candidate) => `${candidate}\n`)
    .join("");
};
