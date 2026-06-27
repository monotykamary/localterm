import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QrButtonProps {
  onOpen: () => void;
}

// Toolbar trigger for the session QR modal (the share/ingest UI lives in
// qr-modal.tsx). Reads as a first-class feature alongside Sessions and
// Worktrees; the modal it opens hosts the share/ingest switcher.
export const QrButton = ({ onOpen }: QrButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="share or ingest a session via QR"
    title="Share or ingest a session via QR"
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <QrCode />
  </Button>
);
