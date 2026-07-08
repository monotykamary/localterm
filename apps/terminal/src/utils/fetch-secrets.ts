import {
  secretsListResponseSchema,
  type SecretEntryResponse,
  type SecretExportResponse,
  type SecretImportResponse,
  type SecretsListResponse,
} from "@monotykamary/localterm-server/protocol";

const SECRETS_ENDPOINT = "/api/secrets";

// The policy (names + env var) is fetched as names only — VALUES are never
// returned by the daemon (the `/api/*` surface is network-gated, not
// capability-gated, so serving values would expose them to any local process).
// `hasValue` is probed server-side from the backend so the UI can show whether
// a value is set without ever reading it.
export const fetchSecrets = async (signal?: AbortSignal): Promise<SecretsListResponse | null> => {
  try {
    const response = await fetch(new URL(SECRETS_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = secretsListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

interface SecretSetInput {
  envVar: string;
  value?: string;
}

// Upsert a secret. The value transits to the daemon once on write and is never
// returned (the server stores it in the backend and replies with the entry +
// hasValue). Returns the updated entry on success, null on failure.
export const putSecret = async (
  name: string,
  input: SecretSetInput,
): Promise<SecretEntryResponse | null> => {
  try {
    const response = await fetch(
      new URL(`${SECRETS_ENDPOINT}/${encodeURIComponent(name)}`, window.location.href),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as SecretEntryResponse;
  } catch {
    return null;
  }
};

export const deleteSecret = async (name: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`${SECRETS_ENDPOINT}/${encodeURIComponent(name)}`, window.location.href),
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
};

// Export every secret's value as an age-encrypted, ASCII-armored file. The
// passphrase transits to the daemon once (same posture as a `secret set`
// value); the daemon returns only the ciphertext — values never leave it in
// plaintext. Returns the armored text + counts, or null on failure.
export const exportSecrets = async (passphrase: string): Promise<SecretExportResponse | null> => {
  try {
    const response = await fetch(new URL(`${SECRETS_ENDPOINT}/export`, window.location.href), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) return null;
    return (await response.json()) as SecretExportResponse;
  } catch {
    return null;
  }
};

// Import an age-armored export: the daemon decrypts with the passphrase and
// upserts each entry through the same write path as a secret save. The
// ciphertext + passphrase transit once (same posture as `secret set`); the
// response carries only counts + per-name error reasons, never values.
export const importSecrets = async (
  data: string,
  passphrase: string,
): Promise<SecretImportResponse | null> => {
  try {
    const response = await fetch(new URL(`${SECRETS_ENDPOINT}/import`, window.location.href), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase, data }),
    });
    if (!response.ok) return null;
    return (await response.json()) as SecretImportResponse;
  } catch {
    return null;
  }
};
