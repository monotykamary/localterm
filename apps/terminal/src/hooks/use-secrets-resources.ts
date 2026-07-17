import type { Process, SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { useCallback, useEffect, useState } from "react";
import { fetchProcesses } from "@/utils/fetch-processes";
import { fetchSecrets } from "@/utils/fetch-secrets";

interface SecretsResources {
  secrets: SecretEntryResponse[] | null;
  processes: Process[] | null;
  supported: boolean;
  hasError: boolean;
  refresh: () => Promise<void>;
}

export const useSecretsResources = (open: boolean): SecretsResources => {
  const [secrets, setSecrets] = useState<SecretEntryResponse[] | null>(null);
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    const [fetchedSecrets, fetchedProcesses] = await Promise.all([
      fetchSecrets(),
      fetchProcesses(),
    ]);
    if (fetchedSecrets === null || fetchedProcesses === null) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setSupported(fetchedSecrets.supported);
    setSecrets(fetchedSecrets.secrets);
    setProcesses(fetchedProcesses);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  return { secrets, processes, supported, hasError, refresh };
};
