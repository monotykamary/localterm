import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ENV_VAR_PATTERN,
  LOCALTERM_STATE_DIRNAME,
  PI_PROCESS_NAME,
  PROCESSES_FILENAME,
  PROCESS_NAME_PATTERN,
  SECRET_NAME_PATTERN,
  SECRETS_FILENAME,
} from "../constants.js";

interface SecretEntry {
  name: string;
  envVar: string;
}

interface ProcessEntry {
  name: string;
  requestedSecrets: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readJsonFile = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const parseSecretsFile = (data: unknown): SecretEntry[] => {
  if (!isRecord(data) || !Array.isArray(data.secrets)) return [];
  return data.secrets
    .filter(isRecord)
    .map((entry) => ({ name: String(entry.name ?? ""), envVar: String(entry.envVar ?? "") }))
    .filter((entry) => SECRET_NAME_PATTERN.test(entry.name) && ENV_VAR_PATTERN.test(entry.envVar));
};

const parseProcessesFile = (data: unknown): ProcessEntry[] => {
  if (!isRecord(data) || !Array.isArray(data.processes)) return [];
  return data.processes
    .filter(isRecord)
    .map((entry) => ({
      name: String(entry.name ?? ""),
      requestedSecrets: Array.isArray(entry.requestedSecrets)
        ? entry.requestedSecrets.filter((item): item is string => typeof item === "string")
        : [],
    }))
    .filter((entry) => PROCESS_NAME_PATTERN.test(entry.name));
};

// Resolve the env-var names localterm's shim injected into the `pi` process:
// the pi process's requestedSecrets (processes.json), each mapped to its
// envVar (secrets.json). These are the names to strip from pi's bash-tool
// child env. Reads names + envVars only — NEVER secret values (those live in
// the Keychain, never in these files). Tolerates missing or malformed files
// (returns []) so a broken or absent localterm install degrades to a no-op
// scrub rather than crashing the agent's bash tool. `stateDirectory` defaults
// to the real ~/.localterm and is overridable for tests.
export const readLocaltermSecretEnvVarsForPi = (
  stateDirectory: string = join(homedir(), LOCALTERM_STATE_DIRNAME),
): string[] => {
  const secretsData = readJsonFile(join(stateDirectory, SECRETS_FILENAME));
  const processesData = readJsonFile(join(stateDirectory, PROCESSES_FILENAME));

  const envVarBySecretName = new Map<string, string>();
  for (const secret of parseSecretsFile(secretsData)) {
    envVarBySecretName.set(secret.name, secret.envVar);
  }

  const piProcess = parseProcessesFile(processesData).find(
    (entry) => entry.name === PI_PROCESS_NAME,
  );
  if (!piProcess) return [];

  const envVars: string[] = [];
  for (const secretName of piProcess.requestedSecrets) {
    if (!SECRET_NAME_PATTERN.test(secretName)) continue;
    const envVar = envVarBySecretName.get(secretName);
    if (envVar) envVars.push(envVar);
  }
  return envVars;
};
