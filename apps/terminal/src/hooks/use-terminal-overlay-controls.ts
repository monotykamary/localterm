import { useCallback, type MouseEvent, type RefObject } from "react";
import { TOOLBAR_HIDE_DELAY_MS, TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS } from "@/lib/constants";

interface UseTerminalOverlayControlsOptions {
  isAutomationsOpen: boolean;
  isSessionsOpen: boolean;
  isSettingsOpen: boolean;
  isPortsOpen: boolean;
  isSecretsOpen: boolean;
  isWorktreesOpen: boolean;
  loadDaemonSettings: () => void;
  refocusTerminalRef: RefObject<(() => void) | null>;
  setIsActionsMenuOpen: (open: boolean) => void;
  setIsAutomationsOpen: (open: boolean) => void;
  setIsCommandPaletteOpen: (open: boolean) => void;
  setIsKeepAwakePopoverOpen: (open: boolean) => void;
  setIsPortsOpen: (open: boolean) => void;
  setIsQrOpen: (open: boolean) => void;
  setIsSecretsOpen: (open: boolean) => void;
  setIsSessionsOpen: (open: boolean) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setIsToolbarHovered: (hovered: boolean) => void;
  setIsWorktreesOpen: (open: boolean) => void;
  setWorktreeCreateError: (error: string | null) => void;
  toolbarHoverTimeoutRef: RefObject<number | null>;
}

interface UseTerminalOverlayControlsResult {
  handleAutomationsOpenChange: (open: boolean) => void;
  handleKeepAwakePopoverOpenChange: (open: boolean) => void;
  handlePortsOpenChange: (open: boolean) => void;
  handleQrOpenChange: (open: boolean) => void;
  handleSecretsOpenChange: (open: boolean) => void;
  handleSessionsOpenChange: (open: boolean) => void;
  handleSettingsOpenChange: (open: boolean) => void;
  handleToolbarAreaEnter: () => void;
  handleToolbarAreaLeave: (event: MouseEvent) => void;
  handleWorktreesOpenChange: (open: boolean) => void;
  openWorktrees: () => void;
  toggleAutomations: () => void;
  togglePorts: () => void;
  toggleSecrets: () => void;
  toggleSessions: () => void;
  toggleWorktrees: () => void;
}

export const useTerminalOverlayControls = ({
  isAutomationsOpen,
  isPortsOpen,
  isSecretsOpen,
  isSessionsOpen,
  isSettingsOpen,
  isWorktreesOpen,
  loadDaemonSettings,
  refocusTerminalRef,
  setIsActionsMenuOpen,
  setIsAutomationsOpen,
  setIsCommandPaletteOpen,
  setIsKeepAwakePopoverOpen,
  setIsPortsOpen,
  setIsQrOpen,
  setIsSecretsOpen,
  setIsSessionsOpen,
  setIsSettingsOpen,
  setIsToolbarHovered,
  setIsWorktreesOpen,
  setWorktreeCreateError,
  toolbarHoverTimeoutRef,
}: UseTerminalOverlayControlsOptions): UseTerminalOverlayControlsResult => {
  const handleKeepAwakePopoverOpenChange = useCallback(
    (open: boolean) => {
      setIsKeepAwakePopoverOpen(open);
      if (!open) setIsActionsMenuOpen(false);
    },
    [setIsActionsMenuOpen, setIsKeepAwakePopoverOpen],
  );

  const handleOverlayOpenChange = useCallback(
    (setOpen: (open: boolean) => void, open: boolean): void => {
      setOpen(open);
      if (open) {
        setIsActionsMenuOpen(false);
        setIsCommandPaletteOpen(false);
        return;
      }
      if (toolbarHoverTimeoutRef.current !== null) {
        window.clearTimeout(toolbarHoverTimeoutRef.current);
      }
      toolbarHoverTimeoutRef.current = window.setTimeout(() => {
        toolbarHoverTimeoutRef.current = null;
        setIsToolbarHovered(false);
      }, TOOLBAR_HIDE_DELAY_MS);
      refocusTerminalRef.current?.();
    },
    [
      refocusTerminalRef,
      setIsActionsMenuOpen,
      setIsCommandPaletteOpen,
      setIsToolbarHovered,
      toolbarHoverTimeoutRef,
    ],
  );

  const handleSessionsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsSessionsOpen, open),
    [handleOverlayOpenChange, setIsSessionsOpen],
  );

  const handlePortsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsPortsOpen, open),
    [handleOverlayOpenChange, setIsPortsOpen],
  );

  const handleSecretsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsSecretsOpen, open),
    [handleOverlayOpenChange, setIsSecretsOpen],
  );

  const handleQrOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsQrOpen, open),
    [handleOverlayOpenChange, setIsQrOpen],
  );

  const handleToolbarAreaEnter = useCallback(() => {
    if (toolbarHoverTimeoutRef.current !== null) {
      window.clearTimeout(toolbarHoverTimeoutRef.current);
      toolbarHoverTimeoutRef.current = null;
    }
    setIsToolbarHovered(true);
  }, [setIsToolbarHovered, toolbarHoverTimeoutRef]);

  const handleToolbarAreaLeave = useCallback(
    (event: MouseEvent) => {
      const leftThroughViewportEdge = event.clientY <= 0 || event.clientX >= window.innerWidth - 1;
      const delay = leftThroughViewportEdge
        ? TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS
        : TOOLBAR_HIDE_DELAY_MS;
      toolbarHoverTimeoutRef.current = window.setTimeout(() => {
        toolbarHoverTimeoutRef.current = null;
        if (!isSettingsOpen && !isAutomationsOpen) {
          setIsToolbarHovered(false);
        }
      }, delay);
    },
    [isSettingsOpen, isAutomationsOpen, setIsToolbarHovered, toolbarHoverTimeoutRef],
  );

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        loadDaemonSettings();
      } else {
        setIsActionsMenuOpen(false);
        if (toolbarHoverTimeoutRef.current !== null) {
          window.clearTimeout(toolbarHoverTimeoutRef.current);
        }
        toolbarHoverTimeoutRef.current = window.setTimeout(() => {
          toolbarHoverTimeoutRef.current = null;
          setIsToolbarHovered(false);
        }, TOOLBAR_HIDE_DELAY_MS);
      }
    },
    [
      loadDaemonSettings,
      setIsActionsMenuOpen,
      setIsSettingsOpen,
      setIsToolbarHovered,
      toolbarHoverTimeoutRef,
    ],
  );

  const handleAutomationsOpenChange = useCallback(
    (open: boolean) => handleOverlayOpenChange(setIsAutomationsOpen, open),
    [handleOverlayOpenChange, setIsAutomationsOpen],
  );

  const toggleAutomations = useCallback(() => {
    handleAutomationsOpenChange(!isAutomationsOpen);
  }, [handleAutomationsOpenChange, isAutomationsOpen]);

  const handleWorktreesOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setWorktreeCreateError(null);
      }
      handleOverlayOpenChange(setIsWorktreesOpen, open);
    },
    [handleOverlayOpenChange, setIsWorktreesOpen, setWorktreeCreateError],
  );

  const openWorktrees = useCallback(() => {
    setIsWorktreesOpen(true);
    setIsCommandPaletteOpen(false);
  }, [setIsCommandPaletteOpen, setIsWorktreesOpen]);

  const toggleWorktrees = useCallback(() => {
    handleWorktreesOpenChange(!isWorktreesOpen);
  }, [handleWorktreesOpenChange, isWorktreesOpen]);

  const toggleSessions = useCallback(() => {
    handleSessionsOpenChange(!isSessionsOpen);
  }, [handleSessionsOpenChange, isSessionsOpen]);

  const togglePorts = useCallback(() => {
    handlePortsOpenChange(!isPortsOpen);
  }, [handlePortsOpenChange, isPortsOpen]);

  const toggleSecrets = useCallback(() => {
    handleSecretsOpenChange(!isSecretsOpen);
  }, [handleSecretsOpenChange, isSecretsOpen]);

  return {
    handleAutomationsOpenChange,
    handleKeepAwakePopoverOpenChange,
    handlePortsOpenChange,
    handleQrOpenChange,
    handleSecretsOpenChange,
    handleSessionsOpenChange,
    handleSettingsOpenChange,
    handleToolbarAreaEnter,
    handleToolbarAreaLeave,
    handleWorktreesOpenChange,
    openWorktrees,
    toggleAutomations,
    togglePorts,
    toggleSecrets,
    toggleSessions,
    toggleWorktrees,
  };
};
