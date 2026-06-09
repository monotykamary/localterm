import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@/components/terminal";

export const App = () => {
  const isModalOpenRef = useRef(false);
  const hasForegroundProcessRef = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isModalOpenRef.current) return;
      if (!hasForegroundProcessRef.current) return;
      event.preventDefault();
    };
    const armBeforeUnload = () => window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", armBeforeUnload, { once: true });
    return () => {
      window.removeEventListener("keydown", armBeforeUnload);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const handleModalOpenChange = useCallback((open: boolean) => {
    isModalOpenRef.current = open;
  }, []);

  const handleForegroundProcessChange = useCallback((hasProcess: boolean) => {
    hasForegroundProcessRef.current = hasProcess;
  }, []);

  return (
    <Terminal
      onModalOpenChange={handleModalOpenChange}
      onForegroundProcessChange={handleForegroundProcessChange}
    />
  );
};
