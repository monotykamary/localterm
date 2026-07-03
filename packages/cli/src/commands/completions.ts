import type { Command } from "commander";
import kleur from "kleur";
import { COMPLETION_SUPPORTED_SHELLS } from "../constants.js";
import {
  formatCandidates,
  resolveCandidates,
  resolveCompletionContext,
  type ValueSource,
} from "@monotykamary/localterm-server/completion";
import {
  fetchProcessNames,
  fetchSecretNames,
  fetchSessionIds,
} from "../utils/completion-resolvers.js";
import { serializeProgram } from "../utils/serialize-program.js";
import { writeCommandSpec } from "../utils/command-spec.js";
import { completionScriptFor } from "../utils/completion-scripts.js";
import { unwireShellCompletions, wireShellCompletions } from "../utils/shell-completions.js";

// The CLI's value source: live names fetched from the daemon's loopback HTTP
// surface (names-only). On daemon-down/timeout/error the resolvers return [],
// so completion degrades to nothing — mirroring the daemon endpoint, which
// reads the same names in-process.
const cliValueSource: ValueSource = {
  sessions: fetchSessionIds,
  secrets: fetchSecretNames,
  processes: fetchProcessNames,
};

const isSupportedShell = (shell: string): boolean =>
  (COMPLETION_SUPPORTED_SHELLS as readonly string[]).includes(shell);

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
  writeCommandSpec();
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
  const spec = serializeProgram(program);
  const context = resolveCompletionContext(spec, words);
  const candidates = await resolveCandidates(context, cliValueSource);
  process.stdout.write(formatCandidates(candidates, context.currentWord));
};
