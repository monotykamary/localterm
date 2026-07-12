import { updateStatusSchema, type UpdateStatus } from "@monotykamary/localterm-server";
import { daemonFetch } from "./daemon-api.js";
import { UPDATE_BANNER_FETCH_TIMEOUT_MS } from "../constants.js";

// Fetches the daemon's cached update status. Returns null on any failure
// (daemon down, non-2xx, parse error, timeout) so a banner line never breaks —
// the absence of an update line is always a safe state. `wait` requests the
// server's blocking fresh-fetch path (`?wait=1`) for an accurate banner;
// otherwise the server returns its non-blocking cache.
export const readUpdateStatus = async (
  host: string,
  port: number,
  wait: boolean,
): Promise<UpdateStatus | null> => {
  const url = `http://${host}:${port}/api/update-status${wait ? "?wait=1" : ""}`;
  try {
    const response = await daemonFetch(url, {
      signal: AbortSignal.timeout(UPDATE_BANNER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return updateStatusSchema.parse(await response.json());
  } catch {
    return null;
  }
};

// The daemon API is reachable over the host the daemon actually bound to. A
// wildcard bind (`0.0.0.0` / `::`) can't be fetched, so normalize to loopback
// for the self-HTTP the banner/foreground path makes.
export const resolveApiHost = (host: string): string =>
  host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host;
