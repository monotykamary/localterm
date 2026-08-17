import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_FILE_VERSION } from "./constants.js";
import { workspaceFileSchema } from "./schemas.js";

// One open browser tab in the persisted workspace manifest: the cwd + shell to
// respawn it in. The title is derived from cwd (format-working-directory-title),
// so it isn't stored. A live PTY never survives a daemon stop, so restore always
// spawns fresh in these — the manifest records the *layout*, not the shells.
export interface WorkspaceTab {
  cwd: string;
  shell: string;
}

// A browser profile's open tabs at snapshot time. `owner` is null in
// single-authority mode; the authenticated user under an identity provider.
// `windowId` is the per-browser-profile handle (localStorage), so the manifest
// is partitioned per profile — the desktop browser's tabs never restore onto a
// phone PWA (a different windowId, and not CDP-reachable anyway).
export interface WorkspaceEntry {
  owner: string | null;
  windowId: string;
  tabs: WorkspaceTab[];
  savedAt: number;
}

interface WorkspaceFile {
  version: number;
  entries: WorkspaceEntry[];
}

// Persists the open-tab workspace manifest to ~/.localterm/workspace.json so the
// daemon can reopen the same tabs via CDP on the next start (a tmux-resurrect /
// herdr-style restore of the *layout*; the shells themselves don't survive a
// stop). Mirrors the daemon config store: zod-validated read, atomic
// tmp+rename write, graceful fallback to empty on a missing/corrupt file. The
// manifest excludes automation-run tabs (one-shot) and dormant/orphaned shells
// (no attached viewer) — only tabs that were actively open are restored.
export class WorkspaceStore {
  constructor(private readonly filePath: string) {}

  read(): WorkspaceEntry[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return [];
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return [];
    }
    const parsed = workspaceFileSchema.safeParse(json);
    return parsed.success ? parsed.data.entries : [];
  }

  write(entries: readonly WorkspaceEntry[]): void {
    const file: WorkspaceFile = {
      version: WORKSPACE_FILE_VERSION,
      entries: entries.map((entry) => ({
        owner: entry.owner,
        windowId: entry.windowId,
        tabs: entry.tabs.map((tab) => ({ cwd: tab.cwd, shell: tab.shell })),
        savedAt: entry.savedAt,
      })),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
