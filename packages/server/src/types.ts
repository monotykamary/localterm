import type { z } from "zod";
import type {
  automationLastRunSchema,
  automationLastRunStatusSchema,
  automationLifecycleSchema,
  automationRunLimitSchema,
  automationRunRecordSchema,
  automationRunStatusSchema,
  automationRunnerSchema,
  automationScheduleSchema,
  automationSchema,
  automationSessionEventSchema,
  automationTriggerSchema,
  automationV1Schema,
  automationV2Schema,
  automationV3Schema,
  automationWithNextRunSchema,
  agentHarnessSchema,
  agentLogEntrySchema,
  agentModelInfoSchema,
  agentSkillInfoSchema,
  agentSessionEntrySchema,
  caffeinateModeSchema,
  cdpHealthSchema,
  cdpConnectResultSchema,
  clientToServerMessageSchema,
  createAutomationInputSchema,
  daemonConfigSchema,
  updateDaemonConfigInputSchema,
  gitBaseSourceSchema,
  gitBranchInfoSchema,
  gitBranchPrLeaseSchema,
  gitBranchPrMergeableSchema,
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
  listeningPortSchema,
  listeningPortsResponseSchema,
  createWorktreeInputSchema,
  worktreeOpenInCommandSchema,
  worktreeRepoConfigFileSchema,
  worktreeRepoConfigSchema,
  updateWorktreeConfigInputSchema,
  worktreeIncludeFileInputSchema,
  worktreeIncludeFileSchema,
  worktreeSweepResultSchema,
  launchInputSchema,
  resetAutomationInputSchema,
  runnerInputSchema,
  serverToClientMessageSchema,
  sessionListItemSchema,
  sessionsListResponseSchema,
  sessionActivityStateSchema,
  createSessionInputSchema,
  sessionResponseSchema,
  updateSessionInputSchema,
  sessionInputSchema,
  sessionResizeSchema,
  execInputSchema,
  execOneShotInputSchema,
  execResultSchema,
  capturePaneResponseSchema,
  triggerInputSchema,
  updateAutomationInputSchema,
  secretEntrySchema,
  secretEntryResponseSchema,
  secretsListResponseSchema,
  secretSetInputSchema,
  processSchema,
  processSetInputSchema,
  processesListResponseSchema,
} from "./schemas.js";

export interface SpawnPtyInput {
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  initialCommand?: string;
  // Directory of the per-program secret shims. The shell hook prepends it to PATH
  // so the shims shadow the real binaries. Threaded from the daemon's actual
  // stateDirectory (not a hardcoded home path) so an overridden stateDirectory
  // keeps the hook and the generated shims in sync.
  shimsDir?: string;
}

export interface PendingAutomationRun {
  runId: string;
  automationId: string;
  cwd: string;
  // What to run. A shell runner is typed into the PTY as `initialCommand` when
  // the WS claims this run; an agent runner never reaches the WS (agent runs
  // are headless) so this is only meaningful for shell runs.
  runner: AutomationRunner;
  createdAt: number;
  // Secret env vars resolved from the backend at launch time, injected into
  // the run's PTY at spawn. Populated after `create()` once resolution settles;
  // empty/undefined until then. Carried on the run (not resolved at claim
  // time) because the WS `onOpen` spawn path is synchronous.
  env?: Record<string, string>;
}

export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;

export type CaffeinateMode = z.infer<typeof caffeinateModeSchema>;
export type CdpHealth = z.infer<typeof cdpHealthSchema>;
export type CdpConnectResult = z.infer<typeof cdpConnectResultSchema>;
export type DaemonConfig = z.infer<typeof daemonConfigSchema>;
export type UpdateDaemonConfigInput = z.infer<typeof updateDaemonConfigInputSchema>;

export type SecretEntry = z.infer<typeof secretEntrySchema>;
export type SecretEntryResponse = z.infer<typeof secretEntryResponseSchema>;
export type SecretsListResponse = z.infer<typeof secretsListResponseSchema>;
export type SecretSetInput = z.infer<typeof secretSetInputSchema>;
export type Process = z.infer<typeof processSchema>;
export type ProcessSetInput = z.infer<typeof processSetInputSchema>;
export type ProcessesListResponse = z.infer<typeof processesListResponseSchema>;

export type AutomationLastRunStatus = z.infer<typeof automationLastRunStatusSchema>;
export type AutomationLastRun = z.infer<typeof automationLastRunSchema>;
export type AutomationRunner = z.infer<typeof automationRunnerSchema>;
export type AgentHarnessConfig = z.infer<typeof agentHarnessSchema>;
export type AgentLogEntry = z.infer<typeof agentLogEntrySchema>;
export type AgentModelInfo = z.infer<typeof agentModelInfoSchema>;
export type AgentSkillInfo = z.infer<typeof agentSkillInfoSchema>;
export type AgentSessionEntry = z.infer<typeof agentSessionEntrySchema>;
export type RunnerInput = z.infer<typeof runnerInputSchema>;
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
export type AutomationV3 = z.infer<typeof automationV3Schema>;
export type AutomationWithNextRun = z.infer<typeof automationWithNextRunSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationInputSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;
export type ResetAutomationInput = z.infer<typeof resetAutomationInputSchema>;

export type GitDiffFileStatus = z.infer<typeof gitDiffFileStatusSchema>;
export type GitDiffMode = z.infer<typeof gitDiffModeSchema>;
export type GitBaseSource = z.infer<typeof gitBaseSourceSchema>;
export type GitBranchPrState = z.infer<typeof gitBranchPrStateSchema>;
export type GitBranchPrMergeable = z.infer<typeof gitBranchPrMergeableSchema>;
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
export type WorktreeIncludeFile = z.infer<typeof worktreeIncludeFileSchema>;
export type WorktreeIncludeFileInput = z.infer<typeof worktreeIncludeFileInputSchema>;
export type WorktreeSweepResult = z.infer<typeof worktreeSweepResultSchema>;
export type LaunchInput = z.infer<typeof launchInputSchema>;
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>;
export type SessionListItem = z.infer<typeof sessionListItemSchema>;
export type SessionListResponse = z.infer<typeof sessionsListResponseSchema>;
export type SessionActivityState = z.infer<typeof sessionActivityStateSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type SessionResize = z.infer<typeof sessionResizeSchema>;
export type ExecInput = z.infer<typeof execInputSchema>;
export type ExecOneShotInput = z.infer<typeof execOneShotInputSchema>;
export type ExecResultResponse = z.infer<typeof execResultSchema>;
export type CapturePaneResponse = z.infer<typeof capturePaneResponseSchema>;
export type ListeningPort = z.infer<typeof listeningPortSchema>;
export type ListeningPortsResponse = z.infer<typeof listeningPortsResponseSchema>;
export type GitDiffFileMeta = z.infer<typeof gitDiffFileMetaSchema>;
export type GitDiffFileListResponse = z.infer<typeof gitDiffFileListResponseSchema>;
export type GitDiffFilePatch = z.infer<typeof gitDiffFilePatchSchema>;
export type GitDiffFile = z.infer<typeof gitDiffFileSchema>;
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
