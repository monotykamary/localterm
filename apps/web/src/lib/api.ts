import { sessionMetadataSchema } from "./schemas";
import type { SessionMetadata } from "./types";

export const createSession = async (): Promise<SessionMetadata> => {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`failed to create session: ${response.status}`);
  return sessionMetadataSchema.parse(await response.json());
};

export const buildWebSocketUrl = (sessionId: string): string => {
  const url = new URL(`/ws/${encodeURIComponent(sessionId)}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};
