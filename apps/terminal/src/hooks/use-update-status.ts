import { useEffect, useRef, useState } from "react";
import { updateStatusSchema, type UpdateStatus } from "@monotykamary/localterm-server/protocol";
import { UPDATE_STATUS_POLL_INTERVAL_MS } from "@/lib/constants";

export interface UpdateStatusState {
  updateAvailable: boolean;
  latest: string | null;
}

const fetchUpdateStatus = async (signal: AbortSignal): Promise<UpdateStatus | null> => {
  try {
    const response = await fetch("/api/update-status", { signal });
    if (!response.ok) return null;
    return updateStatusSchema.parse(await response.json());
  } catch {
    return null;
  }
};

/**
 * Polls the daemon's cached npm update check and surfaces whether a newer
 * localterm release is available. The default (non-blocking) endpoint reads
 * the cache and triggers a background refresh only when stale, so a poll from
 * every open tab can't wedge on the registry. Never throws — a failed fetch
 * leaves the prior state untouched so the indicator is always stable.
 */
export const useUpdateStatus = (): UpdateStatusState => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    const poll = async (): Promise<void> => {
      const status = await fetchUpdateStatus(controller.signal);
      if (!mountedRef.current || status === null) return;
      setUpdateAvailable(status.updateAvailable);
      setLatest(status.latest);
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, UPDATE_STATUS_POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { updateAvailable, latest };
};
