import kleur from "kleur";
import fs from "node:fs";
import path from "node:path";
import { readHost, readPort } from "../state.js";
import { getStateDirectory } from "../paths.js";

// Shared plumbing for CLI commands that talk to the daemon's HTTP API. The
// daemon's `/api/*` surface is loopback-only and names-only (never values), so
// these helpers just resolve the base URL and render the two failure shapes
// (daemon down, non-2xx response) the same way across every command.

export class DaemonDownError extends Error {
  constructor() {
    super("localterm daemon is not running");
  }
}

export const daemonBaseUrl = (): string => {
  const port = readPort();
  if (!port) throw new DaemonDownError();
  const host = readHost() ?? "127.0.0.1";
  return `http://${host}:${port}/api`;
};

export const reportDaemonDown = (): void => {
  console.log(kleur.red("✗ localterm daemon is not running."));
  console.log(kleur.dim("  start it with `localterm start`, then retry."));
};

export const reportApiError = (status: number, body: string): void => {
  console.log(kleur.red(`✗ daemon returned ${status}`));
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) console.log(kleur.dim(`  ${parsed.error}`));
  } catch {
    if (body) console.log(kleur.dim(`  ${body}`));
  }
};

// The operator bearer token from ~/.localterm/config.json's `identity.operatorToken`
// (set by `localterm config identity`), read once + cached. Absent in
// header/no-provider mode (the gate is open) — in passkey/oidc mode it's the
// only way the CLI can use `/api/*` since it can't run a WebAuthn/OIDC ceremony.
let cachedOperatorToken: string | null | undefined;

const readOperatorToken = (): string | null => {
  if (cachedOperatorToken !== undefined) return cachedOperatorToken;
  try {
    const raw = fs.readFileSync(path.join(getStateDirectory(), "config.json"), "utf8");
    const config = JSON.parse(raw) as { identity?: { operatorToken?: string } };
    const token = config.identity?.operatorToken;
    cachedOperatorToken = typeof token === "string" && token ? token : null;
  } catch {
    cachedOperatorToken = null;
  }
  return cachedOperatorToken;
};

// `fetch` wrapper that injects the operator bearer token so the CLI's `/api/*`
// calls pass the auth gate in passkey/oidc mode. No-op when no token is
// configured (header/no-provider). Never overwrites an explicit Authorization.
export const daemonFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const token = readOperatorToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
