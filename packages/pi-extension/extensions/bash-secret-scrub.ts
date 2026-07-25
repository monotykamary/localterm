import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
  type BashSpawnHook,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { readLocaltermSecretEnvVarsForPi } from "../src/utils/read-localterm-secret-policy.js";
import { readLocaltermSecretValuesForPi } from "../src/utils/read-secret-values.js";
import { readPiShellSettings } from "../src/utils/read-pi-shell-settings.js";
import { createStreamingRedactor } from "../src/utils/redact-output.js";
import { scrubEnv } from "../src/utils/scrub-env.js";

// Two layers of defense for secrets the localterm shim injected into pi's env:
//
// 1. Spawn-side scrub (existing): the shim injects each secret only into pi's
//    env, not its parent shell — but pi's bash tool spawns commands with
//    { ...process.env }, so without this the agent's commands would inherit
//    every secret pi received (env, printenv, any script). The spawnHook
//    deletes pi's secret env vars from each child's env only; pi's own
//    process.env (and its provider calls) keep them.
//
// 2. Output-side redaction (new): a spawned command can still PRINT a secret it
//    read another way (a config file, a program that echoes its own env), which
//    would flow into the bash tool's captured stdout/stderr and on into the
//    agent's context. This wraps the bash operations so every onData chunk is
//    redacted against the known secret values (pulled from pi's own env — no
//    Keychain, no daemon) before the tool accumulates it, so the live preview,
//    the truncation temp file, and the final result all carry redacted values.
//
// Both are defense-in-depth, NOT hard barriers: a determined command can still
// reach the keys via parent-process introspection (ps eww $PPID on macOS,
// /proc/$PPID/environ on Linux) or the Keychain directly. For untrusted or
// unmonitored agents, don't wire secrets to the pi process at all.

// Wrap a bash operations backend so each stdout/stderr chunk is redacted
// against the current secret values before the tool sees it. Values are read
// lazily per exec (via the getter) so a session_start recompute is reflected on
// the next command without rebuilding the tool. A value split across two
// onData chunks is held back by the streaming redactor's overlap tail and
// redacted whole once it completes; a multibyte char split across chunks is
// held by the streaming TextDecoder. With no secrets wired, the wrapper is a
// pass-through (no decoder, no redactor) so the common case pays nothing.
const wrapWithRedaction = (
  operations: BashOperations,
  getValues: () => readonly string[],
): BashOperations => ({
  exec: async (command, cwd, options) => {
    const values = getValues();
    if (values.length === 0) return operations.exec(command, cwd, options);

    const redactor = createStreamingRedactor(values);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const { onData, ...rest } = options;
    const emit = (text: string): void => {
      if (text.length > 0) onData(Buffer.from(text, "utf8"));
    };

    const result = await operations.exec(command, cwd, {
      ...rest,
      onData: (data: Buffer) => emit(redactor.push(decoder.decode(data, { stream: true }))),
    });
    emit(redactor.push(decoder.decode()));
    emit(redactor.finish());
    return result;
  },
});

export const registerBashSecretScrub = (pi: ExtensionAPI): void => {
  const cwd = process.cwd();
  const { shellPath, commandPrefix } = readPiShellSettings(cwd);

  let stripSet = new Set<string>(readLocaltermSecretEnvVarsForPi());
  let redactionValues: readonly string[] = readLocaltermSecretValuesForPi();
  pi.on("session_start", () => {
    stripSet = new Set(readLocaltermSecretEnvVarsForPi());
    redactionValues = readLocaltermSecretValuesForPi();
  });

  const spawnHook: BashSpawnHook = ({ command, cwd: spawnCwd, env }) => ({
    command,
    cwd: spawnCwd,
    env: scrubEnv(env, stripSet),
  });

  const operations = wrapWithRedaction(
    createLocalBashOperations({ shellPath }),
    () => redactionValues,
  );

  pi.registerTool(
    createBashToolDefinition(cwd, { operations, spawnHook, commandPrefix, shellPath }),
  );
};
