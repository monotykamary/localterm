import { z } from "zod";
import {
  AUTOMATIONS_FILE_VERSION,
  MAX_AUTOMATION_COMMAND_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_COLS,
  MAX_CRON_EXPRESSION_LENGTH,
  MAX_FOREGROUND_LENGTH,
  MAX_INPUT_BYTES,
  MAX_NOTIFICATION_LENGTH,
  MAX_OUTPUT_BYTES,
  MAX_ROWS,
  MAX_TITLE_LENGTH,
} from "./constants.js";

export const healthSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number().int().nonnegative(),
  })
  .strict();

const inputMessageSchema = z
  .object({
    type: z.literal("input"),
    data: z.string().max(MAX_INPUT_BYTES),
  })
  .strict();

const resizeMessageSchema = z
  .object({
    type: z.literal("resize"),
    cols: z.number().int().positive().max(MAX_COLS),
    rows: z.number().int().positive().max(MAX_ROWS),
    pixelWidth: z.number().int().nonnegative().optional(),
    pixelHeight: z.number().int().nonnegative().optional(),
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
]);

const outputMessageSchema = z
  .object({
    type: z.literal("output"),
    data: z.string().max(MAX_OUTPUT_BYTES),
  })
  .strict();

const exitMessageSchema = z
  .object({
    type: z.literal("exit"),
    code: z.number().int().nullable(),
  })
  .strict();

const titleMessageSchema = z
  .object({
    type: z.literal("title"),
    title: z.string().max(MAX_TITLE_LENGTH),
  })
  .strict();

const sessionMessageSchema = z
  .object({
    type: z.literal("session"),
    shell: z.string().min(1),
    shellName: z.string().min(1),
    pid: z.number().int().nonnegative(),
    cwd: z.string().min(1),
    title: z.string().max(MAX_TITLE_LENGTH),
  })
  .strict();

const cwdMessageSchema = z
  .object({
    type: z.literal("cwd"),
    cwd: z.string().min(1),
  })
  .strict();

const foregroundMessageSchema = z
  .object({
    type: z.literal("foreground"),
    process: z.string().max(MAX_FOREGROUND_LENGTH).nullable(),
  })
  .strict();

const notificationMessageSchema = z
  .object({
    type: z.literal("notification"),
    body: z.string().min(1).max(MAX_NOTIFICATION_LENGTH),
  })
  .strict();

export const gitDiffFileStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);

// Lightweight working-tree stats polled by the browser for the diff indicator.
export const gitDiffSummarySchema = z
  .object({
    isRepo: z.boolean(),
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaries: z.number().int().nonnegative(),
  })
  .strict();

const gitDiffSummaryMessageSchema = z
  .object({
    type: z.literal("git-diff-summary"),
    summary: gitDiffSummarySchema,
  })
  .strict();

export const automationLastRunStatusSchema = z.enum([
  "launched",
  "running",
  "completed",
  "failed",
  "missed",
]);

export const automationLastRunSchema = z
  .object({
    runId: z.string().min(1),
    at: z.number().int().nonnegative(),
    status: automationLastRunStatusSchema,
    exitCode: z.number().int().nullable(),
  })
  .strict();

const automationShape = {
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
  schedule: z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
  cwd: z.string().min(1),
  command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastRun: automationLastRunSchema.nullable(),
};

export const automationSchema = z.object(automationShape).strict();

export const automationWithNextRunSchema = z
  .object({ ...automationShape, nextRunAt: z.number().int().nullable() })
  .strict();

export const automationsFileSchema = z
  .object({
    version: z.literal(AUTOMATIONS_FILE_VERSION),
    automations: z.array(automationSchema),
  })
  .strict();

export const createAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    schedule: z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
    cwd: z.string().min(1),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    enabled: z.boolean().optional(),
  })
  .strict();

export const updateAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH).optional(),
    schedule: z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH).optional(),
    cwd: z.string().min(1).optional(),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const automationsListResponseSchema = z
  .object({ automations: z.array(automationWithNextRunSchema) })
  .strict();

const automationsMessageSchema = z
  .object({
    type: z.literal("automations"),
    automations: z.array(automationWithNextRunSchema),
  })
  .strict();

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  outputMessageSchema,
  exitMessageSchema,
  titleMessageSchema,
  sessionMessageSchema,
  cwdMessageSchema,
  foregroundMessageSchema,
  notificationMessageSchema,
  gitDiffSummaryMessageSchema,
  automationsMessageSchema,
]);

export const gitDiffFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).nullable(),
    status: gitDiffFileStatusSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
    // Unified diff text for this file. Null when the file is binary or the
    // patch was dropped for size (patchOmitted distinguishes the two).
    patch: z.string().nullable(),
    patchOmitted: z.boolean(),
  })
  .strict();

export const gitDiffResponseSchema = z
  .object({
    isRepo: z.boolean(),
    files: z.array(gitDiffFileSchema),
  })
  .strict();
