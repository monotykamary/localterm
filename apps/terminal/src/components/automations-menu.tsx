import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AutomationsButtonProps {
  onOpen: () => void;
  isMac: boolean;
}

// Toolbar trigger for the automations modal (the management UI lives in
// automations-modal.tsx). Opened here or via Cmd/Ctrl+J.
export const AutomationsButton = ({ onOpen, isMac }: AutomationsButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="automations"
    title={`${isMac ? "⌘" : "Ctrl+"}J`}
    className="hover:text-foreground"
    onClick={onOpen}
  >
    <CalendarClock />
  </Button>
);
