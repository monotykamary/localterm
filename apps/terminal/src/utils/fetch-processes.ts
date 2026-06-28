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

// Upsert a process's requested secrets. Returns the stored process on success,
// null on failure. The server validates every requested name exists in the
// secret store (rejects with invalid_secret) and the shim is regenerated.
export const putProcess = async (
  name: string,
  requestedSecrets: string[],
): Promise<Process | null> => {
  try {
    const response = await fetch(
      new URL(`${PROCESSES_ENDPOINT}/${encodeURIComponent(name)}`, window.location.href),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestedSecrets }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { process?: Process };
    return body.process ?? null;
  } catch {
    return null;
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
