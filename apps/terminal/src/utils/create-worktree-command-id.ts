import {
  WORKTREE_COMMAND_ID_RANDOM_RADIX,
  WORKTREE_COMMAND_ID_RANDOM_START_INDEX,
} from "@/lib/constants";

export const createWorktreeCommandId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.random()
        .toString(WORKTREE_COMMAND_ID_RANDOM_RADIX)
        .slice(WORKTREE_COMMAND_ID_RANDOM_START_INDEX)}`;
