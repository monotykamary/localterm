import {
  gitDiffResponseSchema,
  gitDiffSummarySchema,
  type GitDiffResponse,
  type GitDiffSummary,
} from "@monotykamary/localterm-server/protocol";

const GIT_DIFF_SUMMARY_ENDPOINT = "/api/git/diff-summary";
const GIT_DIFF_ENDPOINT = "/api/git/diff";

const buildEndpointUrl = (endpoint: string, cwd: string): string => {
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set("cwd", cwd);
  return url.toString();
};

export const fetchGitDiffSummary = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<GitDiffSummary | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_DIFF_SUMMARY_ENDPOINT, cwd), { signal });
    if (!response.ok) return null;
    const parsed = gitDiffSummarySchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const fetchGitDiff = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<GitDiffResponse | null> => {
  try {
    const response = await fetch(buildEndpointUrl(GIT_DIFF_ENDPOINT, cwd), { signal });
    if (!response.ok) return null;
    const parsed = gitDiffResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
