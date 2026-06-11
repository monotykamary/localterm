import { z } from "zod";
import {
  MAX_COLS,
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

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  outputMessageSchema,
  exitMessageSchema,
  titleMessageSchema,
  sessionMessageSchema,
  cwdMessageSchema,
  foregroundMessageSchema,
  notificationMessageSchema,
]);

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
