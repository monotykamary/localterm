import {
  gitDiffFileListResponseSchema,
  gitDiffFilePatchSchema,
  type GitDiffFileListResponse,
  type GitDiffFilePatch,
} from "@monotykamary/localterm-server/protocol";

const GIT_DIFF_FILES_ENDPOINT = "/api/git/diff/files";
const GIT_DIFF_FILE_ENDPOINT = "/api/git/diff/file";

const buildEndpointUrl = (endpoint: string, params: Record<string, string>): string => {
  const url = new URL(endpoint, window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

// Changed-file list with metadata only (no patch bodies) so the viewer opens
// instantly. Each file's patch loads on demand via fetchGitDiffFilePatch.
export const fetchGitDiffFiles = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<GitDiffFileListResponse | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_DIFF_FILES_ENDPOINT, { cwd }), { signal });
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
  signal?: AbortSignal,
): Promise<GitDiffFilePatch | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_DIFF_FILE_ENDPOINT, { cwd, path }), {
      signal,
    });
    if (!response.ok) return null;
    const parsed = gitDiffFilePatchSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
