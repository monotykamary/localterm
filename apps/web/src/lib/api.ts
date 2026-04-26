import { HTTP_STATUS_NO_CONTENT } from "@localterm/server/protocol";
import { sessionMetadataSchema, sessionsListSchema } from "./schemas";
import type { CreateSessionInput, SessionMetadata } from "./types";

export const fetchSessions = async (): Promise<SessionMetadata[]> => {
  const response = await fetch("/api/sessions");
  if (!response.ok) throw new Error(`failed to list sessions: ${response.status}`);
  return sessionsListSchema.parse(await response.json());
};

export const createSession = async (input: CreateSessionInput = {}): Promise<SessionMetadata> => {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`failed to create session: ${response.status}`);
  return sessionMetadataSchema.parse(await response.json());
};

export const deleteSession = async (sessionId: string): Promise<boolean> => {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  return response.status === HTTP_STATUS_NO_CONTENT;
};

export const buildWebSocketUrl = (sessionId: string): string => {
  const url = new URL(`/ws/${encodeURIComponent(sessionId)}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};
