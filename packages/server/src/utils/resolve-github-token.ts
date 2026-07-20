import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  GITHUB_HOSTS_FILE_MAX_BYTES,
  GITHUB_TOKEN_CACHE_MAX_ENTRIES,
  GITHUB_TOKEN_CACHE_TTL_MS,
} from "../constants.js";

const execFileAsync = promisify(execFile);

const KEYRING_SERVICE_PREFIX = "gh:";

const readKeychainToken = async (hostname: string): Promise<string | null> => {
  if (process.platform !== "darwin") return null;

  const service = `${KEYRING_SERVICE_PREFIX}${hostname}`;

  const readAccounts = async (): Promise<string[]> => {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", service, "-g"],
        { timeout: 5_000 },
      );
      const match = /"acct"<blob>="([^"]+)"/.exec(stdout);
      return match ? [match[1]] : [];
    } catch {
      return [];
    }
  };

  const readPassword = async (account: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { timeout: 5_000 },
      );
      const raw = stdout.trim();
      if (!raw.startsWith("go-keyring-base64:")) return raw;
      return Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8");
    } catch {
      return null;
    }
  };

  try {
    const accounts = await readAccounts();
    for (const account of accounts) {
      const token = await readPassword(account);
      if (token) return token;
    }
  } catch {
    // Keychain unavailable
  }

  return null;
};

const isPlainToken = (value: string): boolean =>
  /^(gh[ps]_|github_pat_)/.test(value) || /^[a-f0-9]{40}$/.test(value);

const readHostsYmlToken = (hostname: string): string | null => {
  try {
    const hostsFile = path.join(os.homedir(), ".config", "gh", "hosts.yml");
    if (fs.statSync(hostsFile).size > GITHUB_HOSTS_FILE_MAX_BYTES) return null;
    const content = fs.readFileSync(hostsFile, "utf8");
    const tokenPattern = new RegExp(
      `^${hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*[\\s\\S]*?oauth_token:\\s*["']?([^"':\\s]+)`,
      "m",
    );
    const match = tokenPattern.exec(content);
    const token = match?.[1];
    return token && isPlainToken(token) ? token : null;
  } catch {
    return null;
  }
};

interface CachedToken {
  token: string;
  expiresAt: number;
}

const keychainCache = new Map<string, CachedToken>();

const cacheToken = (hostname: string, token: string): void => {
  keychainCache.delete(hostname);
  keychainCache.set(hostname, {
    token,
    expiresAt: Date.now() + GITHUB_TOKEN_CACHE_TTL_MS,
  });
  while (keychainCache.size > GITHUB_TOKEN_CACHE_MAX_ENTRIES) {
    const oldestHostname = keychainCache.keys().next().value;
    if (oldestHostname === undefined) break;
    keychainCache.delete(oldestHostname);
  }
};

export const resolveGithubToken = async (hostname = "github.com"): Promise<string | null> => {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken && isPlainToken(envToken)) return envToken;

  const cached = keychainCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    keychainCache.delete(hostname);
    keychainCache.set(hostname, cached);
    return cached.token;
  }
  keychainCache.delete(hostname);

  const fileToken = readHostsYmlToken(hostname);
  if (fileToken) {
    cacheToken(hostname, fileToken);
    return fileToken;
  }

  const keychainToken = await readKeychainToken(hostname);
  if (keychainToken) {
    cacheToken(hostname, keychainToken);
    return keychainToken;
  }

  return null;
};
