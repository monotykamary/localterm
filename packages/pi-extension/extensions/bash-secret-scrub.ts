import type { BashSpawnHook, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { readLocaltermSecretEnvVarsForPi } from "../src/utils/read-localterm-secret-policy.js";
import { readPiShellSettings } from "../src/utils/read-pi-shell-settings.js";
import { scrubEnv } from "../src/utils/scrub-env.js";

// Strip localterm-managed secret env vars from the agent's bash-tool children.
// The localterm shim injects each secret only into the shimmed process's env
// (pi's), not its parent shell — but pi's bash tool spawns commands with
// { ...process.env }, so without this the agent's commands inherit every secret
// pi received (`env`, `printenv`, or any script could read a key). This
// overrides the `bash` tool by name (extensions apply after the built-in in
// pi's tool registry) with a spawnHook that deletes the pi process's secret
// envVars from the child env only; pi's own process.env (and its provider
// calls) keep them. The strip set is recomputed on session_start so a policy
// change followed by /new, /resume, /fork, or /reload is picked up.
//
// This is defense-in-depth, NOT a hard barrier: a determined command can still
// read the keys via parent-process introspection (`ps eww $PPID` on macOS,
// `/proc/$PPID/environ` on Linux) or the Keychain directly. For untrusted or
// unmonitored agents, don't wire secrets to the pi process at all.
export const registerBashSecretScrub = (pi: ExtensionAPI): void => {
  const cwd = process.cwd();
  const { shellPath, commandPrefix } = readPiShellSettings(cwd);

  let stripSet = new Set<string>(readLocaltermSecretEnvVarsForPi());
  pi.on("session_start", () => {
    stripSet = new Set(readLocaltermSecretEnvVarsForPi());
  });

  const spawnHook: BashSpawnHook = ({ command, cwd: spawnCwd, env }) => ({
    command,
    cwd: spawnCwd,
    env: scrubEnv(env, stripSet),
  });

  pi.registerTool(createBashToolDefinition(cwd, { spawnHook, commandPrefix, shellPath }));
};
