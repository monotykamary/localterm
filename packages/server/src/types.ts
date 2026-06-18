import type { z } from "zod";
import type {
  automationLastRunSchema,
  automationLastRunStatusSchema,
  automationLifecycleSchema,
  automationRunLimitSchema,
  automationRunRecordSchema,
  automationRunStatusSchema,
  automationScheduleSchema,
  automationSchema,
  automationSessionEventSchema,
  automationTriggerSchema,
  automationV1Schema,
  automationV2Schema,
  automationWithNextRunSchema,
  caffeinateModeSchema,
  clientToServerMessageSchema,
  createAutomationInputSchema,
  gitBaseSourceSchema,
  gitBranchInfoSchema,
  gitBranchPrLeaseSchema,
  gitBranchPrSchema,
  gitBranchPrStateSchema,
  gitDiffFileListResponseSchema,
  gitDiffFileMetaSchema,
  gitDiffFilePatchSchema,
  gitDiffFileSchema,
  gitDiffFileStatusSchema,
  gitDiffModeSchema,
  gitDiffResponseSchema,
  gitDiffSummarySchema,
  gitWorktreeListResponseSchema,
  gitWorktreeResultSchema,
  gitWorktreeSchema,
  gitWorktreeBaseRefSchema,
  createWorktreeInputSchema,
  worktreeOpenInCommandSchema,
  worktreeRepoConfigFileSchema,
  worktreeRepoConfigSchema,
  updateWorktreeConfigInputSchema,
  worktreeSweepResultSchema,
  launchInputSchema,
  resetAutomationInputSchema,
  serverToClientMessageSchema,
  triggerInputSchema,
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

export type CaffeinateMode = z.infer<typeof caffeinateModeSchema>;

export type AutomationLastRunStatus = z.infer<typeof automationLastRunStatusSchema>;
export type AutomationLastRun = z.infer<typeof automationLastRunSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationSessionEvent = z.infer<typeof automationSessionEventSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type TriggerInput = z.infer<typeof triggerInputSchema>;
export type AutomationRunLimit = z.infer<typeof automationRunLimitSchema>;
export type AutomationLifecycle = z.infer<typeof automationLifecycleSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationRunRecord = z.infer<typeof automationRunRecordSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationV1 = z.infer<typeof automationV1Schema>;
export type AutomationV2 = z.infer<typeof automationV2Schema>;
export type AutomationWithNextRun = z.infer<typeof automationWithNextRunSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationInputSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;
export type ResetAutomationInput = z.infer<typeof resetAutomationInputSchema>;

export type GitDiffFileStatus = z.infer<typeof gitDiffFileStatusSchema>;
export type GitDiffMode = z.infer<typeof gitDiffModeSchema>;
export type GitBaseSource = z.infer<typeof gitBaseSourceSchema>;
export type GitBranchPrState = z.infer<typeof gitBranchPrStateSchema>;
export type GitBranchPr = z.infer<typeof gitBranchPrSchema>;
export type GitBranchInfo = z.infer<typeof gitBranchInfoSchema>;
export type GitBranchPrLease = z.infer<typeof gitBranchPrLeaseSchema>;
export type GitWorktree = z.infer<typeof gitWorktreeSchema>;
export type GitWorktreeListResponse = z.infer<typeof gitWorktreeListResponseSchema>;
export type GitWorktreeResult = z.infer<typeof gitWorktreeResultSchema>;
export type GitWorktreeBaseRef = z.infer<typeof gitWorktreeBaseRefSchema>;
export type CreateWorktreeInput = z.infer<typeof createWorktreeInputSchema>;
export type WorktreeOpenInCommand = z.infer<typeof worktreeOpenInCommandSchema>;
export type WorktreeRepoConfigFile = z.infer<typeof worktreeRepoConfigFileSchema>;
export type WorktreeRepoConfig = z.infer<typeof worktreeRepoConfigSchema>;
export type UpdateWorktreeConfigInput = z.infer<typeof updateWorktreeConfigInputSchema>;
export type WorktreeSweepResult = z.infer<typeof worktreeSweepResultSchema>;
export type LaunchInput = z.infer<typeof launchInputSchema>;
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>;
export type GitDiffFileMeta = z.infer<typeof gitDiffFileMetaSchema>;
export type GitDiffFileListResponse = z.infer<typeof gitDiffFileListResponseSchema>;
export type GitDiffFilePatch = z.infer<typeof gitDiffFilePatchSchema>;
export type GitDiffFile = z.infer<typeof gitDiffFileSchema>;
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
