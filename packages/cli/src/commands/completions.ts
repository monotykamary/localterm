import type { Command } from "commander";
import kleur from "kleur";
import { COMPLETION_SUPPORTED_SHELLS } from "../constants.js";
import { completionScriptFor } from "../utils/completion-scripts.js";
import {
  isInternalCommand,
  resolveCompletionContext,
  type CompletionContext,
} from "../utils/completion-tree.js";
import {
  fetchProcessNames,
  fetchSecretNames,
  fetchSessionIds,
} from "../utils/completion-resolvers.js";
import { unwireShellCompletions, wireShellCompletions } from "../utils/shell-completions.js";

type PositionalCompleter = () => Promise<string[]>;

const IDENTITY_PROVIDERS = ["none", "header", "passkey", "oidc"];
const SCROLL_DIRECTIONS = ["up", "down"];

// Per-command positional completers, keyed by the command path the walker
// resolves (e.g. "session kill"). Each array is indexed by positional slot: a
// session id, a secret name, etc. Slots without an entry fall through to the
// shell's default completion (free text, filenames). Dynamic entries call the
// daemon and degrade to [] on any failure (see completion-resolvers).
const positionalCompleters: Record<string, PositionalCompleter[]> = {
  "session attach": [fetchSessionIds],
  "session kill": [fetchSessionIds],
  "session send-keys": [fetchSessionIds],
  "session capture": [fetchSessionIds],
  "session exec": [fetchSessionIds],
  "session resize": [fetchSessionIds],
  "session rename": [fetchSessionIds],
  "session pin": [fetchSessionIds],
  "session unpin": [fetchSessionIds],
  "session press": [fetchSessionIds],
  "session wait": [fetchSessionIds],
  "session mouse click": [fetchSessionIds],
  "session mouse drag": [fetchSessionIds],
  "session mouse move": [fetchSessionIds],
  "session mouse scroll": [fetchSessionIds, async () => SCROLL_DIRECTIONS],
  "session mouse state": [fetchSessionIds],
  "secret get": [fetchSecretNames],
  "secret delete": [fetchSecretNames],
  "secret set": [fetchSecretNames],
  "process set": [fetchProcessNames],
  "process delete": [fetchProcessNames],
  "config identity": [async () => IDENTITY_PROVIDERS],
};

const isSupportedShell = (shell: string): boolean =>
  (COMPLETION_SUPPORTED_SHELLS as readonly string[]).includes(shell);

const subcommandNames = (command: Command): string[] => {
  const names: string[] = [];
  for (const child of command.commands) {
    if (isInternalCommand(child)) continue;
    names.push(child.name());
    names.push(...child.aliases());
  }
  return names;
};

const optionFlags = (command: Command): string[] => {
  const flags: string[] = [];
  for (const option of command.options) {
    if (option.hidden) continue;
    if (option.long) flags.push(option.long);
    if (option.short) flags.push(option.short);
  }
  return flags;
};

const hasVisibleSubcommands = (command: Command): boolean =>
  command.commands.some((child) => !isInternalCommand(child));

export const resolveCandidates = async (context: CompletionContext): Promise<string[]> => {
  const { command, commandPath, positionalIndex, currentWord, completingOptionValue } = context;

  if (completingOptionValue) {
    return completingOptionValue.argChoices ?? [];
  }
  if (currentWord.startsWith("-")) {
    return optionFlags(command);
  }
  if (hasVisibleSubcommands(command) && positionalIndex === 0) {
    return subcommandNames(command);
  }
  const completers = positionalCompleters[commandPath.join(" ")];
  const completer = completers?.[positionalIndex];
  return completer ? await completer() : [];
};

export const runCompletionsPrint = (shell: string): void => {
  if (!isSupportedShell(shell)) {
    console.error(`unknown shell '${shell}'. supported: ${COMPLETION_SUPPORTED_SHELLS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(completionScriptFor(shell));
};

export const wireCompletions = async (shell: string): Promise<void> => {
  if (!isSupportedShell(shell)) {
    console.error(`unknown shell '${shell}'. supported: ${COMPLETION_SUPPORTED_SHELLS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const result = await wireShellCompletions(shell);
  if (result.method === "drop-dir") {
    console.log(kleur.green(`✔ ${shell} completions installed → ${result.path}`));
    console.log(
      kleur.dim("  start a new shell; the shell auto-loads it from its completion directory"),
    );
    return;
  }
  console.log(kleur.green(`✔ ${shell} completions wired → ${result.path}`));
  console.log(kleur.dim("  start a new shell, or source the rc file"));
};

export const unwireCompletions = async (shell: string): Promise<void> => {
  if (!isSupportedShell(shell)) {
    console.error(`unknown shell '${shell}'. supported: ${COMPLETION_SUPPORTED_SHELLS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const result = await unwireShellCompletions(shell);
  if (result.rcRemoved || result.dropRemoved) {
    console.log(kleur.green(`✔ ${shell} completions removed`));
    return;
  }
  console.log(kleur.dim(`${shell} completions were not installed.`));
};

export const runCompletion = async (program: Command, words: readonly string[]): Promise<void> => {
  const context = resolveCompletionContext(program, words);
  const candidates = await resolveCandidates(context);
  const prefix = context.currentWord;
  const matches =
    prefix === "" ? candidates : candidates.filter((candidate) => candidate.startsWith(prefix));
  for (const match of [...new Set(matches)].sort()) {
    process.stdout.write(`${match}\n`);
  }
};
