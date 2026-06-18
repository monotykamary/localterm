import {
  gitWorktreeListResponseSchema,
  gitWorktreeResultSchema,
  worktreeIncludeFileSchema,
  worktreeRepoConfigSchema,
  worktreeSweepResultSchema,
  type GitWorktreeBaseRef,
  type GitWorktreeListResponse,
  type GitWorktreeResult,
  type WorktreeIncludeFile,
  type WorktreeRepoConfig,
} from "@monotykamary/localterm-server/protocol";

const GIT_WORKTREES_ENDPOINT = "/api/git/worktrees";
const GIT_WORKTREES_CONFIG_ENDPOINT = "/api/git/worktrees/config";
const GIT_WORKTREES_INCLUDE_FILE_ENDPOINT = "/api/git/worktrees/include-file";
const GIT_WORKTREES_SWEEP_ENDPOINT = "/api/git/worktrees/sweep";
const LAUNCH_ENDPOINT = "/api/launch";

const buildEndpointUrl = (endpoint: string, params: Record<string, string>): string => {
  const url = new URL(endpoint, window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

export interface CreateWorktreeOptions {
  baseRef?: GitWorktreeBaseRef;
  pullRequestNumber?: number;
}

export type GitWorktreeMutationResult =
  | { ok: true; result: GitWorktreeResult }
  | { ok: false; message: string };

// All worktrees sharing the caller's repo. Read-on-demand: `git worktree list`
// returns the whole linked set from any worktree, so there's no store to keep
// in sync — a refresh is just another fetch.
export const fetchGitWorktrees = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<GitWorktreeListResponse | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_ENDPOINT, { cwd }), { signal });
    if (!response.ok) return null;
    const parsed = gitWorktreeListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Create a worktree under ~/.localterm/worktrees/<project>/ on an auto-generated
// branch (or `pr-<N>` when a PR number is given), branching from the repo's
// configured base ref unless overridden. The server attaches `setupCommand`
// (the repo's configured setup script, or null) so the caller can run it as the
// new tab's initial command, and `copiedFiles` (gitignored files
// `.worktreeinclude` pulled in). Returns git's own stderr when it refuses (the
// path is unusable, the repo has no commits, the PR can't be fetched, …).
export const createGitWorktree = async (
  cwd: string,
  options: CreateWorktreeOptions = {},
): Promise<GitWorktreeMutationResult> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_ENDPOINT, { cwd }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRef: options.baseRef,
        pullRequestNumber: options.pullRequestNumber,
      }),
    });
    const data = (await response.json()) as { message?: string };
    if (!response.ok) {
      return { ok: false, message: data.message ?? "couldn't create worktree" };
    }
    const parsed = gitWorktreeResultSchema.safeParse(data);
    if (!parsed.success) {
      return { ok: false, message: "couldn't create worktree" };
    }
    return { ok: true, result: parsed.data };
  } catch {
    return { ok: false, message: "couldn't reach the localterm daemon" };
  }
};

// Remove a worktree. Fails for the current worktree or a locked one unless
// unlocked first; git's stderr is surfaced as the message.
export const removeGitWorktree = async (
  cwd: string,
  worktreePath: string,
): Promise<GitWorktreeMutationResult> => {
  try {
    const response = await fetch(
      buildEndpointUrl(GIT_WORKTREES_ENDPOINT, { cwd, path: worktreePath }),
      { method: "DELETE" },
    );
    const data = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !data.ok) {
      return { ok: false, message: data.message ?? "couldn't remove worktree" };
    }
    return {
      ok: true,
      result: { path: worktreePath, branch: "", setupCommand: null, copiedFiles: [] },
    };
  } catch {
    return { ok: false, message: "couldn't reach the localterm daemon" };
  }
};

// Per-repo worktree config: setup script, "Open in…" launchers, default base
// ref. Keyed server-side by repo id; null when the daemon is unreachable.
export const fetchWorktreeConfig = async (cwd: string): Promise<WorktreeRepoConfig | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_CONFIG_ENDPOINT, { cwd }));
    if (!response.ok) return null;
    const parsed = worktreeRepoConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Replace selected fields of the repo's worktree config. Pass only the fields
// being edited; the server merges and sanitizes. Returns the merged config.
export const updateWorktreeConfig = async (
  cwd: string,
  patch: Partial<WorktreeRepoConfig>,
): Promise<WorktreeRepoConfig | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_CONFIG_ENDPOINT, { cwd }), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return null;
    const parsed = worktreeRepoConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Read the repo's `.worktreeinclude` file. Returns null when the daemon is
// unreachable or the cwd is not inside a git repository.
export const fetchWorktreeIncludeFile = async (
  cwd: string,
): Promise<WorktreeIncludeFile | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_INCLUDE_FILE_ENDPOINT, { cwd }));
    if (!response.ok) return null;
    const parsed = worktreeIncludeFileSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Write the repo's `.worktreeinclude` file. Passing empty content deletes it.
// Returns null when the daemon is unreachable or the cwd is not a git repo.
export const updateWorktreeIncludeFile = async (
  cwd: string,
  content: string,
): Promise<WorktreeIncludeFile | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_INCLUDE_FILE_ENDPOINT, { cwd }), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) return null;
    const parsed = worktreeIncludeFileSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Remove stale, clean, auto-created worktrees. Returns the paths removed, or
// null when the daemon is unreachable.
export const sweepWorktrees = async (cwd: string): Promise<{ removed: string[] } | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_SWEEP_ENDPOINT, { cwd }), {
      method: "POST",
    });
    if (!response.ok) return null;
    const parsed = worktreeSweepResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Launch an external command (an "Open in…" entry) detached in a worktree via
// the user's login shell. The spawned process outlives the request; its output
// is discarded. Returns ok unless the spawn immediately failed.
export const launchCommand = async (
  cwd: string,
  command: string,
): Promise<{ ok: boolean; message?: string }> => {
  try {
    const response = await fetch(LAUNCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, command }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { message?: string };
      return { ok: false, message: data.message ?? "couldn't launch command" };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "couldn't reach the localterm daemon" };
  }
};
