import type { z } from "zod";
import type {
  clientToServerMessageSchema,
  gitDiffFileSchema,
  gitDiffFileStatusSchema,
  gitDiffResponseSchema,
  gitDiffSummarySchema,
  serverToClientMessageSchema,
} from "./schemas.js";

export interface SpawnPtyInput {
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;

export type GitDiffFileStatus = z.infer<typeof gitDiffFileStatusSchema>;
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>;
export type GitDiffFile = z.infer<typeof gitDiffFileSchema>;
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
