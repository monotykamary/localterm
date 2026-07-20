import type { ComponentProps } from "react";
import { AutomationsModal } from "@/components/automations-modal";
import { CommandPalette } from "@/components/command-palette";
import { DiffViewer } from "@/components/diff-viewer";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { PortsModal } from "@/components/ports-modal";
import { QrModal } from "@/components/qr-modal";
import { SecretsModal } from "@/components/secrets-modal";
import { SessionsModal } from "@/components/sessions-modal";
import { WorktreesModal } from "@/components/worktrees-modal";

interface TerminalOverlaysProps {
  commandPalette: ComponentProps<typeof CommandPalette>;
  diffViewer: ComponentProps<typeof DiffViewer>;
  keyboardShortcutsModal: ComponentProps<typeof KeyboardShortcutsModal>;
  automationsModal: ComponentProps<typeof AutomationsModal>;
  worktreesModal: ComponentProps<typeof WorktreesModal>;
  sessionsModal: ComponentProps<typeof SessionsModal>;
  portsModal: ComponentProps<typeof PortsModal>;
  secretsModal: ComponentProps<typeof SecretsModal>;
  qrModal: ComponentProps<typeof QrModal>;
}

export const TerminalOverlays = ({
  commandPalette,
  diffViewer,
  keyboardShortcutsModal,
  automationsModal,
  worktreesModal,
  sessionsModal,
  portsModal,
  secretsModal,
  qrModal,
}: TerminalOverlaysProps) => (
  <>
    <CommandPalette {...commandPalette} />
    <DiffViewer {...diffViewer} />
    <KeyboardShortcutsModal {...keyboardShortcutsModal} />
    <AutomationsModal {...automationsModal} />
    <WorktreesModal {...worktreesModal} />
    <SessionsModal {...sessionsModal} />
    <PortsModal {...portsModal} />
    <SecretsModal {...secretsModal} />
    <QrModal {...qrModal} />
  </>
);
