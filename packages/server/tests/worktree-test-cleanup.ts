import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKTREES_PARENT_DIR = path.join(os.homedir(), ".localterm", "worktrees");

// Test repos are created under os.tmpdir() with these basename prefixes (via
// mkdtempSync), and the same-name disambiguation test uses the exact name
// "same-name". Project folders in the shared worktrees dir matching these are
// unambiguously test artifacts — a real repo's basename would have to be exactly
// "localterm-worktree-test-<6>" / "localterm-wtsweep-<6>" / "same-name" /
// "same-name-<6hex>", which only the tests produce.
const TEST_FOLDER_PREFIXES = ["localterm-worktree-test-", "localterm-wtsweep-"];
const SAME_NAME_EXACT = "same-name";
const SAME_NAME_DISAMBIGUATION = /^same-name-[0-9a-f]{6}$/;

const isTestLeftover = (entry: string): boolean =>
  TEST_FOLDER_PREFIXES.some((prefix) => entry.startsWith(prefix)) ||
  entry === SAME_NAME_EXACT ||
  SAME_NAME_DISAMBIGUATION.test(entry);

// Removes project folders the worktree tests drop into ~/.localterm/worktrees/
// when a run is interrupted before its own `finally` runs. Called in beforeAll so
// a prior interrupted run's leftovers are GC'd before this run starts; safe by
// name (see isTestLeftover), never touching a real repo's project folder.
export const cleanupWorktreeTestLeftovers = (): void => {
  let entries: string[];
  try {
    entries = fs.readdirSync(WORKTREES_PARENT_DIR);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (isTestLeftover(entry)) {
      fs.rmSync(path.join(WORKTREES_PARENT_DIR, entry), { recursive: true, force: true });
    }
  }
};
