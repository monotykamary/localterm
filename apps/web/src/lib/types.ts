import type { z } from "zod";
import type { sessionMetadataSchema, serverToClientMessageSchema } from "./schemas";

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;

export interface CreateSessionInput {
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string>;
  inheritCwdFromSessionId?: string;
}

export type ClientToServerMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };
