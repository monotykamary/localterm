import { useEffect, useRef, useState } from "react";
import { Terminal } from "@/components/terminal";
import { TERMINAL_BACKGROUND_HEX } from "@/lib/constants";
import { createSession } from "@/lib/api";

const SESSION_ID_PATTERN = /^[a-z2-9-]+$/i;
const URL_PARAM_LEGACY_PRIMARY = "id";
const URL_PARAM_LEGACY_FALLBACK = "tab";

const readSessionIdFromUrl = (): string | null => {
  const url = new URL(window.location.href);
  const fromQuery =
    url.searchParams.get(URL_PARAM_LEGACY_PRIMARY) ??
    url.searchParams.get(URL_PARAM_LEGACY_FALLBACK);
  if (fromQuery && SESSION_ID_PATTERN.test(fromQuery)) return fromQuery;
  const pathSegment = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pathSegment) return null;
  if (!SESSION_ID_PATTERN.test(pathSegment)) return null;
  return pathSegment;
};

const writeSessionIdToUrl = (id: string) => {
  const desiredPath = `/${id}`;
  const current = window.location;
  if (current.pathname === desiredPath && !current.search) return;
  window.history.replaceState({}, "", desiredPath);
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
        cannot reach localterm. reload to retry ({error})
      </div>
    );
  }

  if (!sessionId) {
    return <div className="h-dvh w-dvw" style={{ background: TERMINAL_BACKGROUND_HEX }} />;
  }

  return <Terminal sessionId={sessionId} />;
};
