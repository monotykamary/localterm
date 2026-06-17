// Parses a GitHub PR URL (https://github.com/<owner>/<repo>/pull/<number>) into
// the minimal pieces the inline-set ambient-PR path needs. Returns null for
// anything else so a stream scan can ignore commits, issues, and cross-repo
// URLs that aren't a pull request.

interface ParsedGitHubPrUrl {
  owner: string;
  repo: string;
  number: number;
}

const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export const parseGitHubPrUrl = (url: string): ParsedGitHubPrUrl | null => {
  const match = GITHUB_PR_URL_RE.exec(url.trim());
  if (!match) return null;
  const number = Number.parseInt(match[3], 10);
  if (!Number.isInteger(number) || number <= 0) return null;
  return { owner: match[1], repo: match[2], number };
};
