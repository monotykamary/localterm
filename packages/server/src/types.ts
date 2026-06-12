import type { z } from "zod";
import type {
  automationLastRunSchema,
  automationLastRunStatusSchema,
  automationSchema,
  automationWithNextRunSchema,
  clientToServerMessageSchema,
  createAutomationInputSchema,
  gitDiffFileSchema,
  gitDiffFileStatusSchema,
  gitDiffResponseSchema,
  gitDiffSummarySchema,
  serverToClientMessageSchema,
  updateAutomationInputSchema,
} from "./schemas.js";

export interface SpawnPtyInput {
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  initialCommand?: string;
}

export interface PendingAutomationRun {
  runId: string;
  automationId: string;
  cwd: string;
  command: string;
  createdAt: number;
}

export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;

export type AutomationLastRunStatus = z.infer<typeof automationLastRunStatusSchema>;
export type AutomationLastRun = z.infer<typeof automationLastRunSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationWithNextRun = z.infer<typeof automationWithNextRunSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationInputSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;

export type GitDiffFileStatus = z.infer<typeof gitDiffFileStatusSchema>;
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>;
export type GitDiffFile = z.infer<typeof gitDiffFileSchema>;
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
