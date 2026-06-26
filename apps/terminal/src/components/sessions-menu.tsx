import { SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionsButtonProps {
  onOpen: () => void;
  isMac: boolean;
}

// Toolbar trigger for the sessions modal (the management UI lives in
// sessions-modal.tsx). Opens a modal — not a popover — so it can host a search
// field and a virtualized list for many live shells, and reads as a first-class
// feature alongside Worktrees and Automations.
export const SessionsButton = ({ onOpen, isMac }: SessionsButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="sessions"
    title={isMac ? "⌘I" : "Ctrl+I"}
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <SquareTerminal />
  </Button>
);
