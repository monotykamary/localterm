import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KeyboardFloatingButtonProps {
  readonly isOnScreenKeyboardOpen: boolean;
  readonly onToggle: () => void;
}

export const KeyboardFloatingButton = ({
  isOnScreenKeyboardOpen,
  onToggle,
}: KeyboardFloatingButtonProps) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    // data-on-screen-keyboard-toggle exempts the button from the close-on-outside-
    // press arbitration so a tap toggles instead of being swallowed as dismissal.
    data-on-screen-keyboard-toggle
    onClick={onToggle}
    aria-label={isOnScreenKeyboardOpen ? "hide on-screen keyboard" : "show on-screen keyboard"}
    aria-pressed={isOnScreenKeyboardOpen}
    className={cn(
      "absolute right-3 bottom-3 z-10 size-11 rounded-full border border-border/60 bg-background/70 text-muted-foreground shadow-xs backdrop-blur-md transition-colors duration-200 ease-snappy hover:text-foreground",
      isOnScreenKeyboardOpen && "text-primary",
    )}
  >
    <Keyboard className="size-5" />
  </Button>
);
