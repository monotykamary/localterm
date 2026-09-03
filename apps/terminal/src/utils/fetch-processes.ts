import { processesListResponseSchema, type Process } from "@monotykamary/localterm-server/protocol";

const PROCESSES_ENDPOINT = "/api/processes";

// A process is a binary name + the secret names it should receive. Names only
// over the wire — values never appear (the daemon resolves them into the shim).
export const fetchProcesses = async (signal?: AbortSignal): Promise<Process[] | null> => {
  try {
    const response = await fetch(new URL(PROCESSES_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = processesListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.processes : null;
  } catch {
    return null;
  }
};

export type PutProcessResult =
  | { ok: true; process: Process }
  | {
      ok: false;
      // The server's error code (invalid_name / invalid_body / invalid_secret /
      // capacity), or null when the request failed without a response.
      error: string | null;
    };

// Upsert a process's requested secrets. The server validates every requested
// name exists in the secret store (rejects with invalid_secret) and the shim
// is regenerated. Names only over the wire — values never appear.
export const putProcess = async (
  name: string,
  requestedSecrets: string[],
): Promise<PutProcessResult> => {
  try {
    const response = await fetch(
      new URL(`${PROCESSES_ENDPOINT}/${encodeURIComponent(name)}`, window.location.href),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestedSecrets }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      process?: Process;
      error?: string;
    } | null;
    if (!response.ok) return { ok: false, error: body?.error ?? null };
    return body?.process ? { ok: true, process: body.process } : { ok: false, error: null };
  } catch {
    return { ok: false, error: null };
  }
};

export const deleteProcess = async (name: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`${PROCESSES_ENDPOINT}/${encodeURIComponent(name)}`, window.location.href),
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
};
