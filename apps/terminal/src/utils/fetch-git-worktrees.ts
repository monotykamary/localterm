import {
  gitWorktreeListResponseSchema,
  type GitWorktreeListResponse,
  type GitWorktreeResult,
} from "@monotykamary/localterm-server/protocol";

const GIT_WORKTREES_ENDPOINT = "/api/git/worktrees";

const buildEndpointUrl = (endpoint: string, params: Record<string, string>): string => {
  const url = new URL(endpoint, window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

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
// branch from HEAD. The server picks the branch name and location; this returns
// the resolved path + branch, or git's own stderr message when it refuses (the
// path is unusable, the repo has no commits, …) so the form can show it.
export const createGitWorktree = async (cwd: string): Promise<GitWorktreeMutationResult> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_WORKTREES_ENDPOINT, { cwd }), {
      method: "POST",
    });
    const data = (await response.json()) as { path?: string; branch?: string; message?: string };
    if (!response.ok || !data.path || !data.branch) {
      return { ok: false, message: data.message ?? "couldn't create worktree" };
    }
    return { ok: true, result: { path: data.path, branch: data.branch } };
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
    return { ok: true, result: { path: worktreePath, branch: "" } };
  } catch {
    return { ok: false, message: "couldn't reach the localterm daemon" };
  }
};
