import { useCallback, useRef, useState } from "react";
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
  const cdpPortUpdateVersionRef = useRef(0);
  const graceSecondsUpdateVersionRef = useRef(0);
  const workspaceRestoreUpdateVersionRef = useRef(0);

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
    const updateVersion = ++cdpPortUpdateVersionRef.current;
    setCdpPort(next);
    void updateDaemonConfig({ cdpPort: next }).then((confirmed) => {
      if (confirmed && updateVersion === cdpPortUpdateVersionRef.current) {
        setCdpPort(confirmed.cdpPort);
      }
    });
  }, []);

  // The grace window lives on the daemon; PUT the new value and adopt the
  // clamped confirmation (the daemon re-arms already-dormant shells).
  const handleGraceSecondsChange = useCallback((next: number | null) => {
    const updateVersion = ++graceSecondsUpdateVersionRef.current;
    setGraceSeconds(next);
    void updateDaemonConfig({ graceSeconds: next }).then((confirmed) => {
      if (confirmed && updateVersion === graceSecondsUpdateVersionRef.current) {
        setGraceSeconds(confirmed.graceSeconds);
      }
    });
  }, []);

  // The workspace-restore toggle lives on the daemon; PUT the new value and
  // adopt the confirmation. Takes effect on the next daemon start (restore
  // runs once at startup, not live-reactively).
  const handleWorkspaceRestoreChange = useCallback((next: boolean) => {
    const updateVersion = ++workspaceRestoreUpdateVersionRef.current;
    setWorkspaceRestore(next);
    void updateDaemonConfig({ workspaceRestore: next }).then((confirmed) => {
      if (confirmed && updateVersion === workspaceRestoreUpdateVersionRef.current) {
        setWorkspaceRestore(confirmed.workspaceRestore);
      }
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
    const cdpPortUpdateVersion = cdpPortUpdateVersionRef.current;
    const graceSecondsUpdateVersion = graceSecondsUpdateVersionRef.current;
    const workspaceRestoreUpdateVersion = workspaceRestoreUpdateVersionRef.current;
    void fetchDaemonConfig().then((config) => {
      if (config) {
        if (cdpPortUpdateVersion === cdpPortUpdateVersionRef.current) {
          setCdpPort(config.cdpPort);
        }
        if (graceSecondsUpdateVersion === graceSecondsUpdateVersionRef.current) {
          setGraceSeconds(config.graceSeconds);
        }
        if (workspaceRestoreUpdateVersion === workspaceRestoreUpdateVersionRef.current) {
          setWorkspaceRestore(config.workspaceRestore);
        }
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
