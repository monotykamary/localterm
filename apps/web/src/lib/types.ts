import type { z } from "zod";
import type { sessionMetadataSchema } from "./schemas";

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;

export type ClientToServerMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };
