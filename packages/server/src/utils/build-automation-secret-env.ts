import type { SecretBackend } from "../secret-backend.js";
import type { SecretStore } from "../secret-store.js";

interface ResolvedSecretEnvVar {
  envVar: string;
  value: string;
}

// Resolve the env-var map an automation run should receive. For each requested
// secret name, look up the policy (envVar) in the store and the value in the
// backend; skip names that were deleted since the automation was authored, and
// skip values that are absent (locked Keychain / never set) so an unset secret
// never clobbers a pre-existing env var. Returns {} when nothing is requested
// or the backend is unsupported (non-darwin), so automations that name no
// secrets — the common case — pay zero backend cost. Values flow Keychain →
// daemon → PTY env and never cross the HTTP surface.
export const buildAutomationSecretEnv = async (
  requestedSecrets: readonly string[],
  secretStore: SecretStore,
  secretBackend: SecretBackend,
): Promise<Record<string, string>> => {
  if (requestedSecrets.length === 0 || !secretBackend.supported) return {};

  const resolved = await Promise.all(
    requestedSecrets.map(async (name): Promise<ResolvedSecretEnvVar | null> => {
      const entry = secretStore.get(name);
      if (!entry) return null;
      const value = await secretBackend.get(name);
      if (value === null) return null;
      return { envVar: entry.envVar, value };
    }),
  );

  const env: Record<string, string> = {};
  for (const entry of resolved) {
    if (entry) env[entry.envVar] = entry.value;
  }
  return env;
};
