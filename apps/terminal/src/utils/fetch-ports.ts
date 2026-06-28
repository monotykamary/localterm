import {
  listeningPortsResponseSchema,
  type ListeningPort,
} from "@monotykamary/localterm-server/protocol";

const PORTS_ENDPOINT = "/api/ports";

// Every TCP listening socket owned by a process descended from a localterm
// session shell (a dev server run inside a tab). Polled only while the ports
// modal is open, so an idle tab never hits the daemon (the read spawns `ps` +
// `lsof`, heavier than the sessions list).
export const fetchPorts = async (signal?: AbortSignal): Promise<ListeningPort[] | null> => {
  try {
    const response = await fetch(new URL(PORTS_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = listeningPortsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.ports : null;
  } catch {
    return null;
  }
};

// Stop a dev server by killing the process that owns the listening socket.
// The daemon re-verifies the pid still descends from a live session before
// signalling, so a recycled pid can't be killed by a stale request. Returns
// false on a miss or network failure; the modal refetches either way so the
// list self-corrects.
export const killPort = async (pid: number): Promise<boolean> => {
  try {
    const response = await fetch(new URL(`${PORTS_ENDPOINT}/${pid}`, window.location.href), {
      method: "DELETE",
    });
    return response.ok;
  } catch {
    return false;
  }
};
