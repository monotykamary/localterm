import { homedir } from "node:os";
import { join } from "node:path";
import { LOCALTERM_STATE_DIRNAME, REDACTION_MIN_VALUE_LENGTH } from "../constants.js";
import { readLocaltermSecretEnvVarsForPi } from "./read-localterm-secret-policy.js";

// Resolve the secret VALUES the localterm shim injected into this pi process's
// env, for redacting them from the agent's bash-tool output. Reads the env-var
// names localterm manages (names only, from the policy files — never values on
// disk) then pulls each value from process.env. The values already live in this
// process by design (the shim exported them), so this needs no Keychain access
// and no daemon roundtrip. Recomputed on session_start so a policy change
// followed by /new, /resume, /fork, or /reload is picked up. Values below the
// redaction floor are dropped (the redactor skips them anyway, but filtering
// here keeps the per-chunk overlap scan over a small set). Both the state
// directory and the env source default to the live values and are overridable
// so tests stay hermetic without touching ~/.localterm or the real process.env.
export const readLocaltermSecretValuesForPi = (
  stateDirectory: string = join(homedir(), LOCALTERM_STATE_DIRNAME),
  env: NodeJS.ProcessEnv = process.env,
): string[] => {
  const values: string[] = [];
  for (const envVar of readLocaltermSecretEnvVarsForPi(stateDirectory)) {
    const value = env[envVar];
    if (typeof value === "string" && value.length >= REDACTION_MIN_VALUE_LENGTH) {
      values.push(value);
    }
  }
  return [...new Set(values)];
};
