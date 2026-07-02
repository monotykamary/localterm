import kleur from "kleur";
import fs from "node:fs";
import path from "node:path";
import {
  daemonConfigFileSchema,
  type IdentityConfig,
} from "@monotykamary/localterm-server/protocol";
import type { z } from "zod";
import { getStateDirectory } from "../paths.js";

// Options for `localterm config identity <provider>`. The provider dictates
// which are meaningful; commander validates the provider choice + the
// registration enum, the rest are checked in `buildIdentityConfig`.
export interface ConfigIdentityOptions {
  header?: string;
  trustedProxy?: string;
  rpName?: string;
  registration?: "open" | "closed";
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  claim?: string;
  scope?: string;
}

class IdentityConfigError extends Error {}

const configFilePath = (): string => path.join(getStateDirectory(), "config.json");

// Build the `identity` block for the chosen provider, or `null` to clear it.
// `daemonConfigFileSchema.parse` does the runtime validation (URL shape,
// strict keys); this just assembles a structurally-correct object. Undefined
// optionals are dropped by JSON.stringify when the file is written.
const buildIdentityConfig = (provider: string, options: ConfigIdentityOptions): IdentityConfig | null => {
  switch (provider) {
    case "none":
      return null;
    case "header":
      return { provider: "header", header: options.header, trustedProxy: options.trustedProxy };
    case "passkey":
      return {
        provider: "passkey",
        rpName: options.rpName,
        registration: options.registration,
      };
    case "oidc": {
      if (!options.issuer) throw new IdentityConfigError("--issuer is required for the oidc provider");
      if (!options.clientId) throw new IdentityConfigError("--client-id is required for the oidc provider");
      return {
        provider: "oidc",
        issuer: options.issuer,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        claim: options.claim,
        scope: options.scope,
      };
    }
    default:
      throw new IdentityConfigError(`unknown identity provider "${provider}"`);
  }
};

// Read the current config file, or a minimal valid file when there isn't one
// yet (the daemon fills `graceSeconds` on its next start). Returned untyped —
// the daemon schema re-validates the merged result before we write.
const readConfig = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(configFilePath(), "utf8"));
  } catch {
    return { version: 1, cdpPort: null };
  }
};

// `localterm config identity <provider> [options]` — set the daemon's identity
// provider in `~/.localterm/config.json`. Identity is built once at daemon
// start (unlike the live cdpPort/graceSeconds knobs), so this writes the file
// directly and tells the operator to restart; it never talks to the running
// daemon.
export const runConfigIdentity = async (
  provider: string,
  options: ConfigIdentityOptions,
): Promise<void> => {
  let validated: z.infer<typeof daemonConfigFileSchema>;
  try {
    const newIdentity = buildIdentityConfig(provider, options);
    const next = { ...readConfig(), identity: newIdentity ?? undefined };
    validated = daemonConfigFileSchema.parse(next);
  } catch (error) {
    const message =
      error instanceof IdentityConfigError
        ? error.message
        : `invalid identity config (the file was not changed)`;
    console.log(kleur.red(`✗ ${message}`));
    process.exitCode = 1;
    return;
  }

  const filePath = configFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);

  const label = provider === "none" ? "(none)" : provider;
  console.log(kleur.green("✓") + ` identity set to ${kleur.cyan(label)}.`);
  console.log(kleur.dim("  restart the daemon for it to take effect: `localterm restart`."));
};
