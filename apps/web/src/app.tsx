import { useEffect, useRef, useState } from "react";
import { Terminal } from "@/components/terminal";
import { TERMINAL_BACKGROUND_HEX } from "@/lib/constants";
import { createSession } from "@/lib/api";

const URL_PARAM_PRIMARY = "id";
const URL_PARAM_LEGACY = "tab";

const readSessionIdFromUrl = (): string | null => {
  const params = new URL(window.location.href).searchParams;
  return params.get(URL_PARAM_PRIMARY) ?? params.get(URL_PARAM_LEGACY);
};

const writeSessionIdToUrl = (id: string) => {
  const next = new URL(window.location.href);
  next.searchParams.set(URL_PARAM_PRIMARY, id);
  next.searchParams.delete(URL_PARAM_LEGACY);
  window.history.replaceState({}, "", next);
};

export const App = () => {
  const [sessionId, setSessionId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readSessionIdFromUrl(),
  );
  const [error, setError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (sessionId) {
      writeSessionIdToUrl(sessionId);
      return;
    }
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void createSession()
      .then((session) => {
        writeSessionIdToUrl(session.id);
        setSessionId(session.id);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionId]);

  if (error) {
    return (
      <div
        className="grid h-dvh place-items-center text-sm"
        style={{ background: TERMINAL_BACKGROUND_HEX, color: "#ffffff" }}
      >
        cannot reach localterm — reload to retry ({error})
      </div>
    );
  }

  if (!sessionId) {
    return <div className="h-dvh w-dvw" style={{ background: TERMINAL_BACKGROUND_HEX }} />;
  }

  return <Terminal sessionId={sessionId} />;
};
