import {
  secretsListResponseSchema,
  type SecretEntryResponse,
  type SecretsListResponse,
} from "@monotykamary/localterm-server/protocol";

const SECRETS_ENDPOINT = "/api/secrets";

// The policy (names + env var + programs) is fetched as names only — VALUES are
// never returned by the daemon (the `/api/*` surface is network-gated, not
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
  programs: string[];
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
