import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import {
  MAX_SECRET_VALUE_LENGTH,
  SECRET_KEYCHAIN_SERVICE_PREFIX,
  SECURITY_BINARY_PATH,
} from "./constants.js";

const execFileAsync = promisify(execFile);

const KEYCHAIN_ACCOUNT = "localterm";
const SECURITY_TIMEOUT_MS = 5_000;

// A backend stores secret VALUES (never the policy). The policy — which
// programs get which secret as which env var, names only — lives in
// SecretStore as plaintext; only values are secret and backend-scoped. The
// interface is backend-agnostic so the macOS Keychain implementation can be
// swapped for an encrypted-file backend (non-darwin, no Keychain) without
// touching the store, the routes, or the shim generator: the generator bakes
// the backend's resolution command into each shim.
export interface SecretBackend {
  readonly supported: boolean;
  get(name: string): Promise<string | null>;
  has(name: string): Promise<boolean>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  // The two-line POSIX snippet a generated shim runs to resolve one secret and
  // inject it as `envVar`. Baked into the shim at generation time so the shim
  // is self-contained (no daemon or CLI dependency at run time). Backends own
  // this because the resolution mechanism is backend-specific (Keychain shells
  // out to `security`; an encrypted-file backend would call its resolver).
  shimResolveSnippet(name: string, envVar: string): string;
}

const keychainService = (name: string): string => `${SECRET_KEYCHAIN_SERVICE_PREFIX}${name}`;

// macOS Keychain via the `security` CLI (the same path resolve-github-token
// uses for reads). Values are stored as generic passwords under service
// `localterm:<name>`, account `localterm`. Reads are clean: `find-generic-password
// -w` writes the value to stdout, never to argv. Writes use `add-generic-password
// -w <value>`, which passes the value as a CLI arg — briefly visible to `ps`
// for the ~ms the `security` process lives. That is the standard `security`-CLI
// trade-off (it has no stdin path for the password) and matches every script
// that shells out to `security`; the value never touches disk.
export class KeychainSecretBackend implements SecretBackend {
  readonly supported: boolean;

  constructor() {
    this.supported = process.platform === "darwin";
  }

  async get(name: string): Promise<string | null> {
    if (!this.supported) return null;
    try {
      const { stdout } = await execFileAsync(
        SECURITY_BINARY_PATH,
        ["find-generic-password", "-s", keychainService(name), "-a", KEYCHAIN_ACCOUNT, "-w"],
        { timeout: SECURITY_TIMEOUT_MS, maxBuffer: MAX_SECRET_VALUE_LENGTH + 1024 },
      );
      const value = stdout.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  // Existence check without reading the value: `find-generic-password` without
  // `-w` exits 0 if the item exists, non-zero otherwise, and never prints the
  // password. Used for the list response (`hasValue`) so the daemon can report
  // whether a value is set without pulling secret values into memory.
  async has(name: string): Promise<boolean> {
    if (!this.supported) return false;
    try {
      await execFileAsync(
        SECURITY_BINARY_PATH,
        ["find-generic-password", "-s", keychainService(name), "-a", KEYCHAIN_ACCOUNT],
        { timeout: SECURITY_TIMEOUT_MS },
      );
      return true;
    } catch {
      return false;
    }
  }

  async set(name: string, value: string): Promise<void> {
    if (!this.supported) throw new Error("keychain backend not supported on this platform");
    if (Buffer.byteLength(value) > MAX_SECRET_VALUE_LENGTH) {
      throw new Error(`secret value exceeds ${MAX_SECRET_VALUE_LENGTH} bytes`);
    }
    // Upsert: delete (ignore "not found") then add. `security` has no single
    // upsert flag that's reliable across versions, so delete-then-add is the
    // portable path. The delete fails silently when the item doesn't exist.
    await this.delete(name).catch(() => {});
    await execFileAsync(
      SECURITY_BINARY_PATH,
      ["add-generic-password", "-s", keychainService(name), "-a", KEYCHAIN_ACCOUNT, "-w", value],
      { timeout: SECURITY_TIMEOUT_MS },
    );
  }

  async delete(name: string): Promise<void> {
    if (!this.supported) return;
    try {
      await execFileAsync(
        SECURITY_BINARY_PATH,
        ["delete-generic-password", "-s", keychainService(name), "-a", KEYCHAIN_ACCOUNT],
        { timeout: SECURITY_TIMEOUT_MS },
      );
    } catch {
      // Missing item is not an error for delete.
    }
  }

  // The shim resolves the value at run time via the `security` CLI (absolute
  // path so the shim doesn't depend on PATH lookup). Only non-empty values are
  // exported, so a locked Keychain (empty resolution) leaves the env var
  // untouched instead of clobbering it with an empty string.
  shimResolveSnippet(name: string, envVar: string): string {
    const service = keychainService(name);
    return [
      `_v=$(${SECURITY_BINARY_PATH} find-generic-password -s '${service}' -a ${KEYCHAIN_ACCOUNT} -w 2>/dev/null || true)`,
      `[ -n "$_v" ] && ${envVar}=$_v && export ${envVar}`,
    ].join("\n");
  }
}

// The daemon selects a backend at start: Keychain on darwin, none elsewhere
// (the encrypted-file backend for non-darwin is a later phase). `null` means
// the feature is unavailable on this platform — the UI shows that state.
export const createDefaultSecretBackend = (): SecretBackend => {
  if (process.platform === "darwin") return new KeychainSecretBackend();
  return new UnsupportedBackend();
};

class UnsupportedBackend implements SecretBackend {
  readonly supported = false;
  async get(): Promise<string | null> {
    return null;
  }
  async has(): Promise<boolean> {
    return false;
  }
  async set(): Promise<void> {
    throw new Error("no secret backend available on this platform");
  }
  async delete(): Promise<void> {}
  shimResolveSnippet(): string {
    return ":";
  }
}

export const keychainAccountForTest = KEYCHAIN_ACCOUNT;
export const homedirForTest = os.homedir;
