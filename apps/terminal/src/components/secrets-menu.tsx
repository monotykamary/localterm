import { Key } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SecretsButtonProps {
  onOpen: () => void;
}

// Toolbar trigger for the secrets modal (the management UI lives in
// secrets-modal.tsx). Opens a modal — not a popover — so it can host a secret
// list and an edit form, and reads as a first-class feature alongside
// Sessions, Worktrees, Ports, and Automations.
export const SecretsButton = ({ onOpen }: SecretsButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="open secrets"
    title="Manage secrets"
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <Key />
  </Button>
);
