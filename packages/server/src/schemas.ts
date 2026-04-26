import { z } from "zod";
import {
  MAX_COLS,
  MAX_ENV_VALUE_BYTES,
  MAX_INPUT_BYTES,
  MAX_PATH_BYTES,
  MAX_ROWS,
} from "./constants.js";

export const sessionMetadataSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    cwd: z.string(),
    shell: z.string(),
    pid: z.number().int(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    exited: z.boolean(),
    exitCode: z.number().int().nullable(),
  })
  .strict();

export const sessionsListSchema = z.array(sessionMetadataSchema);

export const healthSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number().int().nonnegative(),
  })
  .strict();

export const createSessionInputSchema = z
  .object({
    cwd: z.string().max(MAX_PATH_BYTES).optional(),
    cols: z.number().int().positive().max(MAX_COLS).optional(),
    rows: z.number().int().positive().max(MAX_ROWS).optional(),
    shell: z.string().max(MAX_PATH_BYTES).optional(),
    env: z.record(z.string(), z.string().max(MAX_ENV_VALUE_BYTES)).optional(),
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
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
]);

const snapshotMessageSchema = z
  .object({
    type: z.literal("snapshot"),
    data: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    title: z.string(),
  })
  .strict();

const outputMessageSchema = z
  .object({
    type: z.literal("output"),
    data: z.string(),
  })
  .strict();

const titleMessageSchema = z
  .object({
    type: z.literal("title"),
    title: z.string(),
  })
  .strict();

const exitMessageSchema = z
  .object({
    type: z.literal("exit"),
    code: z.number().int().nullable(),
  })
  .strict();

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  snapshotMessageSchema,
  outputMessageSchema,
  titleMessageSchema,
  exitMessageSchema,
]);
