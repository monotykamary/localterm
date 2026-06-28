import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PortsButtonProps {
  onOpen: () => void;
}

// Toolbar trigger for the open-ports modal (the management UI lives in
// ports-modal.tsx). Opens a modal — not a popover — so it can host a search
// field and a live list of dev servers, and reads as a first-class feature
// alongside Sessions, Worktrees, and Automations. No dedicated keyboard
// shortcut (every free letter is taken by a browser or localterm binding);
// keyboard users reach it via the command palette's "Dev ports" entry.
export const PortsButton = ({ onOpen }: PortsButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="open ports"
    title="Open dev ports"
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <Network />
  </Button>
);
