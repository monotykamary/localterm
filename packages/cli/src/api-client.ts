import {
  healthSchema,
  sessionMetadataSchema,
  sessionsListSchema,
  type CreateSessionInput,
  type SessionMetadata,
} from "@localterm/server";
import type { z } from "zod";

export interface ApiClient {
  health(): Promise<z.infer<typeof healthSchema>>;
  list(): Promise<SessionMetadata[]>;
  create(input?: CreateSessionInput): Promise<SessionMetadata>;
  remove(id: string): Promise<boolean>;
}

export const createApiClient = (port: number, host = "127.0.0.1"): ApiClient => {
  const base = `http://${host}:${port}`;
  return {
    async health() {
      const response = await fetch(`${base}/api/health`);
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      return healthSchema.parse(await response.json());
    },
    async list() {
      const response = await fetch(`${base}/api/sessions`);
      if (!response.ok) throw new Error(`list failed: ${response.status}`);
      return sessionsListSchema.parse(await response.json());
    },
    async create(input = {}) {
      const response = await fetch(`${base}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(`create failed: ${response.status}`);
      return sessionMetadataSchema.parse(await response.json());
    },
    async remove(id: string) {
      const response = await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return response.status === 204;
    },
  };
};
