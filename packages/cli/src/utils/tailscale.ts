import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { promisify } from "node:util";
import {
  TAILSCALE_BINARY_PATHS,
  TAILSCALE_DOWNLOAD_URL,
  TAILSCALE_HTTPS_PORT,
  TAILSCALE_HTTPS_SETTINGS_URL,
  TAILSCALE_SERVE_TIMEOUT_MS,
  TAILSCALE_STATUS_TIMEOUT_MS,
} from "../constants.js";

const execFileAsync = promisify(execFile);

interface TailscaleServeStatus {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
}

interface TailscaleSelfStatus {
  Self?: { DNSName?: string; Online?: boolean };
}

export interface TailscaleRoute {
  url: string | null;
  registered: boolean;
  reason?: "binary-missing" | "https-disabled" | "offline" | "serve-mismatch";
  hint?: string;
}

const resolveTailscaleBinary = (): string | null => {
  for (const candidate of TAILSCALE_BINARY_PATHS) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not at this well-known path; try the next
    }
  }
  return null;
};

const runTailscale = async (
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> => {
  const resolved = resolveTailscaleBinary();
  if (resolved === null) {
    const error = new Error("tailscale binary not found") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  return execFileAsync(resolved, args, { timeout: timeoutMs });
};

const isHttpsDisabled = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTPS cert support is not enabled/i.test(message);
};

const parseJson = <T>(stdout: string): T | null => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
};

const stripTrailingDot = (dnsName: string): string => dnsName.replace(/\.+$/, "");

const resolveTailscaleDnsName = async (): Promise<string | null> => {
  try {
    const { stdout } = await runTailscale(["status", "--json"], TAILSCALE_STATUS_TIMEOUT_MS);
    const self = parseJson<TailscaleSelfStatus>(stdout)?.Self;
    if (!self?.DNSName || self.Online === false) return null;
    return stripTrailingDot(self.DNSName);
  } catch {
    return null;
  }
};

export const configureTailscaleServe = async (port: number): Promise<TailscaleRoute> => {
  try {
    await runTailscale(
      ["serve", "--bg", "--https", String(TAILSCALE_HTTPS_PORT), `localhost:${port}`],
      TAILSCALE_SERVE_TIMEOUT_MS,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        url: null,
        registered: false,
        reason: "binary-missing",
        hint: TAILSCALE_DOWNLOAD_URL,
      };
    }
    if (isHttpsDisabled(error)) {
      return {
        url: null,
        registered: false,
        reason: "https-disabled",
        hint: TAILSCALE_HTTPS_SETTINGS_URL,
      };
    }
    return { url: null, registered: false, reason: "offline" };
  }
  const dnsName = await resolveTailscaleDnsName();
  if (!dnsName) return { url: null, registered: false, reason: "offline" };
  return { url: `https://${dnsName}`, registered: true };
};

export const resolveTailscaleRoute = async (port: number): Promise<TailscaleRoute> => {
  let serveStdout: string;
  try {
    serveStdout = (await runTailscale(["serve", "status", "--json"], TAILSCALE_STATUS_TIMEOUT_MS))
      .stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        url: null,
        registered: false,
        reason: "binary-missing",
        hint: TAILSCALE_DOWNLOAD_URL,
      };
    }
    return { url: null, registered: false, reason: "offline" };
  }
  const serveStatus = parseJson<TailscaleServeStatus>(serveStdout);
  if (!serveStatus) return { url: null, registered: false, reason: "serve-mismatch" };

  const dnsName = await resolveTailscaleDnsName();
  if (!dnsName) return { url: null, registered: false, reason: "offline" };

  const proxyValue =
    serveStatus.Web?.[`${dnsName}:${TAILSCALE_HTTPS_PORT}`]?.Handlers?.["/"]?.Proxy;
  if (proxyValue === `http://localhost:${port}`) {
    return { url: `https://${dnsName}`, registered: true };
  }
  return { url: null, registered: false, reason: "serve-mismatch" };
};

export const removeTailscaleServe = async (): Promise<void> => {
  try {
    await runTailscale(["serve", "reset"], TAILSCALE_SERVE_TIMEOUT_MS);
  } catch {
    // best-effort teardown
  }
};
