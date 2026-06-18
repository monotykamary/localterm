import fs from "node:fs";
import path from "node:path";
import {
  MAX_WORKTREE_OPEN_IN_COMMANDS,
  MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH,
  MAX_WORKTREE_OPEN_IN_ID_LENGTH,
  MAX_WORKTREE_OPEN_IN_LABEL_LENGTH,
  MAX_WORKTREE_SETUP_SCRIPT_LENGTH,
  WORKTREE_CONFIG_DIRNAME,
  WORKTREE_CONFIG_FILE_VERSION,
} from "./constants.js";
import { mainWorktreeRoot, repoId } from "./git-worktrees.js";
import { worktreeRepoConfigFileSchema } from "./schemas.js";
import type { WorktreeOpenInCommand, WorktreeRepoConfig } from "./types.js";

interface StoredWorktreeRepoConfig {
  version: number;
  setupScript: string;
  openInCommands: WorktreeOpenInCommand[];
  baseRef: "fresh" | "head";
}

// A fresh repo behaves like pre-config worktrees: no setup, no open-in commands,
// base ref "fresh" (new worktrees branch from origin/HEAD when a remote exists,
// else HEAD). All fields default off so upgrading is a no-op until configured.
const DEFAULT_CONFIG: StoredWorktreeRepoConfig = {
  version: WORKTREE_CONFIG_FILE_VERSION,
  setupScript: "",
  openInCommands: [],
  baseRef: "fresh",
};

const sanitizeSetupScript = (value: string | undefined): string =>
  (value ?? "").slice(0, MAX_WORKTREE_SETUP_SCRIPT_LENGTH);

// Drop empties, cap label/command/id lengths, dedupe by id (last wins), and cap
// the count. ids are client-stable so the editor can key rows across edits.
const sanitizeOpenInCommands = (
  commands: readonly WorktreeOpenInCommand[] | undefined,
): WorktreeOpenInCommand[] => {
  const seen = new Map<string, WorktreeOpenInCommand>();
  for (const raw of commands ?? []) {
    const id = raw.id.slice(0, MAX_WORKTREE_OPEN_IN_ID_LENGTH).trim();
    const label = raw.label.trim().slice(0, MAX_WORKTREE_OPEN_IN_LABEL_LENGTH);
    const command = raw.command.trim().slice(0, MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH);
    if (!id || !label || !command) continue;
    seen.set(id, { id, label, command });
  }
  return [...seen.values()].slice(0, MAX_WORKTREE_OPEN_IN_COMMANDS);
};

const toWire = (stored: StoredWorktreeRepoConfig): WorktreeRepoConfig => ({
  setupScript: stored.setupScript,
  openInCommands: stored.openInCommands,
  baseRef: stored.baseRef,
});

// Owns per-repo worktree preferences (~/.localterm/worktree-configs/<repo-id>.json):
// the setup script run in each fresh worktree, the custom "Open in…" launchers,
// and the default base ref new worktrees branch from. The repo id is a stable
// hash of the main worktree's absolute path, so the config survives regardless
// of the auto-created folder name and is shared across every linked worktree.
// Mirrors CaffeinatePreferencesStore's load/persist shape (zod-validated read,
// atomic tmp+rename write).
export class WorktreeConfigStore {
  constructor(private readonly stateDirectory: string) {}

  // The path the config for a given repo id lives at. Exposed so callers (tests,
  // sweeps) can locate or clean it; the store reads/writes through this path.
  private configPathFor = (repoIdValue: string): string =>
    path.join(this.stateDirectory, WORKTREE_CONFIG_DIRNAME, `${repoIdValue}.json`);

  async get(cwd: string): Promise<WorktreeRepoConfig> {
    const stored = await this.readStored(cwd);
    return toWire(stored);
  }

  async update(cwd: string, patch: Partial<WorktreeRepoConfig>): Promise<WorktreeRepoConfig> {
    const current = await this.readStored(cwd);
    const next: StoredWorktreeRepoConfig = {
      version: WORKTREE_CONFIG_FILE_VERSION,
      setupScript:
        patch.setupScript !== undefined
          ? sanitizeSetupScript(patch.setupScript)
          : current.setupScript,
      openInCommands:
        patch.openInCommands !== undefined
          ? sanitizeOpenInCommands(patch.openInCommands)
          : current.openInCommands,
      baseRef: patch.baseRef ?? current.baseRef,
    };
    await this.persist(cwd, next);
    return toWire(next);
  }

  private async readStored(cwd: string): Promise<StoredWorktreeRepoConfig> {
    const mainRoot = await mainWorktreeRoot(cwd);
    if (!mainRoot) return { ...DEFAULT_CONFIG };
    const filePath = this.configPathFor(repoId(mainRoot));
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      return { ...DEFAULT_CONFIG };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
    const parsed = worktreeRepoConfigFileSchema.safeParse(json);
    if (!parsed.success) return { ...DEFAULT_CONFIG };
    return {
      version: parsed.data.version,
      setupScript: parsed.data.setupScript,
      openInCommands: sanitizeOpenInCommands(parsed.data.openInCommands),
      baseRef: parsed.data.baseRef,
    };
  }

  private async persist(cwd: string, config: StoredWorktreeRepoConfig): Promise<void> {
    const mainRoot = await mainWorktreeRoot(cwd);
    if (!mainRoot) return;
    const filePath = this.configPathFor(repoId(mainRoot));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, filePath);
  }
}

// Re-exported so tests can compute the expected config path for a repo dir
// without re-deriving the hash.
export const worktreeConfigPathFor = (stateDirectory: string, mainRoot: string): string =>
  path.join(stateDirectory, WORKTREE_CONFIG_DIRNAME, `${repoId(mainRoot)}.json`);
