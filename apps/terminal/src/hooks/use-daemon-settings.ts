import { useCallback, useState } from "react";
import { connectCdp } from "@/utils/connect-cdp";
import { fetchDaemonConfig } from "@/utils/fetch-daemon-config";
import { fetchServerHealth } from "@/utils/fetch-server-health";
import { openInspectPage } from "@/utils/open-inspect-page";
import { updateDaemonConfig } from "@/utils/update-daemon-config";

interface CdpStatus {
  connected: boolean;
  browser?: string;
  port?: number;
  error?: string;
}

export const useDaemonSettings = () => {
  const [cdpPort, setCdpPort] = useState<number | null>(null);
  const [graceSeconds, setGraceSeconds] = useState<number | null>(null);
  const [workspaceRestore, setWorkspaceRestore] = useState(true);
  // The daemon's detected default shell (from `GET /api/config`), shown as the
  // Settings → Launch shell field's placeholder so the user knows what an
  // empty field falls back to. Lazily fetched when the Settings panel opens
  // (alongside cdpPort/graceSeconds) since it's only needed for the hint.
  const [detectedDefaultShell, setDetectedDefaultShell] = useState<string>("");
  const [cdpStatus, setCdpStatus] = useState<CdpStatus | null>(null);
  const [cdpConnecting, setCdpConnecting] = useState(false);

  const refreshCdpStatus = useCallback(() => {
    void fetchServerHealth().then((health) => {
      if (health) setCdpStatus(health.cdp);
    });
  }, []);

  // The CDP port lives on the daemon, so the settings field is hydrated when
  // the modal opens (not held in localStorage like the terminal-appearance
  // prefs). A port change PUTs to the daemon, which reconnects in the
  // background; health is re-fetched after a short delay so the "Connected"
  // status reflects the new endpoint.
  // Persist the configured port. No connect and no status refresh here — a
  // port change only updates the value the daemon's next connect reads. The
  // explicit Connect button applies it; the live socket is left untouched.
  const handleCdpPortChange = useCallback((next: number | null) => {
    setCdpPort(next);
    void updateDaemonConfig({ cdpPort: next }).then((confirmed) => {
      if (confirmed) setCdpPort(confirmed.cdpPort);
    });
  }, []);

  // The grace window lives on the daemon; PUT the new value and adopt the
  // clamped confirmation (the daemon re-arms already-dormant shells).
  const handleGraceSecondsChange = useCallback((next: number | null) => {
    setGraceSeconds(next);
    void updateDaemonConfig({ graceSeconds: next }).then((confirmed) => {
      if (confirmed) setGraceSeconds(confirmed.graceSeconds);
    });
  }, []);

  // The workspace-restore toggle lives on the daemon; PUT the new value and
  // adopt the confirmation. Takes effect on the next daemon start (restore
  // runs once at startup, not live-reactively).
  const handleWorkspaceRestoreChange = useCallback((next: boolean) => {
    setWorkspaceRestore(next);
    void updateDaemonConfig({ workspaceRestore: next }).then((confirmed) => {
      if (confirmed) setWorkspaceRestore(confirmed.workspaceRestore);
    });
  }, []);

  // Explicit "Connect now": await the daemon's connect and fold the result
  // (including any error) into cdpStatus, so the field shows why a connection
  // failed rather than silently staying "Not connected".
  const handleCdpConnect = useCallback(() => {
    setCdpConnecting(true);
    void connectCdp().then((result) => {
      setCdpConnecting(false);
      if (result) {
        setCdpStatus({
          connected: result.connected,
          browser: result.browser,
          port: result.port,
          error: result.error,
        });
      } else {
        refreshCdpStatus();
      }
    });
  }, [refreshCdpStatus]);

  const handleOpenInspect = useCallback(() => {
    void openInspectPage();
  }, []);

  const loadDaemonSettings = useCallback(() => {
    void fetchDaemonConfig().then((config) => {
      if (config) {
        setCdpPort(config.cdpPort);
        setGraceSeconds(config.graceSeconds);
        setWorkspaceRestore(config.workspaceRestore);
        setDetectedDefaultShell(config.defaultShell);
      }
    });
    refreshCdpStatus();
  }, [refreshCdpStatus]);

  return {
    cdpPort,
    graceSeconds,
    workspaceRestore,
    detectedDefaultShell,
    cdpStatus,
    cdpConnecting,
    handleCdpPortChange,
    handleGraceSecondsChange,
    handleWorkspaceRestoreChange,
    handleCdpConnect,
    handleOpenInspect,
    loadDaemonSettings,
  };
};
