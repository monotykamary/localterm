import kleur from "kleur";
import { randomBytes } from "node:crypto";
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
  operatorToken?: string;
}

class IdentityConfigError extends Error {}

const configFilePath = (): string => path.join(getStateDirectory(), "config.json");

// Build the `identity` block for the chosen provider, or `null` to clear it.
// `daemonConfigFileSchema.parse` does the runtime validation (URL shape,
// strict keys); this just assembles a structurally-correct object. Undefined
// optionals are dropped by JSON.stringify when the file is written. The
// operator token (resolved by the caller) is included for passkey/oidc — the
// CLI can't run those login ceremonies, so it authenticates to `/api/*` with it.
const buildIdentityConfig = (
  provider: string,
  options: ConfigIdentityOptions,
  operatorToken: string | undefined,
): IdentityConfig | null => {
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
        operatorToken,
      };
    case "oidc": {
      if (!options.issuer)
        throw new IdentityConfigError("--issuer is required for the oidc provider");
      if (!options.clientId)
        throw new IdentityConfigError("--client-id is required for the oidc provider");
      return {
        provider: "oidc",
        issuer: options.issuer,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        claim: options.claim,
        scope: options.scope,
        operatorToken,
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

// Resolve the operator bearer token for a passkey/oidc config: an explicit
// `--operator-token` wins; otherwise preserve any token already in the file
// (so re-running the command doesn't rotate it); otherwise generate a fresh
// one and return it so the caller prints it once. `undefined` for none/header.
const resolveOperatorToken = (
  provider: string,
  options: ConfigIdentityOptions,
  existing: Record<string, unknown>,
): { token: string | undefined; generated: string | null } => {
  if (provider !== "passkey" && provider !== "oidc") return { token: undefined, generated: null };
  if (options.operatorToken) return { token: options.operatorToken, generated: null };
  const parsed = daemonConfigFileSchema.safeParse(existing);
  const existingIdentity = parsed.success ? parsed.data.identity : undefined;
  const existingToken =
    existingIdentity && "operatorToken" in existingIdentity
      ? existingIdentity.operatorToken
      : undefined;
  if (existingToken) return { token: existingToken, generated: null };
  const generated = randomBytes(32).toString("base64url");
  return { token: generated, generated };
};

// `localterm config identity <provider> [options]` — set the daemon's identity
// provider in `~/.localterm/config.json`. Identity is built once at daemon
// start (unlike the live cdpPort/graceSeconds knobs), so this writes the file
// directly and tells the operator to restart; it never talks to the running
// daemon. For passkey/oidc it also ensures an operator bearer token exists
// (the CLI's only `/api/*` credential in those modes) — provided, preserved,
// or generated + printed.
export const runConfigIdentity = async (
  provider: string,
  options: ConfigIdentityOptions,
): Promise<void> => {
  const existing = readConfig();
  const { token: operatorToken, generated: generatedToken } = resolveOperatorToken(
    provider,
    options,
    existing,
  );

  let validated: z.infer<typeof daemonConfigFileSchema>;
  try {
    const newIdentity = buildIdentityConfig(provider, options, operatorToken);
    const next = { ...existing, identity: newIdentity ?? undefined };
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
  fs.writeFileSync(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filePath);

  const label = provider === "none" ? "(none)" : provider;
  console.log(kleur.green("✓") + ` identity set to ${kleur.cyan(label)}.`);
  console.log(kleur.dim("  restart the daemon for it to take effect: `localterm restart`."));
  if (generatedToken) {
    console.log(kleur.green("✓") + ` operator token (the CLI uses it automatically):`);
    console.log(kleur.cyan(`  ${generatedToken}`));
    console.log(kleur.dim("  save it; it's stored in ~/.localterm/config.json."));
  }
};
