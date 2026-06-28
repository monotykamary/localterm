import kleur from "kleur";
import { readHost, readPort } from "../state.js";

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
