import { createDefaultSecretBackend } from "@monotykamary/localterm-server/secret-backend";
import kleur from "kleur";
import type { SecretBackend } from "@monotykamary/localterm-server/secret-backend";

export const runSecretGet = async (
  name: string,
  backend: SecretBackend = createDefaultSecretBackend(),
): Promise<void> => {
  if (!backend.supported) {
    console.log(kleur.red("✗ secret storage isn't supported on this platform."));
    console.log(kleur.dim("  (it uses macOS Keychain; run on a Mac.)"));
    process.exitCode = 1;
    return;
  }
  const value = await backend.get(name);
  if (value === null) {
    console.log(kleur.red(`✗ no secret named '${name}'.`));
    console.log(kleur.dim("  list with `localterm secret list`."));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${value}\n`);
};
