import {
  gitBranchInfoSchema,
  gitDiffFileListResponseSchema,
  gitDiffFilePatchSchema,
  type GitBranchInfo,
  type GitDiffFileListResponse,
  type GitDiffFilePatch,
  type GitDiffMode,
} from "@monotykamary/localterm-server/protocol";

const GIT_DIFF_FILES_ENDPOINT = "/api/git/diff/files";
const GIT_DIFF_FILE_ENDPOINT = "/api/git/diff/file";
const GIT_BRANCHES_ENDPOINT = "/api/git/branches";

const buildEndpointUrl = (endpoint: string, params: Record<string, string>): string => {
  const url = new URL(endpoint, window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

// The comparison the viewer is asking for. `base` is only meaningful in "branch"
// mode and only when the user has overridden the server's default; omitting it
// lets the server resolve the default base (PR base / repo default branch).
export interface GitDiffQuery {
  mode: GitDiffMode;
  base?: string | null;
}

const diffParams = (cwd: string, query: GitDiffQuery): Record<string, string> => {
  const params: Record<string, string> = { cwd, mode: query.mode };
  if (query.mode === "branch" && query.base) params.base = query.base;
  return params;
};

// Changed-file list with metadata only (no patch bodies) so the viewer opens
// instantly. Each file's patch loads on demand via fetchGitDiffFilePatch.
export const fetchGitDiffFiles = async (
  cwd: string,
  query: GitDiffQuery,
  signal?: AbortSignal,
): Promise<GitDiffFileListResponse | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_DIFF_FILES_ENDPOINT, diffParams(cwd, query)), {
      signal,
    });
    if (!response.ok) return null;
    const parsed = gitDiffFileListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// One file's unified diff, fetched when that file is selected (or prefetched for
// a neighbor). Small payload + cheap validation, unlike the bulk diff.
export const fetchGitDiffFilePatch = async (
  cwd: string,
  path: string,
  query: GitDiffQuery,
  signal?: AbortSignal,
): Promise<GitDiffFilePatch | null> => {
  try {
    const response = await fetch(
      buildEndpointUrl(GIT_DIFF_FILE_ENDPOINT, { ...diffParams(cwd, query), path }),
      { signal },
    );
    if (!response.ok) return null;
    const parsed = gitDiffFilePatchSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Base-branch picker data (candidate refs, default base, detected PR). Fetched
// once when the viewer needs branch mode — never polled.
export const fetchGitBranches = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<GitBranchInfo | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_BRANCHES_ENDPOINT, { cwd }), { signal });
    if (!response.ok) return null;
    const parsed = gitBranchInfoSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
