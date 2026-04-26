import type { z } from "zod";
import type {
  clientToServerMessageSchema,
  createSessionInputSchema,
  serverToClientMessageSchema,
  sessionMetadataSchema,
} from "./schemas.js";

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;
