import type {ComponentProps} from "react";
import {AutomationsModal} from "@/components/automations-modal";
import {CommandPalette} from "@/components/command-palette";
import {DiffViewer} from "@/components/diff-viewer";
import {PortsModal} from "@/components/ports-modal";
import {QrModal} from "@/components/qr-modal";
import {SecretsModal} from "@/components/secrets-modal";
import {SessionsModal} from "@/components/sessions-modal";
import {WorktreesModal} from "@/components/worktrees-modal";

interface TerminalOverlaysProps {
  commandPalette: ComponentProps<typeof CommandPalette>;
  diffViewer: ComponentProps<typeof DiffViewer>;
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
    <AutomationsModal {...automationsModal} />
    <WorktreesModal {...worktreesModal} />
    <SessionsModal {...sessionsModal} />
    <PortsModal {...portsModal} />
    <SecretsModal {...secretsModal} />
    <QrModal {...qrModal} />
  </>
);
