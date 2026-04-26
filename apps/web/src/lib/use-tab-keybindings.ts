import { useEffect } from "react";

interface KeybindingHandlers {
  onNewTab: () => void;
  onCloseTab: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onJumpTo: (index: number) => void;
}

export const useTabKeybindings = (handlers: KeybindingHandlers): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta) return;
      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        handlers.onNewTab();
      } else if (key === "w") {
        event.preventDefault();
        handlers.onCloseTab();
      } else if (event.shiftKey && key === "}") {
        event.preventDefault();
        handlers.onNextTab();
      } else if (event.shiftKey && key === "{") {
        event.preventDefault();
        handlers.onPrevTab();
      } else if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        handlers.onJumpTo(Number.parseInt(event.key, 10) - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlers]);
};
