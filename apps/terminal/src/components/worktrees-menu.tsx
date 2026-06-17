import { FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorktreesButtonProps {
  onOpen: () => void;
  isMac: boolean;
}

// Toolbar trigger for the worktrees modal (the management UI lives in
// worktrees-modal.tsx). Opened here or via Cmd/Ctrl+B.
export const WorktreesButton = ({ onOpen, isMac }: WorktreesButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="worktrees"
    title={`${isMac ? "⌘" : "Ctrl+"}B`}
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <FolderGit2 />
  </Button>
);
